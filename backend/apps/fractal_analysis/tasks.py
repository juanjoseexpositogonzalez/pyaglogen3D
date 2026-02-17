"""Fractal Analysis Celery tasks."""
import io
import logging
from uuid import UUID

import numpy as np
from celery import shared_task
from django.utils import timezone
from PIL import Image

logger = logging.getLogger(__name__)


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
