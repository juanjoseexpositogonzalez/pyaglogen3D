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
    # SUMMARY, n_images, <skip 2>, mean_df, std_df, median_df, min_df, max_df, <empty>, <empty>, <empty>, <empty>
    # Actually per spec: SUMMARY, n_images, mean_df, std_df, median_df, min_df, max_df,
    #                    sim_id, sim_target_df, sim_box_counting_df
    # We put SUMMARY in first col, then stats starting from col 2
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
    ]
    write_localized_row(writer, summary_row, decimal)

    return buf.getvalue()
