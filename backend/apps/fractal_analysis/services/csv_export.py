"""CSV export builders for FRAKTAL analyses.

Produces locale-aware CSV output using ``apps.core.services.csv_locale``.

- ``build_single_image_csv`` — single FraktalAnalysis → header + 1 row
- ``build_batch_csv`` — FraktalBatch → header + N rows + blank + SUMMARY row
"""

from __future__ import annotations

import csv
import io
from typing import TYPE_CHECKING

from apps.core.services.csv_locale import write_localized_row

if TYPE_CHECKING:
    from apps.fractal_analysis.models import FraktalAnalysis, FraktalBatch


# ---------------------------------------------------------------------------
# Single-image CSV (R3 csv-export-locale)
# ---------------------------------------------------------------------------

SINGLE_IMAGE_COLUMNS: list[str] = [
    "analysis_id",
    "created_at",
    "algorithm",
    "image_filename",
    "fractal_dimension",
    "prefactor",
    "r_squared",
    "n_particles_counted",
    "error",
    "dpo_used",
    "autocalibrate_source",
    "scale_factor_nm",
    "pixels_per_100nm",
    "rg",
    "ap",
    "volume",
    "mass",
    "surface_area",
    "sim_id",
    "sim_target_df",
    "sim_box_counting_df",
    "calibration_source",
    # PYA-13 P4: bisection diagnostic columns (appended for backwards compat).
    "quality",
    "bisection_iterations",
    "bisection_residual",
    "failure_reason",
    "df_estimate",
]


def build_single_image_csv(
    analysis: FraktalAnalysis,
    decimal: str,
    delimiter: str,
) -> str:
    """Build single-image CSV (header + 1 data row)."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter)
    writer.writerow(SINGLE_IMAGE_COLUMNS)

    results = analysis.results or {}

    # Resolve sim comparison fields
    sim_id = None
    sim_target_df = None
    sim_box_counting_df = None
    if analysis.simulation_id:
        sim_id = str(analysis.simulation_id)
        try:
            sim = analysis.simulation
            if sim:
                sim_params = sim.parameters or {}
                sim_metrics = sim.metrics or {}
                sim_target_df = sim_params.get("target_df")
                sim_box_counting_df = sim_metrics.get("fractal_dimension")
        except Exception:
            pass

    row = [
        str(analysis.id),
        str(analysis.created_at) if analysis.created_at else "",
        analysis.model,
        analysis.original_filename or "",
        results.get("df"),
        results.get("kf"),
        results.get("r_squared"),
        results.get("n_particles"),
        analysis.error_message or "",
        analysis.dpo,
        "autocalibrate" if analysis.auto_calibrate else "",
        analysis.escala,
        analysis.npix,
        results.get("rg"),
        results.get("ap"),
        results.get("volume"),
        results.get("mass"),
        results.get("surface_area"),
        sim_id,
        sim_target_df,
        sim_box_counting_df,
        "",  # calibration_source — not stored on FraktalAnalysis
        # PYA-13 P4: bisection diagnostic columns.
        results.get("quality") or "",
        results.get("bisection_iterations"),
        results.get("bisection_residual"),
        results.get("failure_reason") or "",
        results.get("df_estimate"),
    ]
    write_localized_row(writer, row, decimal)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Batch CSV (R4 csv-export-locale)
# ---------------------------------------------------------------------------

BATCH_IMAGE_COLUMNS: list[str] = [
    "index",
    "filename",
    "azimuth",
    "elevation",
    "fractal_dimension",
    "prefactor",
    "r_squared",
    "n_particles_counted",
    "error",
    "dpo_used",
    "autocalibrate_source",
    "scale_factor_nm",
    "pixels_per_100nm",
    # PYA-13 P4: bisection diagnostic columns (appended for backwards compat).
    "quality",
    "bisection_iterations",
    "bisection_residual",
    "failure_reason",
    "df_estimate",
]


def build_batch_csv(
    batch: FraktalBatch,
    decimal: str,
    delimiter: str,
) -> str:
    """Build batch CSV: header + N image rows + blank + SUMMARY row."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter)
    writer.writerow(BATCH_IMAGE_COLUMNS)

    images = batch.images.all().order_by("index")
    for img in images:
        row = [
            img.index,
            img.filename,
            img.azimuth,
            img.elevation,
            img.fractal_dimension,
            img.prefactor,
            img.r_squared,
            img.n_particles_counted,
            img.error or None,
            img.dpo_used,
            batch.autocalibrate_source or "",
            batch.pixels_per_100nm * 100
            if batch.pixels_per_100nm
            else None,  # scale_factor_nm
            batch.pixels_per_100nm,
            # PYA-13 P4: bisection diagnostic columns.
            img.quality or "",
            img.bisection_iterations,
            img.bisection_residual,
            img.failure_reason or "",
            img.df_estimate,
        ]
        write_localized_row(writer, row, decimal)

    # Blank line
    writer.writerow([])

    # Summary row — SUMMARY + stats + sim comparison
    sim_id = str(batch.sim_id) if batch.sim_id else None
    sim_target_df = None
    sim_box_counting_df = None
    if batch.sim_id:
        try:
            from apps.simulations.models import Simulation

            sim = Simulation.objects.get(id=batch.sim_id)
            sim_params = sim.parameters or {}
            sim_metrics = sim.metrics or {}
            sim_target_df = sim_params.get("target_df")
            sim_box_counting_df = sim_metrics.get("fractal_dimension")
        except Exception:
            pass

    # Pad summary row to match column count:
    # SUMMARY, n_images, mean_df, std_df, median_df, min_df, max_df,
    # sim_id, sim_target_df, sim_box_counting_df,
    # PYA-13 P4: n_converged, n_approximate, n_excluded, n_failed, mean_df_inclusive
    n_converged = images.filter(quality="converged").count()
    n_approximate = images.filter(quality="approximate").count()
    n_excluded = images.filter(quality="excluded").count()
    n_failed = images.filter(quality="failed").count()

    # mean_df_inclusive: mean of converged + approximate Df values.
    inclusive_dfs = [
        img.fractal_dimension
        for img in images
        if img.quality in ("converged", "approximate")
        and img.fractal_dimension is not None
    ]
    mean_df_inclusive = (
        sum(inclusive_dfs) / len(inclusive_dfs) if inclusive_dfs else None
    )

    summary_row: list = [
        "SUMMARY",
        batch.n_images,
        batch.mean_df,
        batch.std_df,
        batch.median_df,
        batch.min_df,
        batch.max_df,
        sim_id,
        sim_target_df,
        sim_box_counting_df,
        # PYA-13 P4: quality counters + mean_df_inclusive.
        n_converged,
        n_approximate,
        n_excluded,
        n_failed,
        mean_df_inclusive,
    ]
    write_localized_row(writer, summary_row, decimal)

    return buf.getvalue()
