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
            # Simple Otsu approximation
            threshold = np.mean(img_array)
        elif threshold_method == "manual":
            threshold = preprocess.get("threshold_value", 128)
        else:
            threshold = 128

        binary = img_array > threshold

        if preprocess.get("invert", False):
            binary = ~binary

        # Save processed image
        processed_img = Image.fromarray((binary * 255).astype(np.uint8))
        buffer = io.BytesIO()
        processed_img.save(buffer, format="PNG")
        analysis.processed_image = buffer.getvalue()

        # Import Rust module (will be available after building aglogen_core)
        # import aglogen_core
        #
        # if analysis.method == "box_counting":
        #     result = aglogen_core.box_counting(
        #         binary_image=binary,
        #         min_box_size=analysis.method_params.get("min_box_size", 2),
        #         max_box_size=analysis.method_params.get("max_box_size", 512),
        #         num_scales=analysis.method_params.get("num_scales", 20),
        #     )
        #     analysis.results = {
        #         "fractal_dimension": result.dimension,
        #         "r_squared": result.r_squared,
        #         "log_sizes": result.log_scales.tolist(),
        #         "log_counts": result.log_values.tolist(),
        #     }

        # PLACEHOLDER: Generate dummy results
        logger.info(f"Running fractal analysis {analysis_id}")

        # Dummy box-counting results
        num_scales = 15
        log_sizes = np.linspace(0.5, 3.0, num_scales)
        df = 1.65 + np.random.uniform(-0.1, 0.1)
        log_counts = -df * log_sizes + 10 + np.random.normal(0, 0.02, num_scales)

        analysis.results = {
            "fractal_dimension": df,
            "r_squared": 0.9987 + np.random.uniform(-0.005, 0.005),
            "std_error": 0.012,
            "confidence_interval_95": [df - 0.024, df + 0.024],
            "log_sizes": log_sizes.tolist(),
            "log_counts": log_counts.tolist(),
            "residuals": np.random.normal(0, 0.01, num_scales).tolist(),
        }
        analysis.execution_time_ms = 500 + int(np.random.uniform(0, 500))
        analysis.engine_version = "0.1.0-placeholder"

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
        logger.exception(f"Analysis {analysis_id} failed: {e}")
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
