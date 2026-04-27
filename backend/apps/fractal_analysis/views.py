"""Fractal Analysis views."""

import logging
import uuid

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
    extract_scale_from_metadata,
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

        # Parse autocalibrate flag early — we need it for scale resolution.
        autocal_raw = request.data.get("autocalibrate_dpo", False)
        if isinstance(autocal_raw, str):
            autocalibrate_dpo = autocal_raw.strip().lower() in ("true", "1", "yes")
        else:
            autocalibrate_dpo = bool(autocal_raw)

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
        )
        png_list = _images_to_png_bytes(images)
        persist_batch_results(
            batch, payload["images"], png_list, dpo_used=batch.dpo_used
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

    Streams the completed batch result JSON stored by
    :func:`apps.fractal_analysis.tasks.analyze_fraktal_batch_task` to
    ``{MEDIA_ROOT|BASE_DIR}/fraktal_batches/{task_id}.json``.
    """
    import os

    storage_dir = _fraktal_batches_storage_dir()
    results_path = os.path.join(storage_dir, f"{job_id}.json")

    if not os.path.exists(results_path):
        return Response(
            {"detail": f"Results for job {job_id} not available"},
            status=status.HTTP_404_NOT_FOUND,
        )

    with open(results_path, "rb") as fp:
        payload = fp.read()

    response = HttpResponse(payload, content_type="application/json")
    response["Content-Disposition"] = f'inline; filename="fraktal_batch_{job_id}.json"'
    return response
