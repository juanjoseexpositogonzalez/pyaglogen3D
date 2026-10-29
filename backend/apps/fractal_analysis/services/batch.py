"""FRAKTAL batch analysis services.

Transport-agnostic helpers for:
- Extracting images + metadata from uploaded ZIPs
- Resolving calibration scale per spec R1/R2 precedence
- Detecting sim_id from filename pattern
- Computing batch statistics + histogram
- Building comparison card data

Spec: fraktal-batch-contract.md (R1, R2, R7, R8, R9, R11).
"""

from __future__ import annotations

import io
import json
import re
import uuid
import zipfile
from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING, Any

import numpy as np
from PIL import Image

from .json_safe import json_safe_float

if TYPE_CHECKING:
    from apps.fractal_analysis.models import FraktalBatch

# ---------------------------------------------------------------------------
# R11 — Sorensen educational note (fixed text).
# ---------------------------------------------------------------------------

SORENSEN_NOTE = (
    "Note: 2D projection fractal dimension is systematically lower than "
    "the 3D aggregate Df (Sorensen 1992). Typical gap: 0.1–0.3. "
    "This is expected and does NOT indicate simulation error."
)


# ---------------------------------------------------------------------------
# R1 / R2 — ZIP extraction + metadata parsing
# ---------------------------------------------------------------------------

_SIM_ID_FILENAME_RE = re.compile(
    r"^(?P<uuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_",
    re.IGNORECASE,
)


def extract_zip_images(
    zip_bytes: bytes,
) -> tuple[list[np.ndarray], dict[str, Any] | None, list[str]]:
    """Open a ZIP, decode PNG images, parse ``metadata.json`` if present.

    Returns:
        Tuple of ``(images_as_grayscale_arrays, metadata_dict_or_None,
        png_filenames_sorted)``.

    ``*.scientific.png`` files are excluded from the returned image list —
    they are handled separately via :func:`extract_scientific_png_map`.
    Non-PNG entries are silently filtered out.  PNG filenames are sorted so
    downstream batch ordering is deterministic.  ``metadata.json`` parse
    errors are swallowed (metadata becomes ``None``) so that image
    processing can still proceed.

    Raises:
        ValueError: If the bytes are not a valid ZIP or the ZIP contains
            no presentation PNG images.
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as e:
        raise ValueError(f"Invalid ZIP file: {e}") from e

    names = zf.namelist()
    # Exclude *.scientific.png — those are a separate render variant
    png_names = sorted(
        n
        for n in names
        if n.lower().endswith(".png") and not n.lower().endswith(".scientific.png")
    )

    metadata: dict[str, Any] | None = None
    if "metadata.json" in names:
        try:
            metadata = json.loads(zf.read("metadata.json").decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            metadata = None  # malformed — continue with images only

    if not png_names:
        raise ValueError("ZIP contains no PNG images")

    images: list[np.ndarray] = []
    for name in png_names:
        with zf.open(name) as f:
            img = Image.open(f).convert("L")  # grayscale
            images.append(np.array(img, dtype=np.uint8))

    return images, metadata, png_names


def extract_scientific_png_map(
    zip_bytes: bytes,
    metadata: dict[str, Any] | None,
) -> dict[str, bytes]:
    """Extract ``*.scientific.png`` bytes from a ZIP, keyed by presentation filename.

    Uses ``metadata.directions[i].filename_scientific`` when available to map
    each direction's scientific PNG to its presentation counterpart.  Returns
    an empty dict for legacy ZIPs that contain no scientific PNGs.

    The returned dict maps ``presentation_filename -> raw_scientific_png_bytes``.
    """
    if not metadata or not isinstance(metadata.get("directions"), list):
        return {}

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        return {}

    zip_names = set(zf.namelist())
    result: dict[str, bytes] = {}

    for d in metadata["directions"]:
        if not isinstance(d, dict):
            continue
        pres_fn = d.get("filename")
        sci_fn = d.get("filename_scientific")
        if not pres_fn or not sci_fn:
            continue
        if sci_fn in zip_names:
            result[pres_fn] = zf.read(sci_fn)

    return result


def extract_per_image_scales(
    metadata: dict[str, Any] | None,
    filenames: list[str],
) -> list[float] | None:
    """Extract per-direction ``pixels_per_100nm`` from ``metadata.directions``.

    Returns a list of floats (one per presentation filename in *filenames*
    order) when at least one direction carries a per-image scale.  Directions
    without a per-image scale fall back to the top-level
    ``parameters.pixels_per_100nm`` (broadcast value).

    Returns ``None`` when no per-direction scale is found at all (fully
    legacy ZIP) — callers should use the top-level scale as a single float.
    """
    if not isinstance(metadata, dict):
        return None

    directions = metadata.get("directions")
    if not isinstance(directions, list):
        return None

    top_level = extract_scale_from_metadata(metadata)

    # Build filename → per-direction scale map
    fn_to_scale: dict[str, float] = {}
    has_any = False
    for d in directions:
        if not isinstance(d, dict):
            continue
        fn = d.get("filename")
        per_dir_scale = d.get("pixels_per_100nm")
        if (
            fn
            and isinstance(per_dir_scale, (int, float))
            and not isinstance(per_dir_scale, bool)
            and np.isfinite(per_dir_scale)
            and per_dir_scale > 0
        ):
            fn_to_scale[fn] = float(per_dir_scale)
            has_any = True

    if not has_any:
        return None

    # Build ordered list matching filenames
    result: list[float] = []
    for fn in filenames:
        if fn in fn_to_scale:
            result.append(fn_to_scale[fn])
        elif top_level is not None:
            result.append(top_level)
        else:
            # Cannot resolve scale for this direction — caller should
            # fall back to single-float broadcast
            return None

    return result


def extract_scale_from_metadata(metadata: dict[str, Any] | None) -> float | None:
    """Return ``metadata.parameters.pixels_per_100nm`` (nested path per R1).

    Returns ``None`` when:
    - ``metadata`` is ``None`` or not a dict
    - ``metadata.parameters`` is missing or not a dict
    - ``parameters.pixels_per_100nm`` is missing, non-numeric, non-finite,
      zero, or negative
    """
    if not isinstance(metadata, dict):
        return None
    params = metadata.get("parameters")
    if not isinstance(params, dict):
        return None
    value = params.get("pixels_per_100nm")
    # Reject booleans (bool is a subclass of int) and non-numeric types.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not np.isfinite(value) or value <= 0:
        return None
    return float(value)


# ---------------------------------------------------------------------------
# R9 — Filename → sim_id detection
# ---------------------------------------------------------------------------


def detect_sim_id_from_filename(zip_filename: str) -> uuid.UUID | None:
    """Match pattern ``{uuid}_`` at the start of a filename (per R9).

    Accepts any filename that starts with a full RFC 4122 UUID followed
    by ``_``. Returns the parsed :class:`uuid.UUID`, or ``None`` when
    the filename is empty or does not match.
    """
    if not zip_filename:
        return None
    m = _SIM_ID_FILENAME_RE.match(zip_filename)
    if not m:
        return None
    try:
        return uuid.UUID(m.group("uuid"))
    except ValueError:
        return None


def _build_study_comparison(
    sim_id: uuid.UUID | None,
    image_rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Build the additive ``study_comparison`` block (R12, change
    fraktal-batch-extensions).

    ONE shared helper consumed by ALL THREE summary builders
    (``_build_batch_response``, ``_serialize_batch_from_db`` and the inline
    ``batch_detail_view``) so all three emit IDENTICAL content.

    Takes primitives — ``sim_id`` + already-built per-image ``image_rows``
    (dicts carrying ``quality``, ``fractal_dimension``, ``df_estimate``) —
    because builder 1 runs BEFORE the ``FraktalBatch`` row exists.

    Population per canonical R7: ``fractal_dimension`` when
    ``quality == "converged"`` and ``df_estimate`` when
    ``quality == "approximate"``. Returns ``None`` (block absent) when: no
    sim, the sim row was deleted, the sim metric is missing or carries the
    ``0.0`` sentinel, or there are zero contributing image values (D3).
    """
    if sim_id is None:
        return None

    # Imported lazily to keep this module Django-free at import time and to
    # avoid circular imports from apps.simulations.
    from apps.simulations.models import Simulation

    try:
        sim = Simulation.objects.get(id=sim_id)
    except Simulation.DoesNotExist:
        return None

    # sim_df.value — the SINGLE source for the C2 reference marker. The 0.0
    # sentinel counts as MISSING (identical rule in R12, R-DELTA-C2 and D1).
    metrics = sim.metrics or {}
    raw_value = metrics.get("fractal_dimension")
    if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
        return None
    sim_value = float(raw_value)
    if not np.isfinite(sim_value) or sim_value == 0.0:
        return None

    values: list[float] = []
    n_converged = 0
    n_approximate = 0
    for row in image_rows:
        quality = row.get("quality")
        if quality == "converged":
            raw = row.get("fractal_dimension")
        elif quality == "approximate":
            raw = row.get("df_estimate")
        else:
            continue
        if raw is None:
            continue
        v = float(raw)
        if not np.isfinite(v):
            continue
        values.append(v)
        if quality == "converged":
            n_converged += 1
        else:
            n_approximate += 1

    if not values:
        return None

    arr = np.array(values, dtype=np.float64)

    parameters = sim.parameters or {}
    raw_target = parameters.get("target_df")
    if isinstance(raw_target, bool) or not isinstance(raw_target, (int, float)):
        target_df: float | None = None
    else:
        target_df = float(raw_target)

    deltas = [v - sim_value for v in values]

    return {
        "sim_id": str(sim_id),
        "images_with_df": len(values),
        "images_without_df": len(image_rows) - len(values),
        "image_df": {
            "n": len(values),
            "mean": float(np.mean(arr)),
            "median": float(np.median(arr)),
            "min": float(np.min(arr)),
            "max": float(np.max(arr)),
            "n_converged": n_converged,
            "n_approximate": n_approximate,
        },
        "sim_df": {"value": sim_value, "target_df": target_df},
        "deltas": deltas,
        "mean_delta": float(np.mean(deltas)),
        "show_sorensen_note": True,
    }


def build_comparison_data(
    sim_id: uuid.UUID | None,
    batch_mean_df: float | None,
    batch_std_df: float | None,
) -> dict[str, Any] | None:
    """Build the comparison card payload (R9 + R11).

    - ``sim_id is None`` → returns ``None`` (no comparison card rendered).
    - Simulation not found → returns the card with ``sim_name`` / target
      / box-counting values set to ``None``.
    - Simulation found → fills ``sim_target_df`` from ``sim.parameters``
      and ``sim_box_counting_df`` from ``sim.metrics``.

    The Sorensen educational note (R11) is always included when a card
    is returned.
    """
    if sim_id is None:
        return None

    # Imported lazily to keep this module Django-free when possible and to
    # avoid circular imports from apps.simulations.
    from apps.simulations.models import Simulation

    try:
        sim = Simulation.objects.get(id=sim_id)
    except Simulation.DoesNotExist:
        return {
            "sim_id": str(sim_id),
            "sim_name": None,
            "sim_target_df": None,
            "sim_box_counting_df": None,
            "batch_mean_df": batch_mean_df,
            "batch_std_df": batch_std_df,
            "sorensen_note": SORENSEN_NOTE,
        }

    parameters = sim.parameters or {}
    metrics = sim.metrics or {}
    return {
        "sim_id": str(sim_id),
        "sim_name": sim.name or None,
        "sim_target_df": parameters.get("target_df"),
        "sim_box_counting_df": metrics.get("fractal_dimension"),
        "batch_mean_df": batch_mean_df,
        "batch_std_df": batch_std_df,
        "sorensen_note": SORENSEN_NOTE,
    }


# ---------------------------------------------------------------------------
# R7 — Batch statistics
# ---------------------------------------------------------------------------


def compute_batch_statistics(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute descriptive stats over per-image ``fractal_dimension`` values.

    Tolerates ``None`` entries (failed images). Returned dict shape:

        {
          "n_images": int,
          "n_successful": int,
          "mean_df": float | None,
          "std_df": float | None,
          "median_df": float | None,
          "q1_df": float | None,
          "q3_df": float | None,
          "min_df": float | None,
          "max_df": float | None,
        }

    All statistics are ``None`` when no image succeeded. For ``n=1``, the
    population standard deviation is ``0.0`` (not ``NaN``).
    """
    df_values = [
        r.get("fractal_dimension")
        for r in results
        if r.get("fractal_dimension") is not None
    ]
    n_successful = len(df_values)

    base: dict[str, Any] = {
        "n_images": len(results),
        "n_successful": n_successful,
        "mean_df": None,
        "std_df": None,
        "median_df": None,
        "q1_df": None,
        "q3_df": None,
        "min_df": None,
        "max_df": None,
    }

    if n_successful == 0:
        return base

    arr = np.array(df_values, dtype=np.float64)
    base["mean_df"] = float(np.mean(arr))
    base["std_df"] = float(np.std(arr, ddof=0))  # population; 0.0 at N=1
    base["median_df"] = float(np.median(arr))
    base["q1_df"] = float(np.percentile(arr, 25))
    base["q3_df"] = float(np.percentile(arr, 75))
    base["min_df"] = float(np.min(arr))
    base["max_df"] = float(np.max(arr))
    return base


def compute_metric_stats(images: list[dict[str, Any]], key: str) -> dict[str, Any]:
    """Compute {mean, std, median, min, max} for a given metric key.

    Filters out ``None`` values (failed images). Returns all-null dict
    when no valid values exist. Population std (ddof=0).
    """
    values = [img[key] for img in images if img.get(key) is not None]

    null_result: dict[str, Any] = {
        "mean": None,
        "std": None,
        "median": None,
        "min": None,
        "max": None,
    }

    if not values:
        return null_result

    arr = np.array(values, dtype=np.float64)
    return {
        "mean": float(np.mean(arr)),
        "std": float(np.std(arr, ddof=0)),
        "median": float(np.median(arr)),
        "min": float(np.min(arr)),
        "max": float(np.max(arr)),
    }


# ---------------------------------------------------------------------------
# R8 — Histogram (FD ≥ 10 / Sturges 5-9 / omit < 5)
# ---------------------------------------------------------------------------


def compute_histogram(df_values: list[float | None]) -> dict[str, Any] | None:
    """Build histogram data per R8.

    - ``n < 5`` → ``None`` (not enough data to render a meaningful histogram).
    - ``5 ≤ n < 10`` → Sturges' rule, ``rule_used='sturges'``.
    - ``n ≥ 10`` → Freedman–Diaconis rule, ``rule_used='freedman_diaconis'``.
      Falls back to ``sqrt`` when IQR is zero (all values identical).

    ``None`` and non-finite values are filtered out before counting.

    Returns:
        ``{"bin_edges": list[float], "counts": list[int], "rule_used": str}``
        or ``None`` when there are fewer than 5 finite values.
    """
    vals = [v for v in df_values if v is not None and np.isfinite(v)]
    n = len(vals)

    if n < 5:
        return None

    arr = np.array(vals, dtype=np.float64)

    if n < 10:
        # Sturges: k = ceil(log2(n) + 1)
        n_bins = max(1, int(np.ceil(np.log2(n) + 1)))
        rule_used = "sturges"
    else:
        # Freedman–Diaconis: bin_width = 2 * IQR / n^(1/3)
        iqr = float(np.percentile(arr, 75) - np.percentile(arr, 25))
        if iqr <= 0:
            # Degenerate (all values identical) → sqrt-rule fallback.
            n_bins = max(1, int(np.ceil(np.sqrt(n))))
            rule_used = "sqrt"
        else:
            bin_width = 2 * iqr / (n ** (1 / 3))
            data_range = float(arr.max() - arr.min())
            if data_range > 0:
                n_bins = max(1, int(np.ceil(data_range / bin_width)))
            else:
                n_bins = 1
            rule_used = "freedman_diaconis"

    counts, bin_edges = np.histogram(arr, bins=n_bins)
    return {
        "bin_edges": bin_edges.tolist(),
        "counts": counts.tolist(),
        "rule_used": rule_used,
    }


# ---------------------------------------------------------------------------
# Persist helper — shared by sync + async batch paths
# ---------------------------------------------------------------------------


def persist_batch_results(
    batch: FraktalBatch,
    image_results: list[dict[str, Any]],
    png_list: list[bytes],
    dpo_used: float,
    scientific_png_list: list[bytes | None] | None = None,
    input_variants: list[str] | None = None,
    pixels_per_100nm_list: Sequence[float | None] | None = None,
) -> None:
    """Write per-image rows and update batch summary fields.

    Creates one ``FraktalBatchImage`` per entry in *image_results*, stores
    the corresponding PNG bytes from *png_list*, and updates the aggregate
    statistics on the parent ``FraktalBatch``.

    Both the sync path (≤30 images) and the Celery task call this after
    the Rust analyzer returns.

    Args:
        batch: The ``FraktalBatch`` instance (already saved with core metadata).
        image_results: Per-image dicts from ``_build_batch_response``.
        png_list: Parallel list of raw PNG bytes (same length as *image_results*).
        dpo_used: The ``dpo`` value used for analysis (stored on each image row).
        scientific_png_list: Optional parallel list of scientific PNG bytes.
            ``None`` entries or a missing list → ``png_scientific_bytes = NULL``.
        input_variants: Optional parallel list of variant strings
            (``"scientific"`` or ``"presentation"``).  When ``None``, all
            rows default to ``"presentation"`` (backward-compatible).
        pixels_per_100nm_list: Optional parallel list of per-image
            calibration scales (from ``directions[i].pixels_per_100nm``
            with the batch broadcast fallback, i.e. the output of
            ``extract_per_image_scales``). When ``None`` (legacy ZIP),
            every row stores the batch-level broadcast value
            (``batch.pixels_per_100nm``). Populated at FIRST analysis per
            the persistence delta R2; re-analysis (R13) reuses the
            persisted value instead of this argument.
    """
    from apps.fractal_analysis.models import FraktalBatchImage

    rows = []
    for i, result in enumerate(image_results):
        png_bytes = png_list[i] if i < len(png_list) else b""
        sci_bytes: bytes | None = None
        if scientific_png_list is not None and i < len(scientific_png_list):
            sci_bytes = scientific_png_list[i]
        variant = "presentation"
        if input_variants is not None and i < len(input_variants):
            variant = input_variants[i]

        # fraktal-batch-extensions R2 (MODIFIED): per-image calibration scale
        # populated at FIRST analysis. Source: directions[i].pixels_per_100nm
        # when the ZIP direction carries it (already resolved — with batch
        # broadcast fallback — by extract_per_image_scales), else the
        # batch-level broadcast value. Pre-migration rows are not backfilled.
        candidate: float | None = None
        if pixels_per_100nm_list is not None and i < len(pixels_per_100nm_list):
            candidate = pixels_per_100nm_list[i]
        row_ppn = candidate if candidate is not None else batch.pixels_per_100nm

        # PYA-13 T3.3: quality override safety net.
        # Engine Default impl returns quality="converged" even for blank/error
        # images that fail BEFORE bisection runs. Override to "failed" when
        # the engine surfaced an error string.
        engine_quality = result.get("quality") or "converged"
        engine_error = result.get("error")
        quality = "failed" if engine_error else engine_quality

        rows.append(
            FraktalBatchImage(
                batch=batch,
                index=result.get("index", i),
                filename=result.get("filename") or "",
                azimuth=result.get("azimuth"),
                elevation=result.get("elevation"),
                fractal_dimension=json_safe_float(  # type: ignore[no-untyped-call]
                    result.get("fractal_dimension")
                ),
                prefactor=json_safe_float(  # type: ignore[no-untyped-call]
                    result.get("prefactor")
                ),
                r_squared=json_safe_float(  # type: ignore[no-untyped-call]
                    result.get("r_squared")
                ),
                n_particles_counted=result.get("n_particles_counted"),
                rg_nm=json_safe_float(  # type: ignore[no-untyped-call]
                    result.get("rg_nm")
                ),
                dpo_used=dpo_used,
                error=engine_error or "",
                image_png=png_bytes,
                png_scientific_bytes=sci_bytes,
                analysis_input_variant=variant,
                bisection_iterations=result.get("bisection_iterations"),
                bisection_residual=json_safe_float(  # type: ignore[no-untyped-call]
                    result.get("bisection_residual")
                ),
                failure_reason=result.get("failure_reason"),
                df_estimate=json_safe_float(  # type: ignore[no-untyped-call]
                    result.get("df_estimate")
                ),
                quality=quality,
                pixels_per_100nm=row_ppn,
            )
        )
    FraktalBatchImage.objects.bulk_create(rows)

    # Update batch summary from successful results.
    df_values = [
        r["fractal_dimension"]
        for r in image_results
        if r.get("fractal_dimension") is not None
    ]
    n_successful = len(df_values)
    batch.n_images = len(image_results)
    batch.n_successful = n_successful

    if n_successful > 0:
        arr = np.array(df_values, dtype=np.float64)
        batch.mean_df = float(np.mean(arr))
        batch.std_df = float(np.std(arr, ddof=0))
        batch.median_df = float(np.median(arr))
        batch.min_df = float(np.min(arr))
        batch.max_df = float(np.max(arr))
    else:
        batch.mean_df = None
        batch.std_df = None
        batch.median_df = None
        batch.min_df = None
        batch.max_df = None

    batch.save(
        update_fields=[
            "n_images",
            "n_successful",
            "mean_df",
            "std_df",
            "median_df",
            "min_df",
            "max_df",
        ]
    )


# ---------------------------------------------------------------------------
# R13 — In-place bulk re-analysis of failed images (fraktal-batch-extensions)
# ---------------------------------------------------------------------------


def reanalyze_failed_images(
    batch: FraktalBatch,
    progress_callback: Callable[[int, int], None] | None = None,
) -> dict[str, Any]:
    """Re-analyze ONLY the ``quality == "failed"`` images of *batch*, in place.

    R13 (change ``fraktal-batch-extensions``). Each failed
    ``FraktalBatchImage`` row is UPDATED by pk (never delete/reinsert) with
    the fresh analysis result fields plus ``pixels_per_100nm``. Preserved
    unchanged: ``png_bytes`` / ``image_png``, ``png_scientific_bytes`` (no
    re-rasterization — the PNG endpoint serves ``Cache-Control: immutable``
    and canonical persistence requires hash-equal bytes),
    ``analysis_input_variant`` (reused as engine input), ``filename``,
    ``azimuth``, ``elevation``, ``index``. Inputs: ``dpo = batch.dpo_used``,
    ``autocalibrate_dpo = False``.

    Calibration: uses the persisted per-image ``pixels_per_100nm`` when
    present, else the batch scale; the batch-level ``calibration_source`` is
    left unchanged (per-image provenance is observable only through the new
    field).

    After the row updates the batch aggregates are recomputed over the FULL
    row set — EXACTLY the 7 persisted columns ``persist_batch_results``
    writes. The failed SUBSET is analyzed as a subset but is NEVER handed to
    ``persist_batch_results`` (that helper would overwrite
    ``batch.n_images = len(image_results)``). ``q1_df``/``q3_df`` are
    read-derived builder-1-only values and ``mean_df_inclusive`` is computed
    at read time — neither is persisted nor recomputed here.

    The row updates + aggregate recompute run inside a single
    ``transaction.atomic`` block (judgment-day fix round: no torn state
    between rows and aggregates).

    Args:
        batch: The ``FraktalBatch`` whose failed images are re-analyzed.
        progress_callback: Optional ``callback(done, total)`` invoked after
            each row update (judgment-day fix round: drives Celery
            ``update_state`` progress ticks in the async wrapper).

    Returns a small summary dict (``reanalyzed`` / ``still_failed`` counts).
    """
    import aglogen_core
    from django.db import transaction

    from apps.fractal_analysis.models import FraktalBatchImage

    failed_rows = list(
        FraktalBatchImage.objects.filter(batch=batch, quality="failed").order_by(
            "index"
        )
    )
    if not failed_rows:
        return {"reanalyzed": 0, "still_failed": 0}

    images: list[np.ndarray] = []
    scales: list[float] = []
    input_variants: list[str] = []
    for row in failed_rows:
        # Reuse the SAME input variant recorded at first analysis — no
        # re-rasterization, PNG bytes stay hash-equal. The variant MUST be
        # forwarded to the engine: scientific rows carry pre-thresholded
        # binary bytes, and letting the binding default to Presentation
        # would re-clip 0/255 pixels (pixel_min/pixel_max) and
        # deterministically re-fail the row (judgment-day fix round F1).
        variant = row.analysis_input_variant or "presentation"
        input_variants.append(variant)
        if variant == "scientific" and row.png_scientific_bytes:
            raw = bytes(row.png_scientific_bytes)
        else:
            raw = bytes(row.image_png)
        images.append(
            np.array(Image.open(io.BytesIO(raw)).convert("L"), dtype=np.uint8)
        )
        # R2 MODIFIED: persisted per-image scale wins; NULL (pre-migration
        # rows) falls back to the batch scale. calibration_source untouched.
        scales.append(
            float(row.pixels_per_100nm)
            if row.pixels_per_100nm is not None
            else float(batch.pixels_per_100nm)
        )

    # Subset analysis ONLY — never pass the subset to persist_batch_results.
    # The per-row input variant is forwarded (fix round F1) so scientific
    # rows are re-analyzed as scientific, not silently downgraded.
    # getattr: the installed pyo3 module is a dynamic shim; static
    # introspection cannot see its attributes. (ruff B009 noqa deliberate.)
    analyze_per_image_scale = getattr(  # noqa: B009
        aglogen_core, "analyze_fraktal_batch_per_image_scale"
    )
    rust_result = analyze_per_image_scale(
        images,
        scales,
        False,
        batch.dpo_used,
        batch.algorithm,
        input_variants=input_variants,
    )
    results: list[dict[str, Any]] = rust_result.get("results", [])

    update_fields = [
        "fractal_dimension",
        "prefactor",
        "r_squared",
        "n_particles_counted",
        "dpo_used",
        "error",
        "rg_nm",
        "quality",
        "df_estimate",
        "bisection_iterations",
        "bisection_residual",
        "failure_reason",
        "pixels_per_100nm",
    ]
    still_failed = 0
    done = 0
    total = len(failed_rows)
    with transaction.atomic():
        for row, result, scale in zip(failed_rows, results, scales, strict=True):
            engine_error = result.get("error")
            # Same PYA-13 T3.3 safety net as persist_batch_results: an engine
            # error string forces quality="failed" so the row stays
            # re-analyzable and cannot feed a stale estimate into the
            # aggregates.
            quality = (
                "failed" if engine_error else (result.get("quality") or "converged")
            )
            if quality == "failed":
                still_failed += 1
            row.fractal_dimension = json_safe_float(  # type: ignore[no-untyped-call]
                result.get("fractal_dimension")
            )
            row.prefactor = json_safe_float(  # type: ignore[no-untyped-call]
                result.get("prefactor")
            )
            row.r_squared = json_safe_float(  # type: ignore[no-untyped-call]
                result.get("r_squared")
            )
            row.n_particles_counted = result.get("n_particles_counted")
            row.dpo_used = float(result.get("dpo_used") or batch.dpo_used)
            row.error = engine_error or ""
            row.rg_nm = json_safe_float(  # type: ignore[no-untyped-call]
                result.get("rg_nm")
            )
            row.quality = quality
            row.df_estimate = json_safe_float(  # type: ignore[no-untyped-call]
                result.get("df_estimate")
            )
            row.bisection_iterations = result.get("bisection_iterations")
            row.bisection_residual = json_safe_float(  # type: ignore[no-untyped-call]
                result.get("bisection_residual")
            )
            row.failure_reason = result.get("failure_reason")
            # Fix round F10 (no backfill): only rows whose persisted value is
            # already non-null get the field refreshed. Pre-migration NULL
            # rows stay NULL — the batch fallback applies at analysis time
            # only (it is what was passed to the engine), never persisted.
            if row.pixels_per_100nm is not None:
                row.pixels_per_100nm = scale
            row.save(update_fields=update_fields)  # UPDATE by pk — in place
            done += 1
            if progress_callback is not None:
                progress_callback(done, total)

        # Aggregate recompute over the FULL row set — exactly the 7 persisted
        # columns of persist_batch_results (populations: mean over non-null
        # fractal_dimension, ddof=0; n_successful = non-null count).
        # Fix round 2 (fresh-pass JD-A-001): this MUST live inside the same
        # transaction.atomic as the row updates — otherwise a failure between
        # the row saves and batch.save leaves per-image values with stale
        # aggregates (the "no min_df > mean_df-class incoherence" pin of
        # R13).
        all_rows = list(FraktalBatchImage.objects.filter(batch=batch))
        df_values = [
            r.fractal_dimension for r in all_rows if r.fractal_dimension is not None
        ]
        batch.n_images = len(all_rows)
        batch.n_successful = len(df_values)
        if df_values:
            arr = np.array(df_values, dtype=np.float64)
            batch.mean_df = float(np.mean(arr))
            batch.std_df = float(np.std(arr, ddof=0))
            batch.median_df = float(np.median(arr))
            batch.min_df = float(np.min(arr))
            batch.max_df = float(np.max(arr))
        else:
            batch.mean_df = None
            batch.std_df = None
            batch.median_df = None
            batch.min_df = None
            batch.max_df = None
        batch.save(
            update_fields=[
                "n_images",
                "n_successful",
                "mean_df",
                "std_df",
                "median_df",
                "min_df",
                "max_df",
            ]
        )

    return {
        "reanalyzed": len(failed_rows),
        "still_failed": still_failed,
        "batch_id": str(batch.id),
    }
