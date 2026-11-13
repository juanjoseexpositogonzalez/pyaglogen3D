"""Fractal Analysis Celery tasks."""

import io
import logging
from uuid import UUID

import aglogen_core
import numpy as np
from celery import shared_task
from django.utils import timezone
from PIL import Image

logger = logging.getLogger(__name__)


#: The classic image methods that have no implementation in the engine. The two
#: FRAKTAL models are not in this set: they *are* implemented, in the sibling
#: `FraktalAnalysis` pipeline, which takes a different payload (`npix`, `dpo`, ...).
UNIMPLEMENTED_IMAGE_METHODS = frozenset(
    {"sandbox", "correlation", "lacunarity", "multifractal"}
)

#: The models that belong to the other pipeline.
FRAKTAL_MODELS = frozenset({"fraktal_granulated_2012", "fraktal_voxel_2018"})


def _unsupported_method_message(method: str) -> str:
    """Why this method cannot run here, in the words that are true for it."""
    if method in FRAKTAL_MODELS:
        return (
            f"method '{method}' is a FRAKTAL model, not a classic image method: it "
            "runs through the FRAKTAL analysis pipeline (FraktalAnalysis), which "
            "takes npix and dpo, not the box-counting parameters"
        )
    if method in UNIMPLEMENTED_IMAGE_METHODS:
        return (
            f"method '{method}' is not implemented yet; only 'box_counting' "
            "measures a 2D image today"
        )
    return (
        f"method '{method}' cannot be measured by the image analysis; only "
        "'box_counting' is implemented here"
    )


def _otsu_threshold(gray: np.ndarray) -> int:
    """Otsu's threshold: the level that maximises the between-class variance.

    A pure function over the 256-bin histogram, so the cut can be tested on its
    own. The pipeline used `np.mean` here, which is a different number and lands
    inside a class whenever the split is skewed (#331).
    """
    hist = np.bincount(gray.ravel(), minlength=256).astype(float)
    total = hist.sum()
    levels = np.arange(256, dtype=float)
    weight_background = np.cumsum(hist)
    weight_foreground = total - weight_background
    sum_total = float((hist * levels).sum())
    sum_background = np.cumsum(hist * levels)

    mean_background = np.divide(
        sum_background,
        weight_background,
        out=np.zeros_like(sum_background),
        where=weight_background > 0,
    )
    mean_foreground = np.divide(
        sum_total - sum_background,
        weight_foreground,
        out=np.zeros_like(sum_background),
        where=weight_foreground > 0,
    )

    between_class = (
        weight_background * weight_foreground * (mean_background - mean_foreground) ** 2
    )
    return int(np.argmax(between_class))



def _rasterize_projection_to_grayscale(
    proj_result,
    img_size: int = 512,
) -> np.ndarray:
    """Rasterize a ``project_to_2d`` result into a grayscale (H, W) uint8 array.

    The Rust ``project_to_2d`` binding only returns the geometric projection
    (``x``, ``y``, ``radii``, ``bounds``) — it does NOT rasterize to an image.
    This helper uses the existing matplotlib-based renderer (the same path
    used by projection ZIP exports) to produce PNG bytes, then decodes them
    back into a grayscale numpy array that matches the shape/dtype the
    FRAKTAL analyzers (``fraktal_granulated_2012`` / ``fraktal_voxel_2018``)
    expect — identical to what the batch FRAKTAL path feeds them after
    PIL decoding of user-uploaded PNGs.

    Args:
        proj_result: object with ``.x``, ``.y``, ``.radii``, ``.bounds``
            attributes (the PyO3 ``PyProjectionResult`` qualifies).
        img_size: square output size in pixels (default 512).

    Returns:
        Grayscale image as a 2D ``numpy.ndarray`` of shape
        ``(img_size, img_size)`` and dtype ``uint8``.
    """
    # Lazy import to avoid a hard dependency on the simulations app at
    # module import time — matters for unit tests that exercise this
    # helper in isolation.
    from apps.simulations.services.projection import render_projection_png

    bounds = (
        float(proj_result.bounds[0]),
        float(proj_result.bounds[1]),
        float(proj_result.bounds[2]),
        float(proj_result.bounds[3]),
    )
    png_bytes = render_projection_png(
        x=list(proj_result.x),
        y=list(proj_result.y),
        radii=list(proj_result.radii),
        bounds=bounds,
        img_size=img_size,
    )
    img = Image.open(io.BytesIO(png_bytes)).convert("L")
    return np.array(img, dtype=np.uint8)


@shared_task(bind=True, max_retries=1)
def run_fractal_analysis_task(self, analysis_id: str) -> dict:
    """Execute fractal analysis using Rust engine."""
    from .models import AnalysisStatus, ImageAnalysis

    analysis = ImageAnalysis.objects.get(id=UUID(analysis_id))

    # Update status to running
    analysis.status = AnalysisStatus.RUNNING
    analysis.started_at = timezone.now()
    analysis.save(update_fields=["status", "started_at"])

    try:
        # Load and preprocess image
        image = Image.open(io.BytesIO(analysis.original_image))

        # Convert to grayscale
        if image.mode != "L":
            image = image.convert("L")

        # Apply preprocessing
        img_array = np.array(image)
        preprocess = analysis.preprocessing_params

        # Thresholding
        threshold_method = preprocess.get("threshold_method", "otsu")
        if threshold_method == "otsu":
            threshold = _otsu_threshold(img_array)
        elif threshold_method == "manual":
            threshold = preprocess.get("threshold_value", 128)
        else:
            raise ValueError(
                f"Unknown threshold_method '{threshold_method}': "
                "expected 'otsu' or 'manual'"
            )

        binary = img_array > threshold

        if preprocess.get("invert", False):
            binary = ~binary

        # Save processed image
        processed_img = Image.fromarray((binary * 255).astype(np.uint8))
        buffer = io.BytesIO()
        processed_img.save(buffer, format="PNG")
        analysis.processed_image = buffer.getvalue()

        # Measure with the engine, or refuse: a method that does not exist must
        # not answer with a plausible-looking number (#331). Before this, every
        # method returned `1.65 ± 0.1` drawn from `np.random`.
        if analysis.method != "box_counting":
            raise ValueError(_unsupported_method_message(analysis.method))

        # `method_params` is free-form JSON that the serializer does not validate,
        # and these three reach the engine: `min_box_size: 0` makes it divide by
        # zero *inside Rust*, and a PyO3 `PanicException` derives from
        # `BaseException`, so the handler below would not catch it and the row would
        # stay `running` forever. Validate here instead of at the panic.
        params = analysis.method_params or {}
        min_box_size = int(params.get("min_box_size", 2))
        max_box_size = int(params.get("max_box_size", 512))
        num_scales = int(params.get("num_scales", 20))
        if min_box_size < 1 or max_box_size < min_box_size:
            raise ValueError(
                "min_box_size and max_box_size must satisfy "
                f"1 <= min_box_size <= max_box_size (got {min_box_size} and "
                f"{max_box_size})"
            )
        if num_scales < 2:
            raise ValueError(
                f"num_scales must be at least 2 (got {num_scales})"
            )

        result = aglogen_core.box_counting(
            binary_image=binary,
            min_box_size=min_box_size,
            max_box_size=max_box_size,
            num_scales=num_scales,
        )

        # A mask with no structure is not a measurement. An empty mask leaves the
        # curve with no usable scale (the fit answers 0.00) and a uniform mask makes
        # every box occupied (it answers 2.00 with R² 1.0) — both were stored as
        # `completed`, which is the same defect this issue closed, without `random`.
        foreground = int(binary.sum())
        if foreground == 0:
            raise ValueError(
                "the threshold left no foreground pixels, so there is nothing to "
                "measure; check threshold_method and invert"
            )
        if len(result.log_scales) < 3:
            raise ValueError(
                f"box counting found {len(result.log_scales)} usable scales on this "
                "image and a fit needs at least 3; check min_box_size, max_box_size "
                "and num_scales"
            )

        analysis.results = {
            "fractal_dimension": float(result.dimension),
            "r_squared": float(result.r_squared),
            "std_error": float(result.std_error),
            "confidence_interval_95": [float(v) for v in result.confidence_interval],
            "log_sizes": [float(v) for v in result.log_scales],
            "log_counts": [float(v) for v in result.log_values],
            "residuals": [float(v) for v in result.residuals],
        }
        analysis.execution_time_ms = int(result.execution_time_ms)
        # Compiled into the cdylib that ran, which is the authority: asking
        # `importlib.metadata` for a distribution name can answer "unknown" and
        # store it as a completed analysis' version.
        analysis.engine_version = aglogen_core.version()[:20]

        analysis.status = AnalysisStatus.COMPLETED
        analysis.completed_at = timezone.now()
        analysis.save()

        logger.info(f"Analysis {analysis_id} completed successfully")

        return {
            "status": "completed",
            "analysis_id": analysis_id,
            "fractal_dimension": analysis.results["fractal_dimension"],
        }

    except Exception as e:
        # A refusal is user input, not a server fault; `logger.exception` for it
        # turns every unsupported method into a Sentry-visible error.
        if isinstance(e, ValueError):
            logger.warning(f"Analysis {analysis_id} refused: {e}")
        else:
            logger.exception(f"Analysis {analysis_id} failed: {e}")
        # A failed row must not keep a payload: an older row can still carry the
        # placeholder's fabricated number, and the serializer exposes it without
        # looking at the status.
        analysis.results = None
        analysis.status = AnalysisStatus.FAILED
        analysis.error_message = str(e)
        analysis.completed_at = timezone.now()
        analysis.save()

        return {
            "status": "failed",
            "analysis_id": analysis_id,
            "error": str(e),
        }


@shared_task(bind=True, max_retries=1)
def run_fraktal_auto_calibrate_task(self, analysis_id: str) -> dict:
    """Run FRAKTAL with auto-calibration to find optimal parameters.

    Tries different dpo values and finds the one that best aligns
    calculated particles (npo) with visual estimate (npo_visual).
    """
    from .models import AnalysisStatus, FraktalAnalysis, SourceType

    analysis = FraktalAnalysis.objects.select_related("simulation").get(
        id=UUID(analysis_id)
    )

    analysis.status = AnalysisStatus.RUNNING
    analysis.started_at = timezone.now()
    analysis.save(update_fields=["status", "started_at"])

    try:
        # Get the image
        if analysis.source_type == SourceType.UPLOADED_IMAGE:
            image = Image.open(io.BytesIO(analysis.original_image))
        else:
            if analysis.simulation is None or analysis.simulation.geometry is None:
                raise ValueError("No simulation geometry available")
            geometry = np.load(io.BytesIO(analysis.simulation.geometry))
            coordinates = geometry[:, :3]
            radii = geometry[:, 3]
            proj_params = analysis.projection_params or {}
            projection_result = aglogen_core.project_to_2d(
                coordinates=coordinates,
                radii=radii,
                azimuth=proj_params.get("azimuth", 0.0),
                elevation=proj_params.get("elevation", 0.0),
            )
            # Rust only returns geometry; rasterize to grayscale here so
            # the downstream analyzer receives the same image shape the
            # batch path produces from PIL-decoded PNGs.
            img_array = _rasterize_projection_to_grayscale(
                projection_result,
                img_size=int(proj_params.get("resolution", 512)),
            )
            image = Image.fromarray(img_array, mode="L")

        if image.mode != "L":
            image = image.convert("L")
        img_array = np.array(image, dtype=np.uint8)

        logger.info(f"Auto-calibration for analysis {analysis_id}")

        # First, get a visual estimate by running with a reasonable dpo
        initial_dpo = analysis.dpo or 40.0

        # Try a range of dpo values (reduced set for faster calibration)
        # Start with the initial value, then try nearby values
        dpo_values = [
            initial_dpo,
            initial_dpo * 0.7,
            initial_dpo * 1.4,
            initial_dpo * 0.5,
        ]

        best_result = None
        best_alignment = float("inf")
        best_dpo = initial_dpo
        all_attempts = []
        found_good_match = False

        for idx, test_dpo in enumerate(dpo_values):
            logger.info(
                f"Auto-cal attempt {idx + 1}/{len(dpo_values)}: dpo={test_dpo:.1f}"
            )
            try:
                if analysis.model == "granulated_2012":
                    result = aglogen_core.fraktal_granulated_2012(
                        image=img_array,
                        npix=analysis.npix,
                        dpo=test_dpo,
                        delta=analysis.delta,
                        correction_3d=analysis.correction_3d,
                        pixel_min=analysis.pixel_min,
                        pixel_max=analysis.pixel_max,
                        npo_limit=analysis.npo_limit,
                        escala=analysis.escala,
                    )
                else:
                    result = aglogen_core.fraktal_voxel_2018(
                        image=img_array,
                        npix=analysis.npix,
                        escala=analysis.escala,
                        correction_3d=analysis.correction_3d,
                        pixel_min=analysis.pixel_min,
                        pixel_max=analysis.pixel_max,
                        m_exponent=analysis.m_exponent,
                    )

                # Calculate alignment score (lower is better)
                if result.npo_visual > 0 and result.npo > 0:
                    alignment = abs(result.npo - result.npo_visual) / result.npo_visual
                else:
                    alignment = float("inf")

                # npo_aligned if ratio between 0.5 and 2.0
                npo_ratio = (
                    result.npo / result.npo_visual if result.npo_visual > 0 else 0
                )
                npo_aligned = 0.5 <= npo_ratio <= 2.0

                all_attempts.append(
                    {
                        "dpo": round(test_dpo, 1),
                        "npo": result.npo,
                        "npo_ratio": round(npo_ratio, 2),
                        "npo_aligned": npo_aligned,
                    }
                )

                logger.info(
                    f"Auto-cal dpo={test_dpo:.1f}: npo={result.npo}, "
                    f"visual={result.npo_visual}, alignment={alignment:.2f}, status={result.status}"
                )

                if result.status == "success" and alignment < best_alignment:
                    best_alignment = alignment
                    best_result = result
                    best_dpo = test_dpo

                    # Early exit if we found a good match (within 20%)
                    if alignment < 0.2:
                        logger.info(
                            f"Found good match at dpo={test_dpo:.1f}, stopping early"
                        )
                        found_good_match = True
                        break

            except Exception as e:
                logger.warning(f"Auto-cal attempt dpo={test_dpo} failed: {e}")
                all_attempts.append(
                    {
                        "dpo": test_dpo,
                        "error": str(e),
                    }
                )

        # If no successful result, use the best failed one or last attempt
        if best_result is None:
            # Find the attempt closest to npo_visual even if not successful
            for attempt in all_attempts:
                if "npo" in attempt and attempt.get("npo_visual", 0) > 0:
                    alignment = (
                        abs(attempt["npo"] - attempt["npo_visual"])
                        / attempt["npo_visual"]
                    )
                    if alignment < best_alignment:
                        best_alignment = alignment
                        best_dpo = attempt["dpo"]

            # Re-run with best dpo found
            if analysis.model == "granulated_2012":
                best_result = aglogen_core.fraktal_granulated_2012(
                    image=img_array,
                    npix=analysis.npix,
                    dpo=best_dpo,
                    delta=analysis.delta,
                    correction_3d=analysis.correction_3d,
                    pixel_min=analysis.pixel_min,
                    pixel_max=analysis.pixel_max,
                    npo_limit=analysis.npo_limit,
                    escala=analysis.escala,
                )
            else:
                best_result = aglogen_core.fraktal_voxel_2018(
                    image=img_array,
                    npix=analysis.npix,
                    escala=analysis.escala,
                    correction_3d=analysis.correction_3d,
                    pixel_min=analysis.pixel_min,
                    pixel_max=analysis.pixel_max,
                    m_exponent=analysis.m_exponent,
                )

        # Update analysis with best result
        analysis.dpo = best_dpo
        analysis.results = {
            "rg": best_result.rg,
            "ap": best_result.ap,
            "df": best_result.df,
            "npo": best_result.npo,
            "npo_visual": best_result.npo_visual,
            "kf": best_result.kf,
            "zf": best_result.zf,
            "jf": best_result.jf,
            "volume": best_result.volume,
            "mass": best_result.mass,
            "surface_area": best_result.surface_area,
            "status": best_result.status,
            "model": best_result.model,
            "npo_ratio": best_result.npo_ratio,
            "npo_aligned": best_result.npo_aligned,
            "dpo_estimated": best_result.dpo_estimated,
            "auto_calibrated": True,
            "calibration_attempts": all_attempts,
            "best_dpo": best_dpo,
            "best_alignment": best_alignment,
        }
        analysis.execution_time_ms = best_result.execution_time_ms
        analysis.engine_version = aglogen_core.version()

        if best_result.status != "success":
            analysis.status = AnalysisStatus.FAILED
            analysis.error_message = f"Auto-calibration failed: {best_result.status}. Best dpo tried: {best_dpo:.1f}nm"
        else:
            analysis.status = AnalysisStatus.COMPLETED

        analysis.completed_at = timezone.now()
        analysis.save()

        # TODO: Enable RAG indexing when pgvector is available (see docs/RAG_IMPLEMENTATION_STATUS.md)
        # if analysis.status == AnalysisStatus.COMPLETED:
        #     try:
        #         from apps.rag.tasks import index_analysis_task
        #         index_analysis_task.delay(str(analysis.id))
        #     except Exception as e:
        #         logger.warning(f"Failed to queue RAG indexing for analysis {analysis_id}: {e}")

        logger.info(
            f"Auto-calibration {analysis_id} completed: best_dpo={best_dpo:.1f}nm, "
            f"Df={best_result.df:.4f}, npo={best_result.npo}, status={best_result.status}"
        )

        return {
            "status": "completed" if best_result.status == "success" else "failed",
            "analysis_id": analysis_id,
            "df": best_result.df,
            "npo": best_result.npo,
            "kf": best_result.kf,
            "best_dpo": best_dpo,
            "auto_calibrated": True,
        }

    except Exception as e:
        logger.exception(f"Auto-calibration {analysis_id} failed: {e}")
        analysis.status = AnalysisStatus.FAILED
        analysis.error_message = str(e)
        analysis.completed_at = timezone.now()
        analysis.save()
        return {
            "status": "failed",
            "analysis_id": analysis_id,
            "error": str(e),
        }


@shared_task(bind=True, max_retries=1)
def run_fraktal_analysis_task(self, analysis_id: str) -> dict:
    """Execute FRAKTAL fractal analysis using Rust engine.

    Supports both uploaded images and simulation projections.
    Uses either the 2012 granulated model or 2018 voxel model.
    """
    from .models import AnalysisStatus, FraktalAnalysis, SourceType

    analysis = FraktalAnalysis.objects.select_related("simulation").get(
        id=UUID(analysis_id)
    )

    # Update status to running
    analysis.status = AnalysisStatus.RUNNING
    analysis.started_at = timezone.now()
    analysis.save(update_fields=["status", "started_at"])

    try:
        # Step 1: Get the image (uploaded or from simulation projection)
        if analysis.source_type == SourceType.UPLOADED_IMAGE:
            # Load uploaded image
            image = Image.open(io.BytesIO(analysis.original_image))
        else:
            # Generate projection from simulation
            if analysis.simulation is None:
                raise ValueError("No simulation linked for projection-based analysis")

            if analysis.simulation.geometry is None:
                raise ValueError("Simulation has no geometry data")

            # Load simulation geometry
            geometry = np.load(io.BytesIO(analysis.simulation.geometry))
            coordinates = geometry[:, :3]
            radii = geometry[:, 3]

            # Get projection parameters
            proj_params = analysis.projection_params or {}
            azimuth = proj_params.get("azimuth", 0.0)
            elevation = proj_params.get("elevation", 0.0)
            resolution = int(proj_params.get("resolution", 512))

            # Generate 2D projection using Rust (geometry only).
            projection_result = aglogen_core.project_to_2d(
                coordinates=coordinates,
                radii=radii,
                azimuth=azimuth,
                elevation=elevation,
            )

            # Rasterize the projection to a grayscale array — this is
            # the input shape the FRAKTAL analyzers expect (identical to
            # what the batch path provides after PIL decoding).
            img_array = _rasterize_projection_to_grayscale(
                projection_result,
                img_size=resolution,
            )
            image = Image.fromarray(img_array, mode="L")

        # Step 2: Convert to grayscale numpy array
        if image.mode != "L":
            image = image.convert("L")
        img_array = np.array(image, dtype=np.uint8)

        # Step 3: Run FRAKTAL analysis using Rust
        logger.info(
            f"FRAKTAL params: npix={analysis.npix}, dpo={analysis.dpo}, "
            f"delta={analysis.delta}, correction_3d={analysis.correction_3d}, "
            f"pixel_min={analysis.pixel_min}, pixel_max={analysis.pixel_max}, "
            f"npo_limit={analysis.npo_limit}, escala={analysis.escala}"
        )
        logger.info(
            f"Image shape: {img_array.shape}, dtype: {img_array.dtype}, "
            f"min: {img_array.min()}, max: {img_array.max()}, mean: {img_array.mean():.1f}"
        )

        if analysis.model == "granulated_2012":
            result = aglogen_core.fraktal_granulated_2012(
                image=img_array,
                npix=analysis.npix,
                dpo=analysis.dpo,
                delta=analysis.delta,
                correction_3d=analysis.correction_3d,
                pixel_min=analysis.pixel_min,
                pixel_max=analysis.pixel_max,
                npo_limit=analysis.npo_limit,
                escala=analysis.escala,
            )
        else:  # voxel_2018
            result = aglogen_core.fraktal_voxel_2018(
                image=img_array,
                npix=analysis.npix,
                escala=analysis.escala,
                correction_3d=analysis.correction_3d,
                pixel_min=analysis.pixel_min,
                pixel_max=analysis.pixel_max,
                m_exponent=analysis.m_exponent,
            )

        # Step 4: Store results
        logger.info(
            f"FRAKTAL result: status={result.status}, df={result.df}, "
            f"rg={result.rg:.2f}, ap={result.ap:.2f}, npo={result.npo}, "
            f"npo_visual={result.npo_visual}, kf={result.kf:.4f}"
        )

        analysis.results = {
            "rg": result.rg,
            "ap": result.ap,
            "df": result.df,
            "npo": result.npo,
            "npo_visual": result.npo_visual,
            "kf": result.kf,
            "zf": result.zf,
            "jf": result.jf,
            "volume": result.volume,
            "mass": result.mass,
            "surface_area": result.surface_area,
            "status": result.status,
            "model": result.model,
            "npo_ratio": result.npo_ratio,
            "npo_aligned": result.npo_aligned,
            "dpo_estimated": result.dpo_estimated,
        }
        analysis.execution_time_ms = result.execution_time_ms
        analysis.engine_version = aglogen_core.version()

        # Check for analysis errors
        if result.status != "success":
            analysis.status = AnalysisStatus.FAILED
            analysis.error_message = f"FRAKTAL analysis failed: {result.status}"
        else:
            analysis.status = AnalysisStatus.COMPLETED

        analysis.completed_at = timezone.now()
        analysis.save()

        # TODO: Enable RAG indexing when pgvector is available (see docs/RAG_IMPLEMENTATION_STATUS.md)
        # if analysis.status == AnalysisStatus.COMPLETED:
        #     try:
        #         from apps.rag.tasks import index_analysis_task
        #         index_analysis_task.delay(str(analysis.id))
        #     except Exception as e:
        #         logger.warning(f"Failed to queue RAG indexing for analysis {analysis_id}: {e}")

        logger.info(
            f"FRAKTAL analysis {analysis_id} completed: Df={result.df:.4f}, "
            f"npo={result.npo}, status={result.status}"
        )

        return {
            "status": "completed" if result.status == "success" else "failed",
            "analysis_id": analysis_id,
            "df": result.df,
            "npo": result.npo,
            "kf": result.kf,
        }

    except Exception as e:
        logger.exception(f"FRAKTAL analysis {analysis_id} failed: {e}")
        analysis.status = AnalysisStatus.FAILED
        analysis.error_message = str(e)
        analysis.completed_at = timezone.now()
        analysis.save()

        return {
            "status": "failed",
            "analysis_id": analysis_id,
            "error": str(e),
        }


# ============================================================================
# FRAKTAL batch async builder (N > 30)
# ============================================================================


@shared_task(bind=True, name="apps.fractal_analysis.tasks.reanalyze_failed_batch")
def reanalyze_failed_batch_task(self, batch_id: str) -> dict:
    """Thin async wrapper for the R13 bulk re-analysis (>30 failed images).

    Reports ``{"batch_id": ...}`` on completion so the existing
    ``fraktal_status_view`` polling endpoint stays reusable (same contract
    as ``analyze_fraktal_batch_task``). Progress is reported per re-analyzed
    image via ``update_state`` (fix round F6) so the poller sees real
    ``PROGRESS`` ticks instead of a pinned 0.
    """
    from apps.fractal_analysis.models import FraktalBatch
    from apps.fractal_analysis.services.batch import reanalyze_failed_images

    def _report_progress(done: int, total: int) -> None:
        if self.request.id:
            self.update_state(
                state="PROGRESS",
                meta={
                    "progress": (done / total) if total else 0.0,
                    "current": done,
                    "total": total,
                    "stage": "reanalyzing",
                },
            )

    # Fix round F8: a batch deleted while the job sat in the queue must
    # surface a CLEAR failure to the poller, not a raw
    # ``FraktalBatch.DoesNotExist`` traceback.
    try:
        batch = FraktalBatch.objects.get(id=batch_id)
    except FraktalBatch.DoesNotExist:
        msg = (
            f"FRAKTAL batch {batch_id} not found — it was deleted before "
            "the failed-image re-analysis ran."
        )
        logger.warning("Re-analysis aborted: %s", msg)
        raise ValueError(msg) from None

    summary = reanalyze_failed_images(batch, progress_callback=_report_progress)

    logger.info(
        "FRAKTAL batch %s failed-image re-analysis completed: "
        "reanalyzed=%s still_failed=%s",
        batch_id,
        summary.get("reanalyzed"),
        summary.get("still_failed"),
    )
    return summary


@shared_task(bind=True, name="apps.fractal_analysis.tasks.analyze_fraktal_batch")
def analyze_fraktal_batch_task(
    self,
    images_npy_b64: list,
    image_shapes: list,
    filenames: list,
    metadata: dict | None,
    pixels_per_100nm: float,
    autocalibrate_dpo: bool,
    dpo_hint: float,
    algorithm: str,
    sim_id: str | None,
    calibration_source: str,
    project_id: str | None = None,
    user_id: str | None = None,
    zip_filename: str = "",
    per_image_scales: list[float] | None = None,
    scientific_png_b64: list[str | None] | None = None,
) -> dict:
    """Async batch FRAKTAL analysis when N > 30.

    Progress stages reported via ``self.update_state``:

    - ``autocalibrate`` — before the Rust call (0%).
    - ``analyzing`` — while the Rust batch orchestrator runs.
    - ``aggregating`` — after Rust returns (80%), while we persist to DB.

    Results are persisted to ``FraktalBatch`` + ``FraktalBatchImage`` rows.
    The return value includes ``batch_id`` for the polling endpoint.
    """
    import base64
    import io as _io
    import uuid as uuid_mod

    import aglogen_core
    import numpy as np
    from PIL import Image as _Image

    from apps.fractal_analysis.views import _build_batch_response

    total = len(images_npy_b64)

    if self.request.id:
        self.update_state(
            state="PROGRESS",
            meta={
                "progress": 0.0,
                "current": 0,
                "total": total,
                "stage": "autocalibrate",
            },
        )

    images = [
        np.frombuffer(base64.b64decode(b64), dtype=np.uint8).reshape(shape)
        for b64, shape in zip(images_npy_b64, image_shapes, strict=True)
    ]

    if self.request.id:
        self.update_state(
            state="PROGRESS",
            meta={
                "progress": 0.0,
                "current": 0,
                "total": total,
                "stage": "analyzing",
            },
        )

    # Determine per-image input variant based on scientific PNG availability.
    # When a scientific PNG is available for a direction, decode it and use
    # it as the engine input (pre-thresholded binary); otherwise fall back
    # to the presentation PNG.
    input_variants: list[str] = []
    if scientific_png_b64:
        for i, sci_b64 in enumerate(scientific_png_b64):
            if sci_b64:
                # Decode scientific PNG into grayscale array and replace
                # the presentation image so the engine sees binary input.
                sci_bytes = base64.b64decode(sci_b64)
                sci_img = _Image.open(_io.BytesIO(sci_bytes)).convert("L")
                images[i] = np.array(sci_img, dtype=np.uint8)
                input_variants.append("scientific")
            else:
                input_variants.append("presentation")
    else:
        input_variants = ["presentation"] * total

    if per_image_scales is not None:
        rust_result = aglogen_core.analyze_fraktal_batch_per_image_scale(
            images,
            per_image_scales,
            autocalibrate_dpo,
            dpo_hint,
            algorithm,
            input_variants=input_variants,
        )
    else:
        rust_result = aglogen_core.analyze_fraktal_batch(
            images,
            pixels_per_100nm,
            autocalibrate_dpo,
            dpo_hint,
            algorithm,
        )

    if self.request.id:
        self.update_state(
            state="PROGRESS",
            meta={
                "progress": 0.8,
                "current": total,
                "total": total,
                "stage": "aggregating",
            },
        )

    sim_uuid = uuid_mod.UUID(sim_id) if sim_id else None
    payload = _build_batch_response(
        rust_result,
        filenames,
        metadata,
        sim_uuid,
        pixels_per_100nm,
        calibration_source,
    )

    # Decode scientific PNGs from base64 transport format.
    scientific_png_list: list[bytes | None] | None = None
    if scientific_png_b64:
        scientific_png_list = [
            base64.b64decode(b) if b else None for b in scientific_png_b64
        ]

    # Persist to DB.
    batch_id = None
    if project_id:
        from apps.fractal_analysis.models import FraktalBatch
        from apps.fractal_analysis.services.batch import persist_batch_results

        batch = FraktalBatch.objects.create(
            project_id=uuid_mod.UUID(project_id),
            created_by_id=uuid_mod.UUID(user_id) if user_id else None,
            algorithm=algorithm,
            calibration_source=calibration_source,
            pixels_per_100nm=pixels_per_100nm,
            dpo_used=rust_result.get("dpo_used") or dpo_hint,
            autocalibrate_source=rust_result.get("autocalibrate_source"),
            autocalibrate_image_index=rust_result.get("autocalibrate_image_index"),
            sim_id=sim_uuid,
            original_zip_filename=zip_filename,
        )

        # Re-encode numpy arrays to PNG bytes for storage.
        png_list: list[bytes] = []
        for img_array in images:
            buf = _io.BytesIO()
            _Image.fromarray(img_array, mode="L").save(buf, format="PNG")
            png_list.append(buf.getvalue())

        persist_batch_results(
            batch,
            payload["images"],
            png_list,
            dpo_used=batch.dpo_used,
            scientific_png_list=scientific_png_list,
            input_variants=input_variants,
            pixels_per_100nm_list=per_image_scales,
        )
        batch_id = str(batch.id)

    logger.info(
        f"FRAKTAL batch task {self.request.id} completed: {total} images, "
        f"algorithm={algorithm}, calibration={calibration_source}"
    )

    return {
        "batch_id": batch_id,
        "n_images": total,
    }
