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

import numpy as np
from PIL import Image

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
) -> tuple[list[np.ndarray], dict | None, list[str]]:
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

    metadata: dict | None = None
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
    metadata: dict | None,
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
    metadata: dict | None,
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
        ):
            if np.isfinite(per_dir_scale) and per_dir_scale > 0:
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


def extract_scale_from_metadata(metadata: dict | None) -> float | None:
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


def build_comparison_data(
    sim_id: uuid.UUID | None,
    batch_mean_df: float | None,
    batch_std_df: float | None,
) -> dict | None:
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


def compute_batch_statistics(results: list[dict]) -> dict:
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

    base: dict = {
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


def compute_metric_stats(images: list[dict], key: str) -> dict:
    """Compute {mean, std, median, min, max} for a given metric key.

    Filters out ``None`` values (failed images). Returns all-null dict
    when no valid values exist. Population std (ddof=0).
    """
    values = [img[key] for img in images if img.get(key) is not None]

    null_result: dict = {
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


def compute_histogram(df_values: list[float | None]) -> dict | None:
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
    batch: "FraktalBatch",
    image_results: list[dict],
    png_list: list[bytes],
    dpo_used: float,
    scientific_png_list: list[bytes | None] | None = None,
    input_variants: list[str] | None = None,
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
        rows.append(
            FraktalBatchImage(
                batch=batch,
                index=result.get("index", i),
                filename=result.get("filename") or "",
                azimuth=result.get("azimuth"),
                elevation=result.get("elevation"),
                fractal_dimension=result.get("fractal_dimension"),
                prefactor=result.get("prefactor"),
                r_squared=result.get("r_squared"),
                n_particles_counted=result.get("n_particles_counted"),
                rg_nm=result.get("rg_nm"),
                dpo_used=dpo_used,
                error=result.get("error") or "",
                image_png=png_bytes,
                png_scientific_bytes=sci_bytes,
                analysis_input_variant=variant,
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
