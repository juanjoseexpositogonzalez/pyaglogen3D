"""Projection export services.

This module builds the ZIP output for simulation projection exports.
It is transport-agnostic: callers (views, Celery tasks) supply the
direction list and rendered PNG bytes, and this module handles
filename convention, metadata.json assembly, and ZIP packing.

Also provides ``compute_per_direction_scales`` — the single source of
truth for deriving ``pixels_per_100nm`` from 2D projected bounding boxes.
All code paths (legacy, sync, async) MUST use this helper.

Spec references: projection-export-contract.md R4 (filenames) + R5 (metadata).
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any

import numpy as np


def compute_per_direction_scales(
    directions: list[tuple[float, float]],
    positions: np.ndarray,
    radii: np.ndarray,
    img_size: int,
    scale_factor_nm: float,
) -> list[float]:
    """Compute per-direction ``pixels_per_100nm`` from 2D projected bboxes.

    This is the **single source of truth** for scale computation. All code
    paths (legacy, sync grid/fibonacci, async Celery) MUST use this function
    to derive the scale stamped into metadata.json.

    For each direction, calls ``aglogen_core.compute_2d_bbox`` to obtain the
    2D projected bounding box, then applies the standard formula:

        span_engine = max(bbox_w, bbox_h) * 1.04   # 2% padding per side
        span_nm     = span_engine * scale_factor_nm
        pixels_per_100nm = 100 * img_size / span_nm

    Args:
        directions: list of (azimuth_deg, elevation_deg) tuples.
        positions: 3D particle positions, shape ``(N, 3)``.
        radii: Particle radii, shape ``(N,)``.
        img_size: Target output image size in pixels (square).
        scale_factor_nm: Engine→nm multiplier (``primary_particle_diameter_nm / 2``).

    Returns:
        List of ``pixels_per_100nm`` values, one per direction. Each value
        is derived from the 2D projected bounding box for that direction.
    """
    import aglogen_core

    coords_tuples = [(float(p[0]), float(p[1]), float(p[2])) for p in positions]
    radii_list = [float(r) for r in radii]

    per_direction_scale: list[float] = []
    for az, el in directions:
        bbox_w, bbox_h, _ = aglogen_core.compute_2d_bbox(
            coords_tuples, radii_list, float(az), float(el)
        )
        span_engine = max(bbox_w, bbox_h) * 1.04
        span_nm = span_engine * scale_factor_nm
        if span_nm > 0:
            pix = 100.0 * float(img_size) / span_nm
        else:
            pix = 0.0
        per_direction_scale.append(pix)

    return per_direction_scale


def build_projection_filename(
    index: int,
    azimuth: float,
    elevation: float,
    fmt: str = "png",
) -> str:
    """Return the canonical filename for a projection.

    Format: ``proj_{idx:03d}_Az{AAA}_El{±EEE}.{fmt}``

    - ``idx``: zero-padded 3-digit sequential index
    - ``Az``: zero-padded 3-digit azimuth in [000, 360)
    - ``El``: signed 3-digit elevation in [-090, +090] with explicit sign
    - ``fmt``: file extension, default "png"

    Examples (per spec R4):
      build_projection_filename(7, 45.0, 30.0) → "proj_007_Az045_El+030.png"
      build_projection_filename(0, 180.0, -90.0) → "proj_000_Az180_El-090.png"
      build_projection_filename(15, 0.0, 0.0) → "proj_015_Az000_El+000.png"

    Args:
        index: sequential projection index (>=0)
        azimuth: azimuth in degrees; wrapped into [0, 360)
        elevation: elevation in degrees; clamped to [-90, +90]
        fmt: file format extension

    Returns:
        Canonical filename string.
    """
    # Normalize azimuth to [0, 360)
    az_int = int(round(azimuth)) % 360
    # Clamp elevation to [-90, +90] before rounding
    el_clamped = max(-90.0, min(90.0, elevation))
    el_int = int(round(el_clamped))
    el_sign = "+" if el_int >= 0 else "-"
    el_abs = abs(el_int)
    return f"proj_{index:03d}_Az{az_int:03d}_El{el_sign}{el_abs:03d}.{fmt}"


def build_metadata_json(
    mode: str,
    n_requested: int,
    directions: list[tuple[float, float]],
    parameters: dict[str, Any],
    per_direction_scale: list[float] | None = None,
) -> dict[str, Any]:
    """Build the metadata.json contract per spec R5.

    Returns a dict with:
      - mode: "grid" | "fibonacci" | "legacy"
      - n_requested: the user-requested N (may differ from generated for grid)
      - n_generated: actual direction count
      - parameters: passthrough caller-provided context (img_size, n_az, etc.)
      - directions: list of per-direction entries

    When ``per_direction_scale`` is provided (dual-render mode), each
    direction entry gains:
      - ``pixels_per_100nm``: per-direction scale value
      - ``filename_scientific``: scientific PNG filename

    and ``parameters.pixels_per_100nm`` is set to ``max(per_direction_scale)``.

    In legacy mode (no ``per_direction_scale``), these keys are ABSENT
    (not null) from the directions — consumers detect the mode by key
    presence.
    """
    params = dict(parameters)
    direction_entries = []
    for i, (az, el) in enumerate(directions):
        entry: dict[str, Any] = {
            "index": i,
            "filename": build_projection_filename(i, az, el),
            "azimuth": float(az),
            "elevation": float(el),
        }
        if per_direction_scale is not None:
            entry["pixels_per_100nm"] = per_direction_scale[i]
            base = build_projection_filename(i, az, el)
            entry["filename_scientific"] = base.replace(".png", ".scientific.png")
        direction_entries.append(entry)

    if per_direction_scale is not None:
        params["pixels_per_100nm"] = max(per_direction_scale)

    return {
        "mode": mode,
        "n_requested": int(n_requested),
        "n_generated": len(directions),
        "parameters": params,
        "directions": direction_entries,
    }


def build_projection_zip(
    directions: list[tuple[float, float]],
    image_bytes_list: list[bytes],
    mode: str,
    n_requested: int,
    parameters: dict[str, Any],
    scientific_bytes_list: list[bytes] | None = None,
    per_direction_scale: list[float] | None = None,
) -> bytes:
    """Assemble the full export ZIP.

    Takes per-direction rendered PNG bytes and produces a ZIP containing:
      - one PNG per direction with canonical filename
      - (optional) one scientific PNG per direction
      - metadata.json at the ZIP root

    Args:
        directions: list of (azimuth, elevation) tuples
        image_bytes_list: presentation PNG bytes, one per direction
        mode: "grid" | "fibonacci" | "legacy"
        n_requested: original N requested by user
        parameters: extra context (img_size, n_az, n_el, n, etc.)
        scientific_bytes_list: scientific PNG bytes per direction (optional).
            When ``None``, only presentation PNGs are included (legacy compat).
        per_direction_scale: per-direction ``pixels_per_100nm`` values.
            Forwarded to ``build_metadata_json`` for per-direction entries.

    Returns:
        bytes of the ZIP file.

    Raises:
        ValueError: if directions and image_bytes_list lengths mismatch.
    """
    if len(directions) != len(image_bytes_list):
        raise ValueError(
            f"directions and image_bytes_list length mismatch: "
            f"{len(directions)} vs {len(image_bytes_list)}"
        )
    if scientific_bytes_list is not None and len(scientific_bytes_list) != len(
        directions
    ):
        raise ValueError(
            f"directions and scientific_bytes_list length mismatch: "
            f"{len(directions)} vs {len(scientific_bytes_list)}"
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, ((az, el), img_bytes) in enumerate(zip(directions, image_bytes_list)):
            filename = build_projection_filename(i, az, el)
            zf.writestr(filename, img_bytes)

            if scientific_bytes_list is not None:
                sci_filename = filename.replace(".png", ".scientific.png")
                zf.writestr(sci_filename, scientific_bytes_list[i])

        metadata = build_metadata_json(
            mode, n_requested, directions, parameters, per_direction_scale
        )
        zf.writestr("metadata.json", json.dumps(metadata, indent=2))

    return buf.getvalue()
