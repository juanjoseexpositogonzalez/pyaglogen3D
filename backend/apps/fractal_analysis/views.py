"""Fractal Analysis views."""

import logging
import uuid

import numpy as np
from django.conf import settings
from django.http import HttpResponse
from kombu.exceptions import OperationalError
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.permissions import IsProjectOwnerOrShared

from .models import ComparisonSet, FraktalAnalysis, ImageAnalysis

logger = logging.getLogger(__name__)
from .serializers import (
    ComparisonSetCreateSerializer,
    ComparisonSetSerializer,
    FraktalAnalysisCreateSerializer,
    FraktalAnalysisSerializer,
    ImageAnalysisCreateSerializer,
    ImageAnalysisSerializer,
)
from .services.batch import (
    build_comparison_data,
    compute_batch_statistics,
    compute_histogram,
    detect_sim_id_from_filename,
    extract_per_image_scales,
    extract_scale_from_metadata,
    extract_scientific_png_map,
    extract_zip_images,
)
from .tasks import (
    run_fractal_analysis_task,
    run_fraktal_analysis_task,
    run_fraktal_auto_calibrate_task,
)


class ImageAnalysisViewSet(viewsets.ModelViewSet):
    """ViewSet for ImageAnalysis CRUD operations."""

    queryset = ImageAnalysis.objects.select_related("project")
    permission_classes = [IsAuthenticated, IsProjectOwnerOrShared]

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == "create":
            return ImageAnalysisCreateSerializer
        return ImageAnalysisSerializer

    def get_queryset(self):
        """Filter analyses by project if project_id in URL."""
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_pk")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset

    def perform_create(self, serializer):
        """Create analysis and enqueue task."""
        project_id = self.kwargs.get("project_pk")
        analysis = serializer.save(project_id=project_id)
        # Enqueue Celery task, fallback to sync execution if broker unavailable
        try:
            run_fractal_analysis_task.delay(str(analysis.id))
        except OperationalError:
            logger.warning(
                "Celery broker unavailable, running fractal task synchronously"
            )
            run_fractal_analysis_task(str(analysis.id))

    @action(detail=True, methods=["get"])
    def original_image(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Download original image."""
        analysis = self.get_object()
        response = HttpResponse(
            analysis.original_image,
            content_type=analysis.original_content_type,
        )
        response["Content-Disposition"] = (
            f'attachment; filename="{analysis.original_filename}"'
        )
        return response

    @action(detail=True, methods=["get"])
    def processed_image(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Download processed/binarized image."""
        analysis = self.get_object()

        if analysis.processed_image is None:
            return Response(
                {"error": "Processed image not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        response = HttpResponse(
            analysis.processed_image,
            content_type="image/png",
        )
        response["Content-Disposition"] = (
            f'attachment; filename="{analysis.id}_processed.png"'
        )
        return response


class FraktalAnalysisViewSet(viewsets.ModelViewSet):
    """ViewSet for FraktalAnalysis CRUD operations."""

    queryset = FraktalAnalysis.objects.select_related("project", "simulation")
    permission_classes = [IsAuthenticated, IsProjectOwnerOrShared]

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == "create":
            return FraktalAnalysisCreateSerializer
        return FraktalAnalysisSerializer

    def get_queryset(self):
        """Filter analyses by project if project_id in URL."""
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_pk")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset

    def perform_create(self, serializer):
        """Create analysis and enqueue task."""
        project_id = self.kwargs.get("project_pk")
        analysis = serializer.save(project_id=project_id)

        # Choose task based on auto_calibrate flag
        if analysis.auto_calibrate:
            task = run_fraktal_auto_calibrate_task
            task_name = "FRAKTAL auto-calibrate"
        else:
            task = run_fraktal_analysis_task
            task_name = "FRAKTAL"

        # Enqueue Celery task, fallback to sync execution if broker unavailable
        try:
            task.delay(str(analysis.id))
        except OperationalError:
            logger.warning(
                f"Celery broker unavailable, running {task_name} task synchronously"
            )
            task(str(analysis.id))

    @action(detail=False, methods=["delete"], url_path="delete-all")
    def delete_all(self, request: Request, **kwargs) -> Response:
        """Delete all FRAKTAL analyses in the project."""
        project_id = self.kwargs.get("project_pk")
        if not project_id:
            return Response(
                {"error": "Project ID required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        analyses = FraktalAnalysis.objects.filter(project_id=project_id)
        count = analyses.count()
        analyses.delete()

        logger.info(f"Deleted {count} FRAKTAL analyses from project {project_id}")
        return Response({"deleted": count, "message": f"Deleted {count} analyses"})

    @action(
        detail=False,
        methods=["post"],
        url_path="analyze-batch",
        parser_classes=[MultiPartParser, FormParser],
    )
    def analyze_batch(self, request: Request, **kwargs) -> Response:
        """Batch FRAKTAL analysis for projection ZIPs (R1..R11).

        Sync when ``N ≤ 30`` images; enqueues a Celery task when ``N > 30``
        and returns ``202 {"job_id": ...}`` for the client to poll via
        ``/api/v1/fraktal-status/{job_id}/`` (:func:`fraktal_status_view`).

        Scale precedence (R1): ``pixels_per_100nm`` in the request body >
        ``metadata.parameters.pixels_per_100nm`` in the uploaded ZIP >
        error (autocalibrate alone is not enough to resolve pixel↔nm
        because the Rust layer derives ``dpo`` from image content, not
        scale).
        """
        uploaded = request.FILES.get("file")
        if uploaded is None:
            return Response({"detail": "'file' field required"}, status=400)

        if uploaded.size > 100 * 1024 * 1024:
            return Response({"detail": "ZIP too large (max 100 MB)"}, status=413)

        zip_bytes = uploaded.read()

        try:
            images, metadata, filenames = extract_zip_images(zip_bytes)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        # --- Origin-aware autocalibrate defaults (R-DELTA-E3) ---
        origin: str = str(request.data.get("origin", "external")).strip().lower()
        if origin not in ("simulation", "external"):
            origin = "external"

        sim_dpo_nm: float | None = None
        autocal_explicitly_sent = "autocalibrate_dpo" in request.data

        if origin == "simulation":
            sim_dpo_raw = request.data.get("sim_dpo_nm")
            if sim_dpo_raw in (None, ""):
                return Response(
                    {"detail": ("sim_dpo_nm is required when origin is 'simulation'.")},
                    status=400,
                )
            try:
                sim_dpo_nm = float(sim_dpo_raw)
                if sim_dpo_nm <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                return Response(
                    {"detail": ("sim_dpo_nm must be a positive number.")},
                    status=400,
                )

        # Parse autocalibrate flag early — we need it for scale resolution.
        autocal_raw = request.data.get("autocalibrate_dpo", False)
        if isinstance(autocal_raw, str):
            autocalibrate_dpo = autocal_raw.strip().lower() in ("true", "1", "yes")
        else:
            autocalibrate_dpo = bool(autocal_raw)

        # Apply origin-based defaults (E3.1): simulation → autocalibrate OFF,
        # use sim_dpo_nm as dpo_hint unless user explicitly overrides.
        if origin == "simulation" and sim_dpo_nm is not None:
            if not autocal_explicitly_sent:
                autocalibrate_dpo = False

        # Scale resolution (R1).
        req_scale_raw = request.data.get("pixels_per_100nm")
        metadata_scale = extract_scale_from_metadata(metadata)

        if req_scale_raw not in (None, ""):
            try:
                scale = float(req_scale_raw)
                if scale <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                return Response({"detail": "Invalid pixels_per_100nm"}, status=400)
            calibration_source = "manual"
        elif metadata_scale is not None:
            scale = metadata_scale
            calibration_source = "metadata"
        else:
            return Response(
                {
                    "detail": (
                        "No calibration available. Provide pixels_per_100nm "
                        "or upload a ZIP with metadata.parameters.pixels_per_100nm."
                    )
                },
                status=400,
            )

        algorithm = request.data.get("algorithm", "granulated_2012")
        if algorithm not in ("granulated_2012", "voxel_2018"):
            return Response({"detail": f"Unknown algorithm: {algorithm}"}, status=400)

        dpo_hint_raw = request.data.get("dpo_hint", 0)
        try:
            dpo_hint = float(dpo_hint_raw) if dpo_hint_raw not in (None, "") else 0.0
        except (TypeError, ValueError):
            return Response({"detail": "Invalid dpo_hint"}, status=400)

        # Apply sim_dpo_nm as dpo_hint when origin=simulation and dpo_hint
        # was not explicitly provided (E3.1).
        if origin == "simulation" and sim_dpo_nm is not None and dpo_hint <= 0:
            dpo_hint = sim_dpo_nm
            calibration_source = "manual"

        if not autocalibrate_dpo and dpo_hint <= 0:
            return Response(
                {
                    "detail": (
                        "Either autocalibrate_dpo=true OR a positive "
                        "dpo_hint is required."
                    )
                },
                status=400,
            )

        # sim_id: manual override > filename detection > None (R9).
        sim_id: uuid.UUID | None = None
        req_sim_id = request.data.get("sim_id")
        if req_sim_id:
            try:
                sim_id = uuid.UUID(str(req_sim_id))
            except ValueError:
                return Response({"detail": "Invalid sim_id"}, status=400)
        else:
            sim_id = detect_sim_id_from_filename(uploaded.name or "")

        # Extract per-image scales from metadata directions (P5 T5.3).
        per_image_scales = extract_per_image_scales(metadata, filenames)

        # Extract scientific PNGs from ZIP for dual-PNG persistence (P5 T5.1).
        scientific_png_map = extract_scientific_png_map(zip_bytes, metadata)
        scientific_png_list: list[bytes | None] | None = None
        if scientific_png_map:
            scientific_png_list = [scientific_png_map.get(fn) for fn in filenames]

        # Build per-image input_variants and swap images for scientific
        # PNGs when available (P3 T3.3).
        input_variants: list[str] | None = None
        if scientific_png_list:
            import io as _io

            from PIL import Image as _Image

            input_variants = []
            for i, sci_bytes in enumerate(scientific_png_list):
                if sci_bytes:
                    sci_img = _Image.open(_io.BytesIO(sci_bytes)).convert("L")
                    images[i] = np.array(sci_img, dtype=np.uint8)
                    input_variants.append("scientific")
                else:
                    input_variants.append("presentation")

        # Resolve project for DB persistence (available on nested URLs).
        project_pk = self.kwargs.get("project_pk")
        project = None
        if project_pk:
            from apps.projects.models import Project

            try:
                project = Project.objects.get(id=project_pk)
            except Project.DoesNotExist:
                pass

        n = len(images)
        if n <= 30:
            try:
                payload = _run_batch_sync(
                    images,
                    scale,
                    autocalibrate_dpo,
                    dpo_hint,
                    algorithm,
                    filenames,
                    metadata,
                    sim_id,
                    calibration_source,
                    project=project,
                    user=request.user if request.user.is_authenticated else None,
                    zip_filename=uploaded.name or "",
                    per_image_scales=per_image_scales,
                    scientific_png_list=scientific_png_list,
                    input_variants=input_variants,
                    origin=origin,
                )
                return Response(payload, status=200)
            except Exception as exc:  # noqa: BLE001 — surface as 400 per R3
                logger.exception("Batch FRAKTAL analysis failed")
                return Response(
                    {"detail": f"Batch analysis failed: {exc!s}"},
                    status=400,
                )

        # N > 30 → async via Celery.
        import base64

        from .tasks import analyze_fraktal_batch_task

        images_b64 = [base64.b64encode(img.tobytes()).decode() for img in images]
        image_shapes = [list(img.shape) for img in images]

        # Serialize scientific PNGs as base64 for Celery transport
        scientific_b64: list[str | None] | None = None
        if scientific_png_list:
            scientific_b64 = [
                base64.b64encode(b).decode() if b else None for b in scientific_png_list
            ]

        try:
            task = analyze_fraktal_batch_task.delay(
                images_npy_b64=images_b64,
                image_shapes=image_shapes,
                filenames=filenames,
                metadata=metadata,
                pixels_per_100nm=scale,
                autocalibrate_dpo=autocalibrate_dpo,
                dpo_hint=dpo_hint,
                algorithm=algorithm,
                sim_id=str(sim_id) if sim_id else None,
                calibration_source=calibration_source,
                project_id=str(project.id) if project else None,
                user_id=str(request.user.id) if request.user.is_authenticated else None,
                zip_filename=uploaded.name or "",
                per_image_scales=per_image_scales,
                scientific_png_b64=scientific_b64,
            )
        except OperationalError:
            logger.warning(
                "Celery broker unavailable, running batch FRAKTAL task synchronously"
            )
            try:
                payload = _run_batch_sync(
                    images,
                    scale,
                    autocalibrate_dpo,
                    dpo_hint,
                    algorithm,
                    filenames,
                    metadata,
                    sim_id,
                    calibration_source,
                    project=project,
                    user=request.user if request.user.is_authenticated else None,
                    zip_filename=uploaded.name or "",
                    per_image_scales=per_image_scales,
                    scientific_png_list=scientific_png_list,
                    input_variants=input_variants,
                    origin=origin,
                )
                return Response(payload, status=200)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Batch FRAKTAL fallback sync run failed")
                return Response(
                    {"detail": f"Batch analysis failed: {exc!s}"},
                    status=400,
                )

        return Response(
            {"job_id": task.id, "status": "queued"},
            status=202,
        )

    @action(detail=True, methods=["get"])
    def original_image(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Download original image (only for uploaded_image source)."""
        analysis = self.get_object()

        if analysis.original_image is None:
            return Response(
                {
                    "error": "No original image available (source is simulation projection)"
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        response = HttpResponse(
            analysis.original_image,
            content_type=analysis.original_content_type or "image/png",
        )
        filename = analysis.original_filename or f"{analysis.id}_original.png"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"])
    def rerun(self, request: Request, pk=None, **kwargs) -> Response:
        """Re-run the FRAKTAL analysis."""
        from .models import AnalysisStatus

        analysis = self.get_object()

        # Only allow re-running completed or failed analyses
        if analysis.status not in [AnalysisStatus.COMPLETED, AnalysisStatus.FAILED]:
            return Response(
                {"error": f"Cannot re-run analysis in {analysis.status} status"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Reset status and enqueue task
        analysis.status = AnalysisStatus.QUEUED
        analysis.results = None
        analysis.error_message = ""
        analysis.save(update_fields=["status", "results", "error_message"])

        try:
            run_fraktal_analysis_task.delay(str(analysis.id))
        except OperationalError:
            logger.warning(
                "Celery broker unavailable, running FRAKTAL task synchronously"
            )
            run_fraktal_analysis_task(str(analysis.id))

        return Response(
            {"message": "Analysis re-queued", "id": str(analysis.id)},
            status=status.HTTP_202_ACCEPTED,
        )


class ComparisonSetViewSet(viewsets.ModelViewSet):
    """ViewSet for ComparisonSet CRUD operations."""

    # Prefetch M2M relationships to avoid N+1 queries
    queryset = ComparisonSet.objects.select_related("project").prefetch_related(
        "simulations",
        "analyses",
        "fraktal_analyses",
    )
    permission_classes = [IsAuthenticated, IsProjectOwnerOrShared]

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action in ("create", "update", "partial_update"):
            return ComparisonSetCreateSerializer
        return ComparisonSetSerializer

    def get_queryset(self):
        """Filter comparison sets by project if project_id in URL."""
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_pk")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset


# ============================================================================
# FRAKTAL batch analysis helpers + async polling / results endpoints
# ============================================================================


def _build_batch_response(
    rust_result: dict,
    filenames: list[str],
    metadata: dict | None,
    sim_id: uuid.UUID | None,
    scale: float,
    calibration_source: str,
) -> dict:
    """Shape the Rust batch result into the endpoint response contract.

    Shared by the sync path (``_run_batch_sync``) and the Celery task
    (``analyze_fraktal_batch_task``). Enriches per-image entries with
    ``filename`` + az/el from ``metadata.directions``, builds stats,
    histogram, comparison card, and calibration block.
    """
    directions = (metadata or {}).get("directions") or []
    az_el_map: dict[str, tuple] = {}
    for d in directions:
        if isinstance(d, dict):
            az_el_map[d.get("filename")] = (d.get("azimuth"), d.get("elevation"))

    images_out: list[dict] = []
    for i, r in enumerate(rust_result.get("results", [])):
        fname = filenames[i] if i < len(filenames) else None
        az, el = az_el_map.get(fname, (None, None))
        images_out.append(
            {
                "index": i,
                "filename": fname,
                "azimuth": az,
                "elevation": el,
                "fractal_dimension": r.get("fractal_dimension"),
                "prefactor": r.get("prefactor"),
                "r_squared": r.get("r_squared"),
                "n_particles_counted": r.get("n_particles_counted"),
                "error": r.get("error"),
            }
        )

    stats = compute_batch_statistics(images_out)
    df_values = [
        e["fractal_dimension"] for e in images_out if e["fractal_dimension"] is not None
    ]
    histogram = compute_histogram(df_values)
    comparison = build_comparison_data(sim_id, stats["mean_df"], stats["std_df"])

    calibration = {
        "source": calibration_source,
        "pixels_per_100nm": scale,
        "dpo_used": rust_result.get("dpo_used"),
        "autocalibrate_image": rust_result.get("autocalibrate_image_index"),
    }

    return {
        "images": images_out,
        "stats": stats,
        "histogram": histogram,
        "comparison": comparison,
        "calibration": calibration,
    }


def _images_to_png_bytes(images: list) -> list[bytes]:
    """Re-encode grayscale numpy arrays to PNG bytes for DB storage."""
    import io as _io

    from PIL import Image as _Image

    result = []
    for img_array in images:
        buf = _io.BytesIO()
        _Image.fromarray(img_array, mode="L").save(buf, format="PNG")
        result.append(buf.getvalue())
    return result


def _run_batch_sync(
    images,
    scale: float,
    autocalibrate_dpo: bool,
    dpo_hint: float,
    algorithm: str,
    filenames: list[str],
    metadata: dict | None,
    sim_id: uuid.UUID | None,
    calibration_source: str,
    *,
    project=None,
    user=None,
    zip_filename: str = "",
    per_image_scales: list[float] | None = None,
    scientific_png_list: list[bytes | None] | None = None,
    input_variants: list[str] | None = None,
    origin: str = "external",
) -> dict:
    """Sync execution of a FRAKTAL batch (N ≤ 30).

    Calls the PyO3 ``analyze_fraktal_batch`` orchestrator once, shapes
    the result with :func:`_build_batch_response`, then persists to DB
    via :func:`persist_batch_results`.

    Returns the response payload with an added ``batch_id`` field.
    """
    import aglogen_core

    from .models import FraktalBatch
    from .services.batch import persist_batch_results

    if per_image_scales is not None:
        rust_result = aglogen_core.analyze_fraktal_batch_per_image_scale(
            images,
            per_image_scales,
            autocalibrate_dpo,
            dpo_hint,
            algorithm,
            **({"input_variants": input_variants} if input_variants else {}),
        )
    else:
        rust_result = aglogen_core.analyze_fraktal_batch(
            images,
            scale,
            autocalibrate_dpo,
            dpo_hint,
            algorithm,
        )
    payload = _build_batch_response(
        rust_result, filenames, metadata, sim_id, scale, calibration_source
    )

    # Persist to DB when project is available.
    if project is not None:
        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm=algorithm,
            calibration_source=calibration_source,
            pixels_per_100nm=scale,
            dpo_used=rust_result.get("dpo_used") or dpo_hint,
            autocalibrate_source=rust_result.get("autocalibrate_source"),
            autocalibrate_image_index=rust_result.get("autocalibrate_image_index"),
            sim_id=sim_id,
            original_zip_filename=zip_filename,
            origin=origin,
        )
        png_list = _images_to_png_bytes(images)
        persist_batch_results(
            batch,
            payload["images"],
            png_list,
            dpo_used=batch.dpo_used,
            scientific_png_list=scientific_png_list,
            input_variants=input_variants,
        )
        payload["batch_id"] = str(batch.id)

    return payload


from celery.result import AsyncResult  # noqa: E402


def _fraktal_batches_storage_dir() -> str:
    """Return (and create) the directory where async batch JSON results live.

    Mirrors :func:`apps.simulations.tasks._projections_storage_dir`: falls
    back to ``BASE_DIR/fraktal_batches/`` when ``MEDIA_ROOT`` isn't set.
    """
    import os

    media_root = getattr(settings, "MEDIA_ROOT", None)
    base = str(media_root) if media_root else str(settings.BASE_DIR)
    storage_dir = os.path.join(base, "fraktal_batches")
    os.makedirs(storage_dir, exist_ok=True)
    return storage_dir


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def fraktal_status_view(request: Request, job_id: str) -> Response:
    """GET /api/v1/fraktal-status/{job_id}/

    Polling endpoint for async FRAKTAL batch jobs. Maps Celery
    ``AsyncResult`` state onto the contract shape:

    - ``processing`` — queued or mid-run. Includes ``progress`` (0..1),
      ``current``, ``total`` and ``stage`` (``autocalibrate`` |
      ``analyzing`` | ``aggregating``) so the UI can drive a staged
      progress bar.
    - ``done`` — results are ready. Includes ``results_url`` pointing at
      :func:`fraktal_results_view` for the same ``job_id``.
    - ``failed`` — task raised. Includes ``error`` with the exception text.
    """
    result = AsyncResult(job_id)
    state = result.state

    if state == "PENDING":
        return Response(
            {
                "status": "processing",
                "progress": 0.0,
                "current": 0,
                "total": 0,
                "stage": "autocalibrate",
            }
        )
    if state == "PROGRESS":
        meta = result.info if isinstance(result.info, dict) else {}
        return Response(
            {
                "status": "processing",
                "progress": float(meta.get("progress", 0.0)),
                "current": int(meta.get("current", 0)),
                "total": int(meta.get("total", 0)),
                "stage": str(meta.get("stage", "analyzing")),
            }
        )
    if state == "SUCCESS":
        data = result.result if isinstance(result.result, dict) else {}
        resp_data: dict = {
            "status": "done",
        }
        if data.get("batch_id"):
            resp_data["batch_id"] = data["batch_id"]
        # Legacy field — kept for backwards compat with older tasks.
        if data.get("results_url"):
            resp_data["results_url"] = data["results_url"]
        return Response(resp_data)
    if state == "FAILURE":
        return Response(
            {
                "status": "failed",
                "error": str(result.info)
                if result.info is not None
                else "Unknown error",
            }
        )
    return Response({"status": str(state).lower(), "progress": 0.0})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def fraktal_results_view(request: Request, job_id: str) -> HttpResponse:
    """GET /api/v1/fraktal-status/{job_id}/results/

    Returns the completed batch result JSON.  Tries two sources in order:

    1. **DB path** (post-Phase 3): look up the Celery ``AsyncResult`` for
       *job_id* to extract ``batch_id``, then load ``FraktalBatch`` +
       ``FraktalBatchImage`` rows and serialize to the ``FraktalBatchResult``
       shape the frontend expects.
    2. **Legacy JSON-on-disk** fallback: read
       ``{MEDIA_ROOT|BASE_DIR}/fraktal_batches/{job_id}.json`` for any
       batches that completed before the deploy that removed JSON writing.
    3. If neither source has data → 404.
    """
    import os

    # --- 1. Try DB via Celery result → batch_id ---
    batch_id = _resolve_batch_id_from_celery(job_id)
    if batch_id:
        payload = _serialize_batch_from_db(batch_id)
        if payload is not None:
            return Response(payload)

    # --- 2. Legacy JSON-on-disk fallback ---
    storage_dir = _fraktal_batches_storage_dir()
    results_path = os.path.join(storage_dir, f"{job_id}.json")

    if os.path.exists(results_path):
        with open(results_path, "rb") as fp:
            raw = fp.read()
        response = HttpResponse(raw, content_type="application/json")
        response["Content-Disposition"] = (
            f'inline; filename="fraktal_batch_{job_id}.json"'
        )
        return response

    # --- 3. Neither → 404 ---
    return Response(
        {"detail": f"Results for job {job_id} not available"},
        status=status.HTTP_404_NOT_FOUND,
    )


def _resolve_batch_id_from_celery(job_id: str) -> str | None:
    """Extract ``batch_id`` from the Celery task result for *job_id*.

    Returns the batch UUID string, or ``None`` when the task hasn't finished
    or its result doesn't include a ``batch_id``.
    """
    try:
        result = AsyncResult(job_id)
        if result.state == "SUCCESS" and isinstance(result.result, dict):
            return result.result.get("batch_id")
    except Exception:  # noqa: BLE001 — never blow up on broker issues
        logger.debug("Could not fetch Celery result for job %s", job_id)
    return None


def _serialize_batch_from_db(batch_id: str) -> dict | None:
    """Load a ``FraktalBatch`` by *batch_id* and serialize to the
    ``FraktalBatchResult`` shape expected by the frontend.

    Returns ``None`` when the batch doesn't exist.
    """
    try:
        batch = FraktalBatch.objects.get(id=batch_id)
    except FraktalBatch.DoesNotExist:
        return None

    images = batch.images.all().order_by("index")
    images_out = [
        {
            "index": img.index,
            "filename": img.filename,
            "azimuth": img.azimuth,
            "elevation": img.elevation,
            "fractal_dimension": img.fractal_dimension,
            "prefactor": img.prefactor,
            "r_squared": img.r_squared,
            "n_particles_counted": img.n_particles_counted,
            "error": img.error or None,
        }
        for img in images
    ]

    stats = {
        "n_images": batch.n_images,
        "n_successful": batch.n_successful,
        "mean_df": batch.mean_df,
        "std_df": batch.std_df,
        "median_df": batch.median_df,
        "min_df": batch.min_df,
        "max_df": batch.max_df,
    }

    comparison = build_comparison_data(batch.sim_id, batch.mean_df, batch.std_df)

    calibration = {
        "source": batch.calibration_source,
        "pixels_per_100nm": batch.pixels_per_100nm,
        "dpo_used": batch.dpo_used,
        "autocalibrate_image": batch.autocalibrate_image_index,
    }

    df_values = [
        img.fractal_dimension for img in images if img.fractal_dimension is not None
    ]
    histogram = compute_histogram(df_values)

    return {
        "batch_id": str(batch.id),
        "images": images_out,
        "stats": stats,
        "histogram": histogram,
        "comparison": comparison,
        "calibration": calibration,
    }


# ============================================================================
# Phase 4 — Batch drill-down, PNG, re-analyze, delete, CSV endpoints
# ============================================================================


from .models import FraktalBatch, FraktalBatchImage  # noqa: E402


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def batch_list_view(request: Request, project_pk: uuid.UUID) -> Response:
    """GET /api/v1/projects/{project_pk}/fraktal/batches/

    Paginated list of FraktalBatch rows for a project, ordered by
    ``created_at DESC``. Returns summary stats per batch but NOT
    the per-image array (use the detail endpoint for that).
    """
    from rest_framework.pagination import PageNumberPagination

    batches = FraktalBatch.objects.filter(project_id=project_pk).order_by("-created_at")

    paginator = PageNumberPagination()
    paginator.page_size = 20
    page = paginator.paginate_queryset(batches, request)

    results = [
        {
            "id": str(b.id),
            "status": "completed",
            "created_at": b.created_at.isoformat(),
            "completed_at": None,
            "algorithm": b.algorithm,
            "calibration_source": b.calibration_source,
            "dpo_used": b.dpo_used,
            "autocalibrate_source": b.autocalibrate_source,
            "n_images": b.n_images,
            "n_successful": b.n_successful,
            "mean_df": b.mean_df,
            "std_df": b.std_df,
            "median_df": b.median_df,
            "min_df": b.min_df,
            "max_df": b.max_df,
            "original_zip_filename": b.original_zip_filename,
        }
        for b in page
    ]

    return paginator.get_paginated_response(results)


@api_view(["GET", "DELETE"])
@permission_classes([IsAuthenticated])
def batch_detail_view(
    request: Request, project_pk: uuid.UUID, batch_id: uuid.UUID
) -> Response:
    """GET or DELETE /api/v1/projects/{project_pk}/fraktal/batches/{batch_id}/

    GET: full batch detail with image rows, stats, etc.
    DELETE: cascade delete batch + images; re-analyses survive.
    Cross-project access returns 404 (no existence leak).
    """
    try:
        batch = FraktalBatch.objects.get(id=batch_id, project_id=project_pk)
    except FraktalBatch.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        batch.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    images = batch.images.all().order_by("index")
    images_data = [
        {
            "index": img.index,
            "filename": img.filename,
            "azimuth": img.azimuth,
            "elevation": img.elevation,
            "fractal_dimension": img.fractal_dimension,
            "prefactor": img.prefactor,
            "r_squared": img.r_squared,
            "n_particles_counted": img.n_particles_counted,
            "error": img.error or None,
            "dpo_used": img.dpo_used,
        }
        for img in images
    ]

    stats = {
        "n_images": batch.n_images,
        "n_successful": batch.n_successful,
        "mean_df": batch.mean_df,
        "std_df": batch.std_df,
        "median_df": batch.median_df,
        "min_df": batch.min_df,
        "max_df": batch.max_df,
    }

    comparison = build_comparison_data(batch.sim_id, batch.mean_df, batch.std_df)

    calibration = {
        "source": batch.calibration_source,
        "pixels_per_100nm": batch.pixels_per_100nm,
        "dpo_used": batch.dpo_used,
        "autocalibrate_image": batch.autocalibrate_image_index,
    }

    return Response(
        {
            "batch_id": str(batch.id),
            "project_id": str(batch.project_id),
            "algorithm": batch.algorithm,
            "created_at": str(batch.created_at),
            "images": images_data,
            "stats": stats,
            "comparison": comparison,
            "calibration": calibration,
            "original_zip_filename": batch.original_zip_filename,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def batch_image_detail_view(
    request: Request, project_pk: uuid.UUID, batch_id: uuid.UUID, index: int
) -> Response:
    """GET .../images/{index}/ — drill-down image detail with prev/next."""
    try:
        batch = FraktalBatch.objects.get(id=batch_id, project_id=project_pk)
    except FraktalBatch.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        img = FraktalBatchImage.objects.get(batch=batch, index=index)
    except FraktalBatchImage.DoesNotExist:
        return Response(
            {"detail": "Image index out of range."}, status=status.HTTP_404_NOT_FOUND
        )

    total = batch.images.count()
    prev_index = index - 1 if index > 0 else None
    next_index = index + 1 if index < total - 1 else None

    # Resolve sim comparison if available
    sim_target_df = None
    sim_box_counting_df = None
    sorensen_note = ""
    if batch.sim_id:
        from apps.simulations.models import Simulation

        try:
            sim = Simulation.objects.get(id=batch.sim_id)
            sim_params = sim.parameters or {}
            sim_metrics = sim.metrics or {}
            sim_target_df = sim_params.get("target_df")
            sim_box_counting_df = sim_metrics.get("fractal_dimension")
        except Simulation.DoesNotExist:
            pass
        from .services.batch import SORENSEN_NOTE

        sorensen_note = SORENSEN_NOTE

    return Response(
        {
            "batch_id": str(batch.id),
            "index": img.index,
            "filename": img.filename,
            "azimuth": img.azimuth,
            "elevation": img.elevation,
            "fractal_dimension": img.fractal_dimension,
            "prefactor": img.prefactor,
            "r_squared": img.r_squared,
            "n_particles_counted": img.n_particles_counted,
            "error": img.error or None,
            "dpo_used": img.dpo_used,
            "pixels_per_100nm": batch.pixels_per_100nm,
            "autocalibrate_source": batch.autocalibrate_source,
            "prev_index": prev_index,
            "next_index": next_index,
            "total_count": total,
            "png_url": f"/api/v1/projects/{project_pk}/fraktal/batches/{batch_id}/images/{index}/png/",
            "has_scientific_png": img.png_scientific_bytes is not None,
            "analysis_input_variant": img.analysis_input_variant,
            "batch_origin": batch.origin,
            "sim_target_df": sim_target_df,
            "sim_box_counting_df": sim_box_counting_df,
            "sorensen_note": sorensen_note,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def batch_image_png_view(
    request: Request, project_pk: uuid.UUID, batch_id: uuid.UUID, index: int
) -> HttpResponse:
    """GET .../images/{index}/png/?variant=presentation|scientific — raw PNG bytes.

    ``variant`` query param selects which PNG to serve:
    - ``presentation`` (default): the presentation render (``image_png``).
    - ``scientific``: the binary B/W render (``png_scientific_bytes``).
      Falls back to presentation when ``png_scientific_bytes IS NULL``
      (legacy row — silent fallback, no 404).
    """
    variant = request.GET.get("variant", "presentation")
    if variant not in ("presentation", "scientific"):
        return Response(
            {
                "detail": f"Invalid variant: '{variant}'. Must be 'presentation' or 'scientific'."
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        batch = FraktalBatch.objects.get(id=batch_id, project_id=project_pk)
    except FraktalBatch.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        img = FraktalBatchImage.objects.get(batch=batch, index=index)
    except FraktalBatchImage.DoesNotExist:
        return Response(
            {"detail": "Image index out of range."}, status=status.HTTP_404_NOT_FOUND
        )

    if variant == "scientific" and img.png_scientific_bytes:
        png_bytes = bytes(img.png_scientific_bytes)
    else:
        # presentation (default) OR scientific fallback when NULL
        png_bytes = bytes(img.image_png)

    if not png_bytes:
        return Response(
            {"detail": "Image has no PNG data (rasterization failed)."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    response = HttpResponse(png_bytes, content_type="image/png")
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def batch_image_reanalyze_view(
    request: Request, project_pk: uuid.UUID, batch_id: uuid.UUID, index: int
) -> Response:
    """POST .../images/{index}/reanalyze/ — creates FraktalAnalysis from batch PNG."""
    try:
        batch = FraktalBatch.objects.get(id=batch_id, project_id=project_pk)
    except FraktalBatch.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        img = FraktalBatchImage.objects.get(batch=batch, index=index)
    except FraktalBatchImage.DoesNotExist:
        return Response(
            {"detail": "Image index out of range."}, status=status.HTTP_404_NOT_FOUND
        )

    png_bytes = bytes(img.image_png)
    if not png_bytes:
        return Response(
            {"detail": "Cannot re-analyze: image has no PNG data."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Create a persistent FraktalAnalysis row with inherited dpo from batch
    analysis = FraktalAnalysis.objects.create(
        project_id=project_pk,
        model=batch.algorithm,
        npix=batch.pixels_per_100nm,
        dpo=batch.dpo_used,
        original_image=png_bytes,
        original_filename=img.filename,
        original_content_type="image/png",
        auto_calibrate=False,  # Q3 LOCKED: no fresh autocalibrate
    )

    return Response(
        {"id": str(analysis.id), "status": analysis.status},
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def batch_csv_view(
    request: Request, project_pk: uuid.UUID, batch_id: uuid.UUID
) -> HttpResponse:
    """GET .../batches/{batchId}/csv/ — batch CSV export with locale."""
    try:
        batch = FraktalBatch.objects.get(id=batch_id, project_id=project_pk)
    except FraktalBatch.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    from apps.core.services.csv_locale import get_user_csv_locale
    from .services.csv_export import build_batch_csv

    decimal, delimiter = get_user_csv_locale(request)
    csv_body = build_batch_csv(batch, decimal, delimiter)

    response = HttpResponse(csv_body, content_type="text/csv; charset=utf-8")
    filename = f"fraktal_batch_{batch.id}.csv"
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def single_image_csv_view(
    request: Request, project_pk: uuid.UUID, analysis_id: uuid.UUID
) -> HttpResponse:
    """GET .../fraktal/{analysisId}/csv/ — single FraktalAnalysis CSV."""
    try:
        analysis = FraktalAnalysis.objects.select_related("simulation").get(
            id=analysis_id, project_id=project_pk
        )
    except FraktalAnalysis.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    from apps.core.services.csv_locale import get_user_csv_locale
    from .services.csv_export import build_single_image_csv

    decimal, delimiter = get_user_csv_locale(request)
    csv_body = build_single_image_csv(analysis, decimal, delimiter)

    response = HttpResponse(csv_body, content_type="text/csv; charset=utf-8")
    filename = f"fraktal_{analysis.id}.csv"
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
