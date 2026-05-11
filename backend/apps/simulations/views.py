"""Simulation views."""

import csv
import io
import logging
import zipfile
from typing import Any

import numpy as np
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.permissions import IsProjectOwnerOrShared

from .models import ParametricStudy, Simulation, SimulationStatus
from .serializers import (
    BatchProjectionExportRequestSerializer,
    ParametricStudySerializer,
    SimulationDetailSerializer,
    SimulationSerializer,
)
from .services.params import (
    PARAM_KEY_DIAMETER,
    get_scale_factor_nm,
)
from .services.projection import (
    render_projection_png,
    render_projection_svg,
    create_projection_filename,
)
from .services.projections import build_projection_zip, compute_per_direction_scales
from .services.mat_parser import MatParseError, parse_mat_geometry
from .tasks import compute_import_metrics_task, run_simulation_task
from .utils import CSVParseError, parse_csv_geometry

# Rejection message for .dat uploads — spec R7 scenario "`.dat` upload". The
# view returns this verbatim so the frontend can display it as-is. If you
# change one word here, update the corresponding scenario in
# openspec/changes/import-aggregate/specs/import-aggregate-contract.md (R7).
_DAT_REJECTION_MESSAGE = (
    "The .dat format from Box-Counter contains tessellated surface "
    "points, not per-particle coordinates. To import an aggregate, "
    "use CSV (.csv) or MATLAB (.mat) with per-particle "
    "(x, y, z, radius) data."
)


def _resolve_import_format(original_filename: str, explicit_format: str | None) -> str:
    """Determine the importer to dispatch to.

    Priority:

    1. An explicit ``format`` field from the payload (``"csv"``, ``"mat"``,
       or ``"dat"``) wins — the frontend sets this from its own file-type
       detection, and we trust it over a potentially-stripped filename.
    2. Otherwise, fall back to the filename extension.
    3. Default: ``"csv"`` (preserves pre-change behaviour for clients that
       don't send either hint).
    """
    if explicit_format:
        return explicit_format.lower().strip().lstrip(".")
    if original_filename:
        lower = original_filename.lower()
        if lower.endswith(".mat"):
            return "mat"
        if lower.endswith(".dat"):
            return "dat"
        if lower.endswith(".csv"):
            return "csv"
    return "csv"


logger = logging.getLogger(__name__)


# --- CSV export locale helpers (hoisted to apps.core.services.csv_locale) ----

from apps.core.services.csv_locale import (
    get_user_csv_locale as _get_user_csv_locale,
    write_localized_row as _write_localized_row,
)


# --- Shared projection rendering --------------------------------------------


def _render_projection_bytes(
    projection_result: Any,
    img_format: str = "png",
    img_size: int | None = None,
):
    """Render a single ``PyProjectionResult`` into PNG bytes or SVG string.

    Shared by legacy (``projection_batch``), new sync mode, and the Celery
    async task. Wrapping the matplotlib call here funnels every rendering
    path through the same ``plt.close(fig)`` cleanup done inside
    ``render_projection_png`` / ``render_projection_svg`` — avoiding the
    figure-leak design risk called out in design.md Component 5.

    ``projection_result`` is any object with ``.x``, ``.y``, ``.radii``,
    and ``.bounds`` attributes (both the PyO3 ``PyProjectionResult`` and
    test fakes qualify).

    Returns ``bytes`` for PNG, ``str`` for SVG (both accepted by
    ``zipfile.ZipFile.writestr``). Grid / Fibonacci modes always call with
    ``img_format="png"`` — only legacy preserves SVG backcompat.

    ``img_size`` (PNG only) forces an exact pixel dimension for the output.
    SVG is vector and ignores it. Legacy callers pass ``None`` to preserve
    the pre-change dpi=150 behavior byte-for-byte (R3).
    """
    bounds = (
        projection_result.bounds[0],
        projection_result.bounds[1],
        projection_result.bounds[2],
        projection_result.bounds[3],
    )
    if img_format == "svg":
        return render_projection_svg(
            projection_result.x,
            projection_result.y,
            projection_result.radii,
            bounds,
        )
    return render_projection_png(
        projection_result.x,
        projection_result.y,
        projection_result.radii,
        bounds,
        img_size=img_size,
    )


def _stamp_scale_metadata(
    parameters: dict,
    simulation: Simulation,
    coords: np.ndarray,
    radii: np.ndarray,
    img_size: int,
) -> None:
    """Mutate ``parameters`` in-place to add pixel-to-physical scale fields.

    Adds two keys consumed by downstream box-counting tools (e.g. FRAKTAL):

    - ``pixels_per_100nm`` (float | None): how many pixels correspond to
      100 nm in the rendered PNGs. ``None`` when the aggregate is empty
      or the engine→nm conversion is degenerate.
    - ``scale_factor_nm`` (float): ``primary_particle_diameter_nm / 2``,
      the engine→nm multiplier used for Rg display across the app.

    Scale is constant per aggregate (NOT per direction) because we use
    the 3D bounding-box extent + particle-radius margin as the reference
    span. This over-estimates the span for direction-dependent 2D
    bounding boxes, so the reported ``pixels_per_100nm`` is a
    conservative lower bound on the true scale for any given view — safe
    for box-counting (box sizes mapped into nm will be slightly coarser
    than reality, never finer). The alternative (per-direction scale) is
    rejected by spec: the user wants ONE scale at the ZIP root.

    Must be called BEFORE Celery dispatch so the async path honors the
    stamped value without re-deriving it.
    """
    scale_factor_nm = get_scale_factor_nm(simulation.parameters)
    parameters["scale_factor_nm"] = float(scale_factor_nm)

    pixels_per_100nm: float | None
    if len(coords) > 0:
        # Axis-aligned 3D bounding box span + particle-radius margin on
        # each side. The renderer pads 2D extents by 2% per side, so
        # multiply by 1.04 to match the displayed canvas span.
        max_extent_engine = float(
            max(
                coords[:, 0].max() - coords[:, 0].min(),
                coords[:, 1].max() - coords[:, 1].min(),
                coords[:, 2].max() - coords[:, 2].min(),
            )
            + 2.0 * float(np.max(radii))
        )
        span_engine = max_extent_engine * 1.04
        span_nm = span_engine * scale_factor_nm
        pixels_per_100nm = 100.0 * float(img_size) / span_nm if span_nm > 0 else None
    else:
        pixels_per_100nm = None

    parameters["pixels_per_100nm"] = pixels_per_100nm


class SimulationViewSet(viewsets.ModelViewSet):
    """ViewSet for Simulation CRUD operations."""

    queryset = Simulation.objects.select_related("project")
    permission_classes = [IsAuthenticated, IsProjectOwnerOrShared]

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == "retrieve":
            return SimulationDetailSerializer
        return SimulationSerializer

    def get_queryset(self):
        """Filter simulations by project if project_id in URL.

        Excludes batch simulations from the list view only.
        Detail views can still access batch simulations.
        """
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_pk")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        # Only exclude batch simulations from list view, not detail/other actions
        if self.action == "list":
            queryset = queryset.filter(is_batch=False)
        return queryset

    def _process_import_payload(
        self,
        csv_data: str,
        extra_parameters: dict,
        *,
        fmt: str = "csv",
        original_filename: str = "",
    ) -> tuple[np.ndarray, dict]:
        """Decode + parse + stamp helper for geometry imports.

        Centralizes the import pipeline so both the CSV and MATLAB ``.mat``
        branches of ``perform_create`` go through a single entry point. The
        ``fmt`` argument chooses the parser:

        - ``"csv"`` → :func:`parse_csv_geometry` over UTF-8 text.
        - ``"mat"`` → :func:`parse_mat_geometry` over raw bytes.

        ``.dat`` is NOT handled here — it's rejected earlier in
        :meth:`create` before base64 decoding runs (T10).

        Args:
            csv_data: Base64-encoded payload. For CSV it decodes to UTF-8
                text; for ``.mat`` it decodes to arbitrary binary bytes.
            extra_parameters: The serializer's ``validated_data["parameters"]``
                dict (may already contain user-supplied keys). A *copy* is
                returned with the import stamps injected.
            fmt: Source format. Must be ``"csv"`` or ``"mat"``; anything else
                is routed as CSV for backwards compatibility.
            original_filename: Filename from the request payload (optional).

        Returns:
            A tuple ``(geometry_array, stamped_parameters)`` where
            ``geometry_array`` is an ``(N, 4)`` float64 array and
            ``stamped_parameters`` contains the five keys required by the
            v2 import contract (R3): ``primary_particle_diameter_nm``,
            ``source``, ``original_filename``, ``original_format``,
            ``import_metadata``. The serializer stamps
            ``parameters_schema_version`` on top of these.
        """
        import base64

        from rest_framework import serializers as drf_serializers

        # Step 1: base64 → raw bytes. Base64 syntax is already validated by
        # the serializer (see ``validate_csv_data``); a failure here would be
        # a programmer error, but we still raise 400 instead of 500 to keep
        # the HTTP contract honest.
        try:
            raw_bytes = base64.b64decode(csv_data)
        except Exception as exc:
            raise drf_serializers.ValidationError(
                {"csv_data": f"Failed to decode payload: {exc}"}
            )

        # Step 2: dispatch on format. The parser owns all shape/content
        # validation. Each parser raises a format-specific error that we
        # translate to DRF 400 so bad content is a client error, not 500.
        import_metadata: dict[str, Any]
        if fmt == "mat":
            try:
                geometry_array, import_metadata = parse_mat_geometry(raw_bytes)
            except MatParseError as exc:
                raise drf_serializers.ValidationError({"csv_data": str(exc)})
            n_particles = int(geometry_array.shape[0])
            radii = geometry_array[:, 3]
            radius_min = float(radii.min())
            radius_max = float(radii.max())
            source_stamp = "mat_import"
        else:
            # CSV path — the parser now accepts raw bytes directly and owns
            # the UTF-8 decode + metadata strip + locale sniff. Any failure
            # is surfaced as a 400 via CSVParseError.
            try:
                (
                    geometry_array,
                    n_particles,
                    radius_min,
                    radius_max,
                    import_metadata,
                ) = parse_csv_geometry(raw_bytes)
            except CSVParseError as exc:
                raise drf_serializers.ValidationError({"csv_data": str(exc)})
            source_stamp = "csv_import"

        # Step 3: stamp v2 import-contract parameters (R3). The serializer's
        # create() adds ``parameters_schema_version="v2"`` on top of what we
        # write here. Diameter precedence (CSV only — .mat has no metadata
        # dict in MVP):
        #   1. metadata["primary_particle_diameter_nm"] explicit override
        #   2. metadata["unit"] == "dimensionless" → DEFAULT_DIAMETER_NM
        #   3. fallback: 2 * mean(radius) from the file's native unit
        params = dict(extra_parameters) if extra_parameters else {}
        meta_diameter = (
            import_metadata.get("primary_particle_diameter_nm")
            if isinstance(import_metadata, dict)
            else None
        )
        meta_unit = (
            import_metadata.get("unit") if isinstance(import_metadata, dict) else None
        )
        if (
            isinstance(meta_diameter, (int, float))
            and not isinstance(meta_diameter, bool)
            and meta_diameter > 0
        ):
            params[PARAM_KEY_DIAMETER] = float(meta_diameter)
        elif meta_unit == "dimensionless":
            # Import a normalized-radius geometry: use the historical default
            # diameter so downstream nm-scaling stays sensible.
            from .services.params import DEFAULT_DIAMETER_NM

            params[PARAM_KEY_DIAMETER] = DEFAULT_DIAMETER_NM
        else:
            mean_radius = float(np.mean(geometry_array[:, 3]))
            params[PARAM_KEY_DIAMETER] = 2.0 * mean_radius
        params["source"] = source_stamp
        params["original_filename"] = original_filename or ""
        params["original_format"] = fmt if fmt in ("csv", "mat") else "csv"
        params["import_metadata"] = import_metadata
        # Geometry stats preserved for backwards-compat with UI code reading them.
        params["n_particles"] = n_particles
        params["radius_min"] = radius_min
        params["radius_max"] = radius_max

        return geometry_array, params

    def create(self, request: Request, *args, **kwargs) -> Response:
        """Create a simulation, with format-aware pre-dispatch for imports.

        For ``algorithm="imported"`` uploads we inspect the filename (and the
        optional ``format`` field) BEFORE the serializer runs so that:

        - ``.dat`` uploads are rejected immediately with the spec R7 message,
          skipping both base64 decode and UTF-8 check (T10).
        - ``.mat`` uploads reach the MATLAB parser without tripping the
          serializer's CSV-specific UTF-8 validation (the binary payload would
          fail to decode as UTF-8).

        Everything else — CSV imports, regular algorithms — falls through to
        DRF's default :meth:`create` unchanged.
        """
        if request.data.get("algorithm") == "imported":
            # Accept ``original_filename`` and ``format`` at either the top
            # level (legacy scripted clients, ``curl``, tests) or inside the
            # ``parameters`` dict (current frontend — see
            # frontend/src/components/forms/ImportAggregateDialog.tsx).
            # Top-level wins when both are set so external callers that
            # opt-in to the cleaner shape aren't overridden by stray
            # values the UI might leave in ``parameters``.
            params_payload = request.data.get("parameters") or {}
            if not isinstance(params_payload, dict):
                params_payload = {}
            original_filename = request.data.get(
                "original_filename"
            ) or params_payload.get("original_filename", "")
            explicit_format = request.data.get("format") or params_payload.get("format")
            fmt = _resolve_import_format(original_filename, explicit_format)

            if fmt == "dat":
                # T10: spec R7 explicit rejection. Happens BEFORE any parsing
                # (no base64 decode, no UTF-8 check). The message is a
                # verbatim copy of the spec scenario — do not paraphrase.
                return Response(
                    {"detail": _DAT_REJECTION_MESSAGE},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Stash the resolved format so perform_create can route to the
            # right parser without re-sniffing.
            self._import_fmt = fmt

        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        """Create simulation and enqueue task."""
        from django.conf import settings

        project_id = self.kwargs.get("project_pk")
        algorithm = serializer.validated_data.get("algorithm")
        csv_data = self.request.data.get("csv_data")

        # Handle imported algorithm differently
        if algorithm == "imported" and csv_data:
            extra_params = serializer.validated_data.get("parameters", {})
            # Mirror the fallback in create() — accept original_filename from
            # either top level or parameters.* for backwards compat with
            # external clients while supporting the current frontend shape.
            original_filename = self.request.data.get("original_filename") or (
                extra_params.get("original_filename", "")
                if isinstance(extra_params, dict)
                else ""
            )
            fmt = getattr(self, "_import_fmt", "csv")
            geometry_array, params = self._process_import_payload(
                csv_data,
                extra_params,
                fmt=fmt,
                original_filename=original_filename,
            )

            # Serializer.save() merges our stamped params into validated_data
            # BEFORE the model is persisted, and its create() adds the v2
            # schema_version stamp. The import-contract keys therefore land on
            # Simulation.parameters in the initial INSERT, not via a follow-up
            # update — required by R3.
            simulation = serializer.save(project_id=project_id, parameters=params)

            # Store geometry as NumPy binary
            buffer = io.BytesIO()
            np.save(buffer, geometry_array)
            simulation.geometry = buffer.getvalue()
            simulation.save(update_fields=["geometry"])

            # Queue metrics computation task
            try:
                result = compute_import_metrics_task.delay(str(simulation.id))
                simulation.task_id = result.id
                simulation.save(update_fields=["task_id"])
            except Exception as exc:
                if settings.DEBUG:
                    # Run synchronously in development if Celery unavailable
                    compute_import_metrics_task(str(simulation.id))
                else:
                    logger.error(
                        f"Failed to queue import metrics {simulation.id}: {exc}"
                    )
                    simulation.status = SimulationStatus.FAILED
                    simulation.error_message = (
                        "Task broker unavailable. Please try again later."
                    )
                    simulation.completed_at = timezone.now()
                    simulation.save(
                        update_fields=["status", "error_message", "completed_at"]
                    )

            return

        # Regular simulation flow
        simulation = serializer.save(project_id=project_id)

        # Try Celery, fall back to sync execution in development
        try:
            result = run_simulation_task.delay(str(simulation.id))
            # Store task ID for cancellation
            simulation.task_id = result.id
            simulation.save(update_fields=["task_id"])
        except Exception as exc:
            if settings.DEBUG:
                # Run synchronously in development if Celery unavailable
                run_simulation_task(str(simulation.id))
            else:
                logger.error(f"Failed to queue simulation {simulation.id}: {exc}")
                simulation.status = SimulationStatus.FAILED
                simulation.error_message = (
                    "Task broker unavailable. Please try again later."
                )
                simulation.completed_at = timezone.now()
                simulation.save(
                    update_fields=["status", "error_message", "completed_at"]
                )

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """Delete a simulation."""
        simulation = self.get_object()

        # If running, cancel the task first
        if simulation.status in [SimulationStatus.QUEUED, SimulationStatus.RUNNING]:
            self._cancel_task(simulation)

        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def cancel(self, request: Request, pk=None, **kwargs) -> Response:
        """Cancel a running or queued simulation."""
        simulation = self.get_object()

        if simulation.status not in [SimulationStatus.QUEUED, SimulationStatus.RUNNING]:
            return Response(
                {
                    "error": f"Cannot cancel simulation with status '{simulation.status}'"
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        self._cancel_task(simulation)

        # Update simulation status
        simulation.status = SimulationStatus.CANCELLED
        simulation.completed_at = timezone.now()
        simulation.error_message = "Cancelled by user"
        simulation.save(update_fields=["status", "completed_at", "error_message"])

        logger.info(f"Simulation {simulation.id} cancelled by user")

        return Response({"status": "cancelled", "simulation_id": str(simulation.id)})

    def _cancel_task(self, simulation: Simulation) -> None:
        """Revoke the Celery task if it exists."""
        if simulation.task_id:
            try:
                from celery.result import AsyncResult

                result = AsyncResult(simulation.task_id)
                result.revoke(terminate=True)
                logger.info(f"Revoked Celery task {simulation.task_id}")
            except Exception as e:
                logger.warning(f"Failed to revoke task {simulation.task_id}: {e}")

    @action(detail=False, methods=["delete"], url_path="delete-all")
    def delete_all(self, request: Request, **kwargs) -> Response:
        """Delete all simulations in the project (excluding batch simulations)."""
        project_id = self.kwargs.get("project_pk")
        if not project_id:
            return Response(
                {"error": "Project ID required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get all non-batch simulations for this project
        simulations = Simulation.objects.filter(project_id=project_id, is_batch=False)

        # Cancel any running tasks first
        for sim in simulations.filter(
            status__in=[SimulationStatus.QUEUED, SimulationStatus.RUNNING]
        ):
            self._cancel_task(sim)

        count = simulations.count()
        simulations.delete()

        logger.info(f"Deleted {count} simulations from project {project_id}")
        return Response({"deleted": count, "message": f"Deleted {count} simulations"})

    @action(detail=True, methods=["get"])
    def geometry(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Download geometry as binary NumPy array."""
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        response = HttpResponse(
            simulation.geometry,
            content_type="application/octet-stream",
        )
        response["Content-Disposition"] = f'attachment; filename="{simulation.id}.npy"'
        return response

    @action(detail=True, methods=["post"])
    def projection(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Generate a 2D projection of the agglomerate.

        POST body:
        {
            "azimuth": 45.0,      // degrees (default: 0, range: 0-360)
            "elevation": 30.0,   // degrees (default: 0, range: -90 to 90)
            "format": "png"      // "png" or "svg" (default: "png")
        }
        """
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Parse and validate parameters (Issue #7, #9, #10 fixes)
        try:
            azimuth = float(request.data.get("azimuth", 0.0))
            elevation = float(request.data.get("elevation", 0.0))
        except (ValueError, TypeError) as e:
            return Response(
                {"error": f"Invalid numeric parameter: {e}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate angle ranges (Issue #9)
        if not (0 <= azimuth <= 360):
            return Response(
                {"error": "Azimuth must be between 0 and 360 degrees"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (-90 <= elevation <= 90):
            return Response(
                {"error": "Elevation must be between -90 and 90 degrees"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate format strictly (Issue #10)
        img_format = request.data.get("format", "png")
        if not isinstance(img_format, str):
            return Response(
                {"error": "Format must be a string"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        img_format = img_format.lower().strip()

        if img_format not in ("png", "svg"):
            return Response(
                {"error": "Format must be 'png' or 'svg'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Load geometry
        coords, radii = self._load_geometry(simulation)

        # Project using Rust
        import aglogen_core

        proj = aglogen_core.project_to_2d(coords, radii, azimuth, elevation)

        # Render image
        bounds = (proj.bounds[0], proj.bounds[1], proj.bounds[2], proj.bounds[3])

        if img_format == "png":
            image_data = render_projection_png(proj.x, proj.y, proj.radii, bounds)
            content_type = "image/png"
        else:
            image_data = render_projection_svg(proj.x, proj.y, proj.radii, bounds)
            content_type = "image/svg+xml"

        filename = create_projection_filename(
            str(simulation.id)[:8], azimuth, elevation, img_format
        )

        response = HttpResponse(image_data, content_type=content_type)
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"], url_path="projection/batch")
    def projection_batch(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Generate batch 2D projections as a ZIP file.

        Dispatches by ``mode``:
        - ``mode`` omitted or ``"legacy"`` → existing legacy sweep (R3
          backcompat — byte-for-byte identical to the pre-change endpoint).
        - ``mode="grid"`` → requires ``n_az, n_el``; generates
          ``n_az*(n_el-2)+2`` projections (R1).
        - ``mode="fibonacci"`` → requires ``n``; generates exactly N
          projections on a golden-angle lattice (R2).

        Sync/async boundary (R6): ``N ≤ 200`` returns the ZIP synchronously
        (HTTP 200, ``application/zip``). ``N > 200`` enqueues a Celery job
        and returns HTTP 202 with ``{"job_id": ...}``; the client polls
        ``/api/v1/projections-status/{job_id}/`` for status and download URL.
        """
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        mode_raw = request.data.get("mode")
        # Empty-string → legacy (same as omitted). Lowercase for tolerance.
        mode = (
            (mode_raw or "legacy").lower().strip()
            if isinstance(mode_raw, str)
            else "legacy"
        )

        if mode == "legacy":
            return self._export_projections_legacy(request, simulation)
        if mode == "grid":
            return self._export_projections_modern(request, simulation, mode="grid")
        if mode == "fibonacci":
            return self._export_projections_modern(
                request, simulation, mode="fibonacci"
            )

        return Response(
            {
                "detail": (
                    f"Unknown mode {mode_raw!r}. "
                    "Must be one of: 'grid', 'fibonacci', 'legacy'."
                )
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # ------------------------------------------------------------------
    # Legacy export path (pre-change behavior — R3 byte-for-byte backcompat)
    # ------------------------------------------------------------------

    def _export_projections_legacy(
        self, request: Request, simulation: Simulation
    ) -> HttpResponse:
        """Unchanged legacy sweep path.

        Preserved verbatim from the pre-mode endpoint so external consumers
        that omit ``mode`` (or pass ``mode=legacy``) get identical ZIPs to
        what they got before this change landed. Do NOT modify filenames,
        add metadata.json, or change order here — see R3.

        Note on error envelope: the existing 400s below use ``{"error": ...}``
        (not ``{"detail": ...}``). The broad-exception catch at the bottom
        MUST preserve that envelope shape for R3 byte-for-byte backcompat —
        downstream 500s are converted into 400s using the same ``"error"``
        key, not DRF's default ``"detail"``.
        """
        # Parse and validate parameters (Issue #8, #9, #10 fixes)
        try:
            az_start = float(request.data.get("azimuth_start", 0.0))
            az_end = float(request.data.get("azimuth_end", 150.0))
            az_step = float(request.data.get("azimuth_step", 30.0))
            el_start = float(request.data.get("elevation_start", 0.0))
            el_end = float(request.data.get("elevation_end", 150.0))
            el_step = float(request.data.get("elevation_step", 30.0))
        except (ValueError, TypeError) as e:
            return Response(
                {"error": f"Invalid numeric parameter: {e}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate angle ranges (Issue #9)
        if not (0 <= az_start <= 360) or not (0 <= az_end <= 360):
            return Response(
                {"error": "Azimuth values must be between 0 and 360 degrees"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (-90 <= el_start <= 90) or not (-90 <= el_end <= 90):
            return Response(
                {"error": "Elevation values must be between -90 and 90 degrees"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate format strictly (Issue #10)
        img_format = request.data.get("format", "png")
        if not isinstance(img_format, str):
            return Response(
                {"error": "Format must be a string"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        img_format = img_format.lower().strip()

        if img_format not in ("png", "svg"):
            return Response(
                {"error": "Format must be 'png' or 'svg'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if az_step <= 0 or el_step <= 0:
            return Response(
                {"error": "Step values must be positive"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Post-validation work (geometry load + Rust project_batch + ZIP
        # assembly) wrapped so any downstream failure surfaces as 400 with
        # the legacy ``{"error": ...}`` envelope (R3 byte-for-byte
        # backcompat). Without this, an unexpected exception would leak as
        # a 500 with no context in the response body.
        try:
            # Load geometry
            coords, radii = self._load_geometry(simulation)

            # Generate batch projections using Rust
            import aglogen_core

            projections = aglogen_core.project_batch(
                coords,
                radii,
                azimuth_start=az_start,
                azimuth_end=az_end,
                azimuth_step=az_step,
                elevation_start=el_start,
                elevation_end=el_end,
                elevation_step=el_step,
            )

            # Collect legacy filename + direction pairs so the metadata.json
            # emitted at the end of the ZIP references them verbatim (R4
            # preserved — legacy filename shape unchanged). build_metadata_json
            # emits its own canonical filenames via build_projection_filename,
            # so we override them after the fact for the legacy branch.
            legacy_filenames: list[str] = []
            legacy_directions: list[tuple[float, float]] = []
            first_png_size: tuple[int, int] | None = None

            # Create ZIP file with all projections
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for proj in projections:
                    image_data = _render_projection_bytes(proj, img_format)
                    filename = create_projection_filename(
                        str(simulation.id)[:8], proj.azimuth, proj.elevation, img_format
                    )
                    zf.writestr(filename, image_data)
                    legacy_filenames.append(filename)
                    legacy_directions.append(
                        (float(proj.azimuth), float(proj.elevation))
                    )

                    # Measure the first PNG so we can derive the actual
                    # rendered pixel size for legacy scale computation.
                    # Legacy PNGs use bbox_inches='tight' (no fixed img_size),
                    # so we must measure output dimensions.
                    if first_png_size is None and img_format == "png":
                        try:
                            from PIL import Image as _PILImage

                            with _PILImage.open(io.BytesIO(image_data)) as _probe:
                                first_png_size = _probe.size  # (w, h)
                        except Exception:  # noqa: BLE001 — metadata is best-effort
                            first_png_size = None

                # Additive per R3 evolution: legacy ZIPs now also carry a
                # metadata.json so FRAKTAL batch analysis can auto-calibrate
                # against them (parity with grid/fibonacci modes). The PNG
                # layer is byte-for-byte unchanged — only this extra file
                # is added.
                from .services.projections import build_metadata_json

                parameters: dict[str, Any] = {
                    "azimuth_start": az_start,
                    "azimuth_end": az_end,
                    "azimuth_step": az_step,
                    "elevation_start": el_start,
                    "elevation_end": el_end,
                    "elevation_step": el_step,
                    "format": img_format,
                }

                # Compute pixels_per_100nm from 2D projected bboxes.
                # Legacy mode stamps ONLY the global (max) scale — no
                # per-direction fields (conscious spec deferral).
                scale_factor_nm = get_scale_factor_nm(simulation.parameters)
                parameters["scale_factor_nm"] = float(scale_factor_nm)

                if first_png_size is not None and len(projections) > 0:
                    # Use min(width, height) as the effective img_size
                    # (legacy renderer preserves aspect ratio via tight bbox).
                    legacy_img_size = int(min(first_png_size))

                    # Compute per-direction scale from 2D projected bounds.
                    # proj.bounds = (min_x, max_x, min_y, max_y) — these ARE
                    # the 2D bbox from the Rust projection.
                    max_scale = 0.0
                    for proj in projections:
                        b = proj.bounds  # (min_x, max_x, min_y, max_y)
                        bbox_w = b[1] - b[0]  # max_x - min_x
                        bbox_h = b[3] - b[2]  # max_y - min_y
                        span_engine = max(bbox_w, bbox_h) * 1.04
                        span_nm = span_engine * scale_factor_nm
                        if span_nm > 0:
                            pix = 100.0 * float(legacy_img_size) / span_nm
                            max_scale = max(max_scale, pix)

                    parameters["pixels_per_100nm"] = (
                        max_scale if max_scale > 0 else None
                    )
                else:
                    parameters["pixels_per_100nm"] = None

                metadata = build_metadata_json(
                    mode="legacy",
                    n_requested=len(legacy_directions),
                    directions=legacy_directions,
                    parameters=parameters,
                )
                # Override the canonical ``proj_###_Az###_El±###`` filenames
                # inside ``directions[]`` with the legacy filenames we
                # actually wrote to the ZIP, so consumers can correlate
                # metadata entries to PNG files without guesswork.
                for entry, legacy_name in zip(metadata["directions"], legacy_filenames):
                    entry["filename"] = legacy_name

                import json as _json

                zf.writestr("metadata.json", _json.dumps(metadata, indent=2))

            zip_buffer.seek(0)
            response = HttpResponse(zip_buffer.read(), content_type="application/zip")
            response["Content-Disposition"] = (
                f'attachment; filename="{simulation.id}_projections.zip"'
            )
            return response
        except Exception as exc:
            logger.exception(
                "Legacy projection export failed for simulation %s", simulation.id
            )
            return Response(
                {"error": f"Legacy projection export failed: {exc!s}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    # ------------------------------------------------------------------
    # Grid / Fibonacci export path (new modes — R1, R2, R5, R6)
    # ------------------------------------------------------------------

    def _export_projections_modern(
        self, request: Request, simulation: Simulation, *, mode: str
    ) -> HttpResponse:
        """Grid / Fibonacci export — either sync ZIP or async Celery dispatch."""
        import aglogen_core

        # --- Image size (optional knob, default 512) ---
        try:
            img_size = int(request.data.get("img_size", 512))
        except (TypeError, ValueError):
            return Response(
                {"detail": "img_size must be an integer"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if img_size < 64 or img_size > 4096:
            return Response(
                {"detail": "img_size must be between 64 and 4096"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # --- Resolve directions per mode ---
        if mode == "grid":
            n_az = request.data.get("n_az")
            n_el = request.data.get("n_el")
            if n_az is None or n_el is None:
                return Response(
                    {"detail": "mode=grid requires 'n_az' and 'n_el'"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                n_az = int(n_az)
                n_el = int(n_el)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "n_az and n_el must be integers"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if n_az < 1:
                return Response(
                    {"detail": "n_az must be >= 1"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if n_el < 2:
                return Response(
                    {"detail": "n_el must be >= 2 (both poles required)"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            directions = aglogen_core.generate_direction_grid(n_az, n_el)
            n_requested = n_az * (n_el - 2) + 2
            parameters = {"n_az": n_az, "n_el": n_el, "img_size": img_size}
        else:  # fibonacci
            n = request.data.get("n")
            if n is None:
                return Response(
                    {"detail": "mode=fibonacci requires 'n'"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                n = int(n)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "n must be an integer"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if n < 1:
                return Response(
                    {"detail": "n must be >= 1"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if n > 10000:
                return Response(
                    {"detail": "n must be <= 10000"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            directions = aglogen_core.generate_direction_fibonacci(n)
            n_requested = n
            parameters = {"n": n, "img_size": img_size}

        # --- Sync/async dispatch (R6): inclusive 200 on sync side ---
        # Wrap the render/queue path (post-validation) in a broad handler so
        # any downstream failure (Rust project_directions, matplotlib, ZIP
        # assembly, Celery broker) surfaces as a 400 with the exception
        # message instead of a 500 that loses context. Validation-stage
        # errors above stay as specific 400s.
        try:
            # Load geometry ONCE here so both sync and async paths can use
            # it without re-loading. Scale is computed PER-DIRECTION from
            # the 2D projected bbox (not the 3D AABB).
            coords, radii = self._load_geometry(simulation)

            # Stamp scale_factor_nm into parameters (constant per aggregate).
            scale_factor_nm = get_scale_factor_nm(simulation.parameters)
            parameters["scale_factor_nm"] = float(scale_factor_nm)

            if len(directions) <= 200:
                zip_bytes = self._render_and_zip_sync(
                    simulation,
                    directions,
                    mode,
                    n_requested,
                    parameters,
                    coords=coords,
                    radii=radii,
                    img_size=img_size,
                    scale_factor_nm=scale_factor_nm,
                )
                response = HttpResponse(zip_bytes, content_type="application/zip")
                response["Content-Disposition"] = (
                    f'attachment; filename="{simulation.id}_projections.zip"'
                )
                return response

            # Async path — enqueue Celery task
            from .tasks import build_projections_zip_task

            task = build_projections_zip_task.delay(
                str(simulation.id),
                mode,
                n_requested,
                list(directions),
                parameters,
            )
            return Response(
                {"job_id": task.id, "status": "queued"},
                status=status.HTTP_202_ACCEPTED,
            )
        except Exception as exc:
            logger.exception(
                "Projection export failed for simulation %s (mode=%s)",
                simulation.id,
                mode,
            )
            return Response(
                {"detail": f"Projection export failed: {exc!s}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def _render_and_zip_sync(
        self,
        simulation: Simulation,
        directions: list,
        mode: str,
        n_requested: int,
        parameters: dict,
        *,
        coords: np.ndarray | None = None,
        radii: np.ndarray | None = None,
        img_size: int = 512,
        scale_factor_nm: float | None = None,
    ) -> bytes:
        """Sync path: dual-render PNGs + per-direction scale, assemble ZIP.

        Uses ``render_projection_dual_png`` for each direction so the sync
        path (N ≤ 200) has full parity with the async Celery path:
        - Both presentation and scientific PNGs per direction
        - Per-direction ``pixels_per_100nm`` from 2D projected bbox
        - Global ``pixels_per_100nm`` = max(per-direction values)
        """
        from .services.projection import render_projection_dual_png

        if coords is None or radii is None:
            coords, radii = self._load_geometry(simulation)

        if scale_factor_nm is None:
            scale_factor_nm = get_scale_factor_nm(simulation.parameters)

        # directions may be a Rust-owned sequence — normalize to plain tuples
        directions_py = [(float(a), float(e)) for (a, e) in directions]

        pres_list: list[bytes] = []
        sci_list: list[bytes] = []
        per_direction_scale: list[float] = []

        for az, el in directions_py:
            pres, sci, bbox_w, bbox_h = render_projection_dual_png(
                positions=coords,
                radii=radii,
                azimuth=az,
                elevation=el,
                img_size=img_size,
            )
            pres_list.append(pres)
            sci_list.append(sci)

            # Per-direction scale from 2D bbox (same formula as async path)
            span_engine = max(bbox_w, bbox_h) * 1.04
            span_nm = span_engine * scale_factor_nm
            pix = 100.0 * float(img_size) / span_nm if span_nm > 0 else 0.0
            per_direction_scale.append(pix)

        return build_projection_zip(
            directions_py,
            pres_list,
            mode,
            n_requested,
            parameters,
            scientific_bytes_list=sci_list,
            per_direction_scale=per_direction_scale,
        )

    def _load_geometry(self, simulation: Simulation) -> tuple[np.ndarray, np.ndarray]:
        """Load geometry from simulation and return coordinates and radii."""
        buf = io.BytesIO(simulation.geometry)
        geometry_array = np.load(buf)
        # Use ascontiguousarray to ensure C-contiguous memory layout for Rust/PyO3
        coords = np.ascontiguousarray(geometry_array[:, :3])
        radii = np.ascontiguousarray(geometry_array[:, 3])
        return coords, radii

    @action(detail=True, methods=["get"], url_path="export")
    def export_csv(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Export agglomerate properties and particle data as CSV.

        Returns a CSV file with:
        - Agglomerate properties (Df, kf, Rg, porosity, shape analysis, etc.)
        - Per-particle data (coordinates, radius, coordination, distance from CDG)
        """
        simulation = self.get_object()

        if simulation.geometry is None or simulation.metrics is None:
            return Response(
                {"error": "Simulation data not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Load geometry
        coords, radii = self._load_geometry(simulation)
        n_particles = len(coords)

        # Calculate centers
        center_of_gravity = coords.mean(axis=0)
        geom_min = coords.min(axis=0)
        geom_max = coords.max(axis=0)
        geometrical_center = (geom_min + geom_max) / 2

        # Calculate distances from center of gravity
        distances_from_cdg = np.linalg.norm(
            coords - center_of_gravity, axis=2 if coords.ndim > 2 else 1
        )
        distance_order = np.argsort(distances_from_cdg) + 1  # 1-based ranking

        # Calculate per-particle coordination numbers
        coordination_numbers = self._calculate_coordination_numbers(coords, radii)

        # Create CSV with user-preferred delimiter + decimal (T15). Anonymous
        # or test-bypass callers fall through to US defaults (",", ".").
        decimal, delimiter = _get_user_csv_locale(request)
        output = io.StringIO()
        writer = csv.writer(output, delimiter=delimiter)

        def wrow(row: list[Any]) -> None:
            """Row-writer closure that applies decimal localization once."""
            _write_localized_row(writer, row, decimal)

        # Scale factor for Rg: engine emits a dimensionless value; every read
        # boundary multiplies by diameter/2 to display in nm. The shim handles
        # both v1 (primary_particle_radius_nm) and v2 (primary_particle_diameter_nm).
        # The same scale converts per-particle engine radii to nm for the new
        # ``Radius (nm)`` row and the ``radius_nm`` particle column (T15).
        rg_scale_nm = get_scale_factor_nm(simulation.parameters)
        rg_nm = simulation.metrics.get("radius_of_gyration", 0) * rg_scale_nm

        # Section 1: Agglomerate Properties
        wrow(["# AGGLOMERATE PROPERTIES"])
        wrow(["Property", "Value", "Unit"])
        wrow(["Simulation ID", str(simulation.id), ""])
        wrow(["Algorithm", simulation.algorithm, ""])
        wrow(["Number of Particles", n_particles, ""])
        wrow(
            [
                "Fractal Dimension (Df)",
                f"{simulation.metrics.get('fractal_dimension', 0):.4f}",
                "",
            ]
        )
        wrow(
            [
                "Df Std. Dev.",
                f"{simulation.metrics.get('fractal_dimension_std', 0):.4f}",
                "",
            ]
        )
        wrow(["Prefactor (kf)", f"{simulation.metrics.get('prefactor', 0):.4f}", ""])
        wrow(
            [
                "Radius of Gyration (Rg)",
                f"{rg_nm:.4f}",
                "nm",
            ]
        )
        wrow(["Porosity", f"{simulation.metrics.get('porosity', 0):.4f}", ""])
        wrow(
            [
                "Coordination Mean",
                f"{simulation.metrics.get('coordination', {}).get('mean', 0):.4f}",
                "",
            ]
        )
        wrow(
            [
                "Coordination Std. Dev.",
                f"{simulation.metrics.get('coordination', {}).get('std', 0):.4f}",
                "",
            ]
        )
        wrow([])

        # Shape Analysis
        wrow(["# SHAPE ANALYSIS (Inertia Tensor)"])
        wrow(["Property", "Value", "Unit"])
        wrow(
            [
                "Anisotropy (Imax/Imin)",
                f"{simulation.metrics.get('anisotropy', 0):.4f}",
                "",
            ]
        )
        wrow(["Asphericity", f"{simulation.metrics.get('asphericity', 0):.6f}", ""])
        wrow(["Acylindricity", f"{simulation.metrics.get('acylindricity', 0):.6f}", ""])
        moments = simulation.metrics.get("principal_moments", [0, 0, 0])
        wrow(["Principal Moment I1 (min)", f"{moments[0]:.4f}", ""])
        wrow(["Principal Moment I2", f"{moments[1]:.4f}", ""])
        wrow(["Principal Moment I3 (max)", f"{moments[2]:.4f}", ""])
        wrow([])

        # Centers
        wrow(["# GEOMETRIC CENTERS"])
        wrow(["Property", "X", "Y", "Z"])
        wrow(
            [
                "Center of Gravity",
                f"{center_of_gravity[0]:.6f}",
                f"{center_of_gravity[1]:.6f}",
                f"{center_of_gravity[2]:.6f}",
            ]
        )
        wrow(
            [
                "Geometrical Center",
                f"{geometrical_center[0]:.6f}",
                f"{geometrical_center[1]:.6f}",
                f"{geometrical_center[2]:.6f}",
            ]
        )
        wrow([])

        # Section 2: Particle Data. The new ``radius_nm`` column (T15) is
        # additive — the legacy dimensionless ``Radius`` column stays in
        # place so downstream scripts that parse by index don't break.
        wrow(["# PARTICLE DATA"])
        wrow(
            [
                "Particle #",
                "X",
                "Y",
                "Z",
                "Radius",
                "radius_nm",
                "Coordination #",
                "Distance from CDG",
                "Distance Rank",
            ]
        )

        for i in range(n_particles):
            dist = distances_from_cdg[i]
            rank = (
                np.where(distance_order == i + 1)[0][0] + 1
            )  # Find rank for this particle
            radius_nm_cell = float(radii[i]) * rg_scale_nm
            wrow(
                [
                    i + 1,  # 1-based particle number (depositional order)
                    f"{coords[i, 0]:.6f}",
                    f"{coords[i, 1]:.6f}",
                    f"{coords[i, 2]:.6f}",
                    f"{radii[i]:.6f}",
                    f"{radius_nm_cell:.6f}",
                    coordination_numbers[i],
                    f"{dist:.6f}",
                    rank,
                ]
            )

        # Section 3: Coordination per-particle (from cached metrics)
        wrow([])
        wrow(["# section: coordination_per_particle"])
        wrow(["particle_id", "n_contacts", "contact_neighbors"])

        coord_metrics = simulation.metrics.get("coordination", {})
        per_particle = coord_metrics.get("per_particle", [])
        for p in per_particle:
            neighbors_str = ";".join(str(n) for n in p.get("contact_neighbors", []))
            wrow([p.get("particle_id", ""), p.get("n_contacts", 0), neighbors_str])

        # Section 4: Coordination distribution histogram
        wrow([])
        wrow(["# section: coordination_distribution"])
        wrow(["coordination", "count"])

        distribution = coord_metrics.get("distribution", {})
        for coord_num in sorted(distribution.keys(), key=lambda k: int(k)):
            wrow([coord_num, distribution[coord_num]])

        # Return CSV response
        output.seek(0)
        response = HttpResponse(output.read(), content_type="text/csv")
        response["Content-Disposition"] = (
            f'attachment; filename="{simulation.id}_export.csv"'
        )
        return response

    def _calculate_coordination_numbers(
        self, coords: np.ndarray, radii: np.ndarray, tolerance: float = 0.01
    ) -> np.ndarray:
        """Calculate coordination number (number of touching neighbors) for each particle.

        Two particles are considered neighbors if their surfaces are within `tolerance`
        of touching (distance <= r1 + r2 + tolerance * min_radius).
        """
        n = len(coords)
        coordination = np.zeros(n, dtype=int)

        for i in range(n):
            for j in range(i + 1, n):
                dist = np.linalg.norm(coords[i] - coords[j])
                touch_dist = radii[i] + radii[j]
                # Allow small tolerance for numerical precision
                if dist <= touch_dist * (1 + tolerance):
                    coordination[i] += 1
                    coordination[j] += 1

        return coordination

    def _calculate_adjacency_graph(
        self, coords: np.ndarray, radii: np.ndarray, tolerance: float = 0.01
    ) -> list[list[int]]:
        """Calculate adjacency list for particle neighbor graph.

        Returns a list where each index i contains a list of neighbor indices for particle i.

        Two particles are considered neighbors if they are in contact:
        - Particles touching at r1+r2 (no sintering)
        - Particles overlapping at < r1+r2 (sintered contacts)

        The tolerance parameter (default 1%) adds a small buffer above contact
        distance to account for numerical precision.
        """
        n = len(coords)
        adjacency = [[] for _ in range(n)]

        for i in range(n):
            for j in range(i + 1, n):
                dist = np.linalg.norm(coords[i] - coords[j])
                contact_dist = radii[i] + radii[j]
                # Detect touching or overlapping (sintered) particles
                if dist <= contact_dist * (1 + tolerance):
                    adjacency[i].append(j)
                    adjacency[j].append(i)

        return adjacency

    @action(detail=True, methods=["get"], url_path="neighbor-graph")
    def neighbor_graph(self, request: Request, pk=None, **kwargs) -> Response:
        """Get particle neighbor/adjacency graph.

        Returns the graph structure showing which particles are connected (touching).
        Useful for topological analysis and fingerprinting.

        Performance: uses cached per_particle data from metrics when available
        (stored during run_simulation_task). Falls back to recomputation for
        legacy sims that only have {mean, std}.
        """
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Load geometry (always needed for coords/radii in node properties)
        coords, radii = self._load_geometry(simulation)
        n_particles = len(coords)

        # ── Cache check: use per_particle from metrics if available ───
        cached_per_particle = (
            simulation.metrics.get("coordination", {}).get("per_particle")
            if simulation.metrics
            else None
        )

        if cached_per_particle:
            # Build adjacency from cached per_particle (cache hit path)
            adjacency = [[] for _ in range(n_particles)]
            for entry in cached_per_particle:
                pid = entry["particle_id"]
                if pid < n_particles:
                    adjacency[pid] = entry.get("contact_neighbors", [])
        else:
            # Fallback: recompute adjacency graph (legacy sim path)
            adjacency = self._calculate_adjacency_graph(coords, radii)

        # Build graph data structure for visualization
        # Nodes: particles with their properties
        # Edges: connections between touching particles
        nodes = []
        edges = []
        edge_set = set()  # To avoid duplicate edges

        # Calculate center of gravity for distance metrics
        center_of_gravity = coords.mean(axis=0)

        for i in range(n_particles):
            dist_from_cdg = float(np.linalg.norm(coords[i] - center_of_gravity))
            nodes.append(
                {
                    "id": i + 1,  # 1-based ID (depositional order)
                    "x": float(coords[i, 0]),
                    "y": float(coords[i, 1]),
                    "z": float(coords[i, 2]),
                    "radius": float(radii[i]),
                    "coordination": len(adjacency[i]),
                    "distance_from_cdg": dist_from_cdg,
                }
            )

            # Add edges (avoiding duplicates)
            for j in adjacency[i]:
                edge_key = tuple(sorted([i, j]))
                if edge_key not in edge_set:
                    edge_set.add(edge_key)
                    edges.append(
                        {
                            "source": i + 1,  # 1-based
                            "target": j + 1,  # 1-based
                        }
                    )

        # Calculate graph statistics
        coordination_numbers = [len(adj) for adj in adjacency]
        stats = {
            "n_particles": n_particles,
            "n_edges": len(edges),
            "avg_coordination": float(np.mean(coordination_numbers))
            if coordination_numbers
            else 0,
            "max_coordination": max(coordination_numbers)
            if coordination_numbers
            else 0,
            "min_coordination": min(coordination_numbers)
            if coordination_numbers
            else 0,
            # Graph connectivity metrics
            "is_connected": self._is_graph_connected(adjacency),
        }

        return Response(
            {
                "nodes": nodes,
                "edges": edges,
                "stats": stats,
            }
        )

    def _is_graph_connected(self, adjacency: list[list[int]]) -> bool:
        """Check if the graph is fully connected using BFS."""
        if not adjacency:
            return True

        n = len(adjacency)
        visited = [False] * n
        queue = [0]
        visited[0] = True
        count = 1

        while queue:
            node = queue.pop(0)
            for neighbor in adjacency[node]:
                if not visited[neighbor]:
                    visited[neighbor] = True
                    queue.append(neighbor)
                    count += 1

        return count == n

    @action(detail=True, methods=["get"], url_path="box-counting")
    def box_counting(self, request: Request, pk=None, **kwargs) -> Response:
        """Run 3D box-counting fractal analysis on the agglomerate.

        Uses Morton codes (Z-order curve) for O(N log N) complexity.

        Query params:
        - points_per_sphere: int (default: 100) - surface points per particle
        - precision: int (default: 18) - bits per dimension (max: 21)

        Returns fractal dimension estimate with statistics and log-log data.
        """
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Parse parameters
        try:
            points_per_sphere = int(request.query_params.get("points_per_sphere", 100))
            precision = int(request.query_params.get("precision", 18))
        except (ValueError, TypeError) as e:
            return Response(
                {"error": f"Invalid parameter: {e}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate ranges
        if not (10 <= points_per_sphere <= 1000):
            return Response(
                {"error": "points_per_sphere must be between 10 and 1000"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (8 <= precision <= 21):
            return Response(
                {"error": "precision must be between 8 and 21"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Load geometry
        coords, radii = self._load_geometry(simulation)

        # Run box-counting analysis
        import aglogen_core

        result = aglogen_core.box_counting_agglomerate(
            coords,
            radii,
            points_per_sphere=points_per_sphere,
            precision=precision,
        )

        return Response(
            {
                "dimension": result.dimension,
                "r_squared": result.r_squared,
                "std_error": result.std_error,
                "confidence_interval": list(result.confidence_interval),
                "log_scales": result.log_scales.tolist(),
                "log_values": result.log_values.tolist(),
                "residuals": result.residuals.tolist(),
                "linear_region_start": result.linear_region_start,
                "execution_time_ms": result.execution_time_ms,
                "parameters": {
                    "points_per_sphere": points_per_sphere,
                    "precision": precision,
                    "n_particles": len(coords),
                },
            }
        )

    @action(detail=True, methods=["post"], url_path="optical")
    def optical(self, request: Request, pk=None, **kwargs) -> Response:
        """Calculate optical properties using T-Matrix or DDA method.

        POST body:
        {
            "method": "tmatrix" or "dda",
            "wavelength": 550.0,           // nm (default: 550)
            "refractive_index_n": 1.95,    // real part (default: 1.95 for soot)
            "refractive_index_k": 0.79,    // imaginary part (default: 0.79 for soot)
            "medium_index": 1.0,           // surrounding medium (default: 1.0 for air)
            // DDA-specific:
            "dipoles_per_wavelength": 10.0 // (default: 10)
        }
        """
        import aglogen_core

        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Parse parameters
        method = request.data.get("method", "tmatrix").lower()
        if method not in ("tmatrix", "dda"):
            return Response(
                {"error": "Method must be 'tmatrix' or 'dda'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            wavelength = float(request.data.get("wavelength", 550.0))
            refractive_index_n = float(request.data.get("refractive_index_n", 1.95))
            refractive_index_k = float(request.data.get("refractive_index_k", 0.79))
            medium_index = float(request.data.get("medium_index", 1.0))
            dipoles_per_wavelength = float(
                request.data.get("dipoles_per_wavelength", 10.0)
            )
        except (ValueError, TypeError) as e:
            return Response(
                {"error": f"Invalid numeric parameter: {e}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate ranges
        if not (100 <= wavelength <= 2000):
            return Response(
                {"error": "Wavelength must be between 100 and 2000 nm"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (1.0 <= refractive_index_n <= 4.0):
            return Response(
                {"error": "Refractive index (n) must be between 1.0 and 4.0"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (0.0 <= refractive_index_k <= 5.0):
            return Response(
                {"error": "Refractive index (k) must be between 0.0 and 5.0"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Load geometry
        coords, radii = self._load_geometry(simulation)

        # Flatten coordinates for the API (expects 1D array)
        coords_flat = coords.flatten()

        logger.info(
            f"Running {method.upper()} optical calculation for simulation {simulation.id} "
            f"with {len(radii)} particles at λ={wavelength}nm"
        )

        try:
            if method == "tmatrix":
                result = aglogen_core.run_tmatrix(
                    coordinates=coords_flat,
                    radii=radii,
                    wavelength=wavelength,
                    refractive_index_n=refractive_index_n,
                    refractive_index_k=refractive_index_k,
                    medium_index=medium_index,
                    orientation_averaging=False,
                    n_angles=181,
                )
            else:  # DDA
                result = aglogen_core.run_dda(
                    coordinates=coords_flat,
                    radii=radii,
                    wavelength=wavelength,
                    refractive_index_n=refractive_index_n,
                    refractive_index_k=refractive_index_k,
                    medium_index=medium_index,
                    dipoles_per_wavelength=dipoles_per_wavelength,
                )

            # Build response
            optical_results = {
                "method": method,
                "wavelength": wavelength,
                "refractive_index": {"n": refractive_index_n, "k": refractive_index_k},
                "medium_index": medium_index,
                "c_ext": float(result.c_ext),
                "c_sca": float(result.c_sca),
                "c_abs": float(result.c_abs),
                "q_ext": float(result.q_ext),
                "q_sca": float(result.q_sca),
                "q_abs": float(result.q_abs),
                "asymmetry_g": float(result.asymmetry_g),
                "single_scatter_albedo": float(result.single_scatter_albedo),
            }

            # Store in simulation metrics
            metrics = simulation.metrics or {}
            metrics["optical"] = optical_results
            simulation.metrics = metrics
            simulation.save(update_fields=["metrics"])

            logger.info(
                f"Optical calculation for {simulation.id} completed: "
                f"Cext={result.c_ext:.4e}, Csca={result.c_sca:.4e}"
            )

            return Response(optical_results)

        except Exception as e:
            logger.error(f"Optical calculation failed: {e}")
            return Response(
                {"error": f"Optical calculation failed: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class ParametricStudyViewSet(viewsets.ModelViewSet):
    """ViewSet for ParametricStudy CRUD operations."""

    queryset = ParametricStudy.objects.select_related("project").prefetch_related(
        "simulations"
    )
    serializer_class = ParametricStudySerializer
    permission_classes = [IsAuthenticated, IsProjectOwnerOrShared]

    def get_queryset(self):
        """Filter studies by project if project_id in URL."""
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_pk")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset

    def perform_create(self, serializer):
        """Create study and generate all simulations from parameter grid.

        Handles:
        - Regular grid combinations
        - Limiting cases (range boundaries + theoretical extremes)
        - Sintering configuration (fixed/uniform/normal distributions)
        - Sintering extremes when limiting cases enabled
        """
        import itertools
        import random

        from .utils import (
            apply_sintering_config,
            generate_limiting_cases,
            generate_simulation_name,
            generate_sintering_extreme_cases,
        )

        project_id = self.kwargs.get("project_pk")
        study = serializer.save(project_id=project_id, status=SimulationStatus.RUNNING)

        # Generate parameter combinations from grid
        param_names = list(study.parameter_grid.keys())
        param_values = [study.parameter_grid[name] for name in param_names]

        # Create all combinations
        combinations = list(itertools.product(*param_values))

        # Parameters that must be integers
        integer_params = {"n_particles"}

        simulations_created = []

        def create_simulation(
            params: dict, case_type: str = "grid", case_label: str = ""
        ) -> None:
            """Create a single simulation with all configurations applied."""
            sim_params = dict(params)

            # Apply sintering config if present
            sim_params = apply_sintering_config(sim_params, study.sintering_config)

            # Ensure integer parameters are properly typed
            for param_name in integer_params:
                if param_name in sim_params:
                    sim_params[param_name] = int(sim_params[param_name])

            for seed_idx in range(study.seeds_per_combination):
                seed = random.randint(0, 2**31 - 1)

                # Generate name including case type info
                suffix = f"({case_type}: {case_label})" if case_label else ""
                auto_name = generate_simulation_name(
                    study.base_algorithm, suffix=suffix
                )

                sim = Simulation.objects.create(
                    project_id=project_id,
                    algorithm=study.base_algorithm,
                    parameters=sim_params,
                    seed=seed,
                    name=auto_name,
                    status=SimulationStatus.QUEUED,
                    is_batch=True,
                )
                simulations_created.append(sim)
                study.simulations.add(sim)

                # Queue the task
                try:
                    result = run_simulation_task.delay(str(sim.id))
                    sim.task_id = result.id
                    sim.save(update_fields=["task_id"])
                except Exception as e:
                    logger.warning(f"Failed to queue simulation {sim.id}: {e}")

        # 1. Regular grid combinations
        for combo in combinations:
            params = dict(study.base_parameters)
            for i, name in enumerate(param_names):
                params[name] = combo[i]
            combo_str = ", ".join(
                f"{name}={combo[i]}" for i, name in enumerate(param_names)
            )
            create_simulation(params, "grid", combo_str)

        # 2. Limiting cases (if enabled)
        if study.include_limiting_cases:
            limiting_cases = generate_limiting_cases(
                study.base_parameters,
                study.parameter_grid,
                study.base_algorithm,
                study.limiting_cases_config,
            )

            for case_type, description, params in limiting_cases:
                create_simulation(params, case_type, description)

            # 3. Sintering extremes (if limiting cases AND sintering enabled)
            if study.sintering_config:
                sintering_cases = generate_sintering_extreme_cases(
                    study.base_parameters
                )
                for case_type, description, params in sintering_cases:
                    # Don't apply the study's sintering config for extreme cases
                    # since they define their own sintering
                    sim_params = dict(params)
                    for param_name in integer_params:
                        if param_name in sim_params:
                            sim_params[param_name] = int(sim_params[param_name])

                    for seed_idx in range(study.seeds_per_combination):
                        seed = random.randint(0, 2**31 - 1)
                        suffix = f"({case_type}: {description})"
                        auto_name = generate_simulation_name(
                            study.base_algorithm, suffix=suffix
                        )

                        sim = Simulation.objects.create(
                            project_id=project_id,
                            algorithm=study.base_algorithm,
                            parameters=sim_params,
                            seed=seed,
                            name=auto_name,
                            status=SimulationStatus.QUEUED,
                            is_batch=True,
                        )
                        simulations_created.append(sim)
                        study.simulations.add(sim)

                        try:
                            result = run_simulation_task.delay(str(sim.id))
                            sim.task_id = result.id
                            sim.save(update_fields=["task_id"])
                        except Exception as e:
                            logger.warning(f"Failed to queue simulation {sim.id}: {e}")

        logger.info(
            f"Created parametric study {study.id} with {len(simulations_created)} simulations"
        )

    def perform_destroy(self, instance):
        """Delete study and all associated simulations."""
        # Delete all simulations associated with this study
        simulations = instance.simulations.all()
        count = simulations.count()
        simulations.delete()
        logger.info(
            f"Deleted parametric study {instance.id} and {count} associated simulations"
        )
        instance.delete()

    @action(detail=True, methods=["get"])
    def results(self, request: Request, pk=None, **kwargs) -> Response:
        """Get aggregated results table for study."""
        study = self.get_object()
        simulations = study.simulations.all().order_by("created_at")

        results = []
        for sim in simulations:
            result_data = {
                "simulation_id": str(sim.id),
                "status": sim.status,
                "parameters": sim.parameters,
                "seed": sim.seed,
                "execution_time_ms": sim.execution_time_ms,
            }
            if sim.metrics:
                result_data.update(
                    {
                        "fractal_dimension": sim.metrics.get("fractal_dimension"),
                        "fractal_dimension_std": sim.metrics.get(
                            "fractal_dimension_std"
                        ),
                        "prefactor": sim.metrics.get("prefactor"),
                        "radius_of_gyration": sim.metrics.get("radius_of_gyration"),
                        "porosity": sim.metrics.get("porosity"),
                        "coordination_mean": sim.metrics.get("coordination", {}).get(
                            "mean"
                        ),
                        "coordination_std": sim.metrics.get("coordination", {}).get(
                            "std"
                        ),
                        "anisotropy": sim.metrics.get("anisotropy"),
                        "asphericity": sim.metrics.get("asphericity"),
                        "acylindricity": sim.metrics.get("acylindricity"),
                        "box_counting": sim.metrics.get("box_counting"),
                    }
                )
            results.append(result_data)

        # Calculate study status based on simulations
        total = study.simulations.count()
        completed = study.simulations.filter(status="completed").count()
        failed = study.simulations.filter(status="failed").count()
        running = study.simulations.filter(status__in=["queued", "running"]).count()

        return Response(
            {
                "study_id": str(study.id),
                "name": study.name,
                "description": study.description,
                "base_algorithm": study.base_algorithm,
                "base_parameters": study.base_parameters,
                "parameter_grid": study.parameter_grid,
                "status": "completed" if running == 0 else "running",
                "progress": {
                    "total": total,
                    "completed": completed,
                    "failed": failed,
                    "running": running,
                },
                "results": results,
            }
        )

    @staticmethod
    def _compute_coord_mode(metrics: dict) -> int:
        """Compute coordination mode from distribution (smallest if multimodal)."""
        distribution = metrics.get("coordination", {}).get("distribution", {})
        if not distribution:
            return 0
        max_count = max(distribution.values())
        if max_count == 0:
            return 0
        modes = [int(k) for k, v in distribution.items() if v == max_count]
        return min(modes)  # R6 contract: smallest of modes

    @staticmethod
    def _compute_coord_max(metrics: dict) -> int:
        """Compute maximum coordination number from distribution."""
        distribution = metrics.get("coordination", {}).get("distribution", {})
        if not distribution:
            return 0
        # Find highest coordination with count > 0
        nonzero = [int(k) for k, v in distribution.items() if v > 0]
        return max(nonzero) if nonzero else 0

    @action(detail=True, methods=["get"], url_path="export")
    def export_csv(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Export batch study results as CSV.

        Includes:
        - Base simulation data and metrics
        - Sintering columns if sintering_config is set
        - Box-counting columns if include_box_counting is enabled
        - Coordination columns: Coord_Mode and Coord_Max (appended at end)
        """
        study = self.get_object()
        simulations = study.simulations.filter(status="completed").order_by(
            "created_at"
        )

        # Apply user CSV locale prefs (T16). Anonymous callers and fixtures
        # that don't set profile fields fall through to US defaults.
        decimal, delimiter = _get_user_csv_locale(request)
        output = io.StringIO()
        writer = csv.writer(output, delimiter=delimiter)

        def wrow(row: list[Any]) -> None:
            _write_localized_row(writer, row, decimal)

        # Determine all parameter keys from the grid
        param_keys = list(study.parameter_grid.keys())

        # Build header row. Rg and primary-particle radius are both in nm at
        # the read boundary via the schema-v1/v2 shim; the column names carry
        # the unit so consumers can identify them without a separate Unit
        # column. ``radius_nm`` (T16) is the per-row primary-particle radius
        # (``diameter/2``) — additive, per-sim scaling.
        header = (
            ["Simulation ID", "Name", "Seed"]
            + param_keys
            + [
                "Df",
                "Df_std",
                "kf",
                "Rg_nm",
                "radius_nm",
                "Porosity",
                "Coord_Mean",
                "Coord_Std",
                "Anisotropy",
                "Asphericity",
                "Acylindricity",
                "Execution_ms",
                "Coord_Mode",
                "Coord_Max",
            ]
        )

        # Add sintering columns if configured
        if study.sintering_config:
            header.extend(["Sintering_Type", "Sintering_Coeff"])

        # Add box-counting columns if enabled
        if study.include_box_counting:
            header.extend(["BC_Df", "BC_R2", "BC_StdError", "BC_Time_ms"])

        wrow(header)

        # Data rows
        for sim in simulations:
            if sim.metrics:
                # Per-row nm scaling: shim resolves v1 vs v2 per sim so a
                # mixed-version batch produces correct values throughout.
                rg_scale_nm = get_scale_factor_nm(sim.parameters)
                rg_nm = sim.metrics.get("radius_of_gyration", 0) * rg_scale_nm
                # radius_nm = diameter / 2 = scale factor. Matches verify-rg
                # convention where ``Rg_nm = Rg_engine * scale_factor_nm``.
                radius_nm = rg_scale_nm
                row = (
                    [
                        str(sim.id),
                        sim.name or "",
                        sim.seed,
                    ]
                    + [sim.parameters.get(key, "") for key in param_keys]
                    + [
                        f"{sim.metrics.get('fractal_dimension', 0):.4f}",
                        f"{sim.metrics.get('fractal_dimension_std', 0):.4f}",
                        f"{sim.metrics.get('prefactor', 0):.4f}",
                        f"{rg_nm:.4f}",
                        f"{radius_nm:.4f}",
                        f"{sim.metrics.get('porosity', 0):.4f}",
                        f"{sim.metrics.get('coordination', {}).get('mean', 0):.4f}",
                        f"{sim.metrics.get('coordination', {}).get('std', 0):.4f}",
                        f"{sim.metrics.get('anisotropy', 0):.4f}",
                        f"{sim.metrics.get('asphericity', 0):.6f}",
                        f"{sim.metrics.get('acylindricity', 0):.6f}",
                        sim.execution_time_ms or 0,
                        # Coord_Mode: smallest of modes if multimodal (R6 contract)
                        self._compute_coord_mode(sim.metrics),
                        self._compute_coord_max(sim.metrics),
                    ]
                )

                # Add sintering data if configured
                if study.sintering_config:
                    row.extend(
                        [
                            sim.parameters.get("sintering_type", "fixed"),
                            f"{sim.parameters.get('sintering_coeff', 1.0):.3f}",
                        ]
                    )

                # Add box-counting data if enabled
                if study.include_box_counting:
                    bc = sim.metrics.get("box_counting", {})
                    row.extend(
                        [
                            f"{bc.get('dimension', 0):.4f}",
                            f"{bc.get('r_squared', 0):.4f}",
                            f"{bc.get('std_error', 0):.6f}",
                            bc.get("execution_time_ms", 0),
                        ]
                    )

                wrow(row)

        output.seek(0)
        response = HttpResponse(output.read(), content_type="text/csv")
        response["Content-Disposition"] = (
            f'attachment; filename="{study.id}_results.csv"'
        )
        return response

    @action(detail=True, methods=["post"], url_path="run-box-counting")
    def run_box_counting(self, request: Request, pk=None, **kwargs) -> Response:
        """Run box-counting analysis on all completed simulations in the study.

        This can be used to run box-counting after simulations are complete,
        even if include_box_counting was not enabled initially.

        Request body (optional):
        - points_per_sphere: int (default: 100)
        - precision: int (default: 18)

        Returns progress and results summary.
        """
        from .tasks import run_box_counting_if_configured
        import aglogen_core

        study = self.get_object()

        # Get parameters from request
        points_per_sphere = request.data.get("points_per_sphere", 100)
        precision = request.data.get("precision", 18)

        # Validate
        try:
            points_per_sphere = int(points_per_sphere)
            precision = int(precision)
        except (ValueError, TypeError):
            return Response(
                {"error": "Invalid parameters"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not (10 <= points_per_sphere <= 1000):
            return Response(
                {"error": "points_per_sphere must be between 10 and 1000"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (8 <= precision <= 21):
            return Response(
                {"error": "precision must be between 8 and 21"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Update study to enable box-counting for future reference
        study.include_box_counting = True
        study.box_counting_params = {
            "points_per_sphere": points_per_sphere,
            "precision": precision,
        }
        study.save(update_fields=["include_box_counting", "box_counting_params"])

        # Get completed simulations without box-counting results
        simulations = study.simulations.filter(
            status="completed",
            geometry__isnull=False,
        )

        results = {
            "total": simulations.count(),
            "processed": 0,
            "skipped": 0,
            "failed": 0,
            "errors": [],
        }

        for sim in simulations:
            # Check if already has box-counting
            if sim.metrics and sim.metrics.get("box_counting"):
                results["skipped"] += 1
                continue

            try:
                # Load geometry
                buf = io.BytesIO(sim.geometry)
                geometry_array = np.load(buf)
                coords = np.ascontiguousarray(geometry_array[:, :3])
                radii = np.ascontiguousarray(geometry_array[:, 3])

                # Run box-counting
                bc_result = aglogen_core.box_counting_agglomerate(
                    coords,
                    radii,
                    points_per_sphere=points_per_sphere,
                    precision=precision,
                )

                # Update metrics
                metrics = sim.metrics or {}
                metrics["box_counting"] = {
                    "dimension": float(bc_result.dimension),
                    "r_squared": float(bc_result.r_squared),
                    "std_error": float(bc_result.std_error),
                    "confidence_interval": list(bc_result.confidence_interval),
                    "log_scales": bc_result.log_scales.tolist(),
                    "log_values": bc_result.log_values.tolist(),
                    "execution_time_ms": int(bc_result.execution_time_ms),
                    "parameters": {
                        "points_per_sphere": points_per_sphere,
                        "precision": precision,
                    },
                }
                sim.metrics = metrics
                sim.save(update_fields=["metrics"])
                results["processed"] += 1

            except Exception as e:
                results["failed"] += 1
                results["errors"].append(
                    {
                        "simulation_id": str(sim.id),
                        "error": str(e),
                    }
                )

        return Response(
            {
                "status": "completed",
                "message": f"Box-counting completed: {results['processed']} processed, "
                f"{results['skipped']} skipped (already done), {results['failed']} failed",
                "results": results,
            }
        )

    @action(detail=True, methods=["post"], url_path="export-projections")
    def export_projections(self, request: Request, pk=None, **kwargs) -> Response:
        """Batch export projections for multiple simulations in a study.

        POST body:
        {
            "simulation_ids": ["uuid1", "uuid2", ...],
            "mode": "grid" | "fibonacci" | "legacy",
            "config": { mode-specific params }
        }

        Returns 202 with {job_id, status: "queued", total_sims}.
        """
        serializer = BatchProjectionExportRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        sim_ids = [str(uid) for uid in data["simulation_ids"]]
        mode = data["mode"]
        config = data["config"]

        # Validate sim IDs belong to this study
        study = self.get_object()
        study_sim_ids = set(
            str(sid) for sid in study.simulations.values_list("id", flat=True)
        )
        foreign = [sid for sid in sim_ids if sid not in study_sim_ids]
        if foreign:
            return Response(
                {"detail": f"Some simulation_ids do not belong to study {study.id}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Dispatch async task
        from .tasks import build_batch_projections_zip

        task = build_batch_projections_zip.delay(
            study_id=str(study.id),
            simulation_ids=sim_ids,
            mode=mode,
            config=config,
        )

        return Response(
            {
                "job_id": task.id,
                "status": "queued",
                "total_sims": len(sim_ids),
            },
            status=status.HTTP_202_ACCEPTED,
        )


# ============================================================================
# Projection async polling + download (R6)
# ============================================================================

from celery.result import AsyncResult  # noqa: E402
from rest_framework.decorators import api_view, permission_classes  # noqa: E402


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def projections_status_view(request: Request, job_id: str) -> Response:
    """GET /api/v1/projections-status/{job_id}/

    Polling endpoint for async projection ZIP builds (R6). Maps Celery
    ``AsyncResult`` state transitions onto the contract shape:

    - ``processing`` — job is pending or mid-render. Includes ``progress``
      (0.0..1.0), ``current`` (projections rendered), and ``total`` fields
      so the UI can drive a progress bar.
    - ``done`` — ZIP is ready. Includes ``download_url`` that points at
      :func:`projections_download_view` for the same ``job_id``.
    - ``failed`` — task raised. Includes ``error`` with the exception text.

    Unknown / never-dispatched job IDs surface as ``processing`` (Celery's
    default ``PENDING`` state) rather than 404 — matches Celery semantics
    where "we don't know this ID" is indistinguishable from "just queued".
    """
    result = AsyncResult(job_id)
    state = result.state

    if state == "PENDING":
        return Response(
            {"status": "processing", "progress": 0.0, "current": 0, "total": 0}
        )
    if state == "PROGRESS":
        meta = result.info if isinstance(result.info, dict) else {}
        resp = {
            "status": "processing",
            "progress": float(meta.get("progress", 0.0)),
            "current": int(meta.get("current", 0)),
            "total": int(meta.get("total", 0)),
        }
        # Batch-specific: surface current_sim_id when present (backward compat:
        # single-sim consumers ignore unknown fields)
        if "current_sim_id" in meta:
            resp["current_sim_id"] = meta["current_sim_id"]
        else:
            resp["current_sim_id"] = None
        return Response(resp)
    if state == "SUCCESS":
        data = result.result if isinstance(result.result, dict) else {}
        return Response(
            {
                "status": "done",
                "download_url": data.get("download_url", ""),
            }
        )
    if state == "FAILURE":
        return Response(
            {
                "status": "failed",
                "error": str(result.info)
                if result.info is not None
                else "Unknown error",
            }
        )
    # Retry / revoked / other lesser-known states fall through here.
    return Response({"status": str(state).lower(), "progress": 0.0})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def projections_download_view(request: Request, job_id: str) -> HttpResponse:
    """GET /api/v1/projections-status/{job_id}/download/

    Streams the completed ZIP back to the client. Reads the ZIP path out
    of the Celery task's success payload (same ``AsyncResult.result`` dict
    surfaced by :func:`projections_status_view`) and serves the file with
    ``application/zip``.
    """
    result = AsyncResult(job_id)
    if result.state != "SUCCESS":
        return Response(
            {"detail": f"Job {job_id} is not complete (state={result.state})"},
            status=status.HTTP_404_NOT_FOUND,
        )

    data = result.result if isinstance(result.result, dict) else {}
    zip_path = data.get("zip_path")
    if not zip_path:
        return Response(
            {"detail": "Completed job has no stored ZIP path"},
            status=status.HTTP_404_NOT_FOUND,
        )

    import os

    if not os.path.exists(zip_path):
        return Response(
            {"detail": "ZIP file missing on disk"},
            status=status.HTTP_404_NOT_FOUND,
        )

    with open(zip_path, "rb") as fp:
        zip_bytes = fp.read()

    # Use download_filename from result dict if present (batch export),
    # fall back to projections_{job_id}.zip (single-sim, backward compat)
    filename = data.get("download_filename", f"projections_{job_id}.zip")

    response = HttpResponse(zip_bytes, content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
