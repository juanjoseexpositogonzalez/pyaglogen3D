"""Projection export services.

This module builds the ZIP output for simulation projection exports.
It is transport-agnostic: callers (views, Celery tasks) supply the
direction list and rendered PNG bytes, and this module handles
filename convention, metadata.json assembly, and ZIP packing.

Spec references: projection-export-contract.md R4 (filenames) + R5 (metadata).
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any


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
) -> dict[str, Any]:
    """Build the metadata.json contract per spec R5.

    Returns a dict with:
      - mode: "grid" | "fibonacci" | "legacy"
      - n_requested: the user-requested N (may differ from generated for grid)
      - n_generated: actual direction count
      - parameters: passthrough caller-provided context (img_size, n_az, n_el, n, etc.)
      - directions: list of {index, filename, azimuth, elevation} per direction
    """
    direction_entries = []
    for i, (az, el) in enumerate(directions):
        direction_entries.append(
            {
                "index": i,
                "filename": build_projection_filename(i, az, el),
                "azimuth": float(az),
                "elevation": float(el),
            }
        )
    return {
        "mode": mode,
        "n_requested": int(n_requested),
        "n_generated": len(directions),
        "parameters": dict(parameters),
        "directions": direction_entries,
    }


def build_projection_zip(
    directions: list[tuple[float, float]],
    image_bytes_list: list[bytes],
    mode: str,
    n_requested: int,
    parameters: dict[str, Any],
) -> bytes:
    """Assemble the full export ZIP.

    Takes per-direction rendered PNG bytes and produces a ZIP containing:
      - one PNG per direction with canonical filename
      - metadata.json at the ZIP root

    Args:
        directions: list of (azimuth, elevation) tuples
        image_bytes_list: rendered PNG bytes, one per direction (SAME ORDER)
        mode: "grid" | "fibonacci" | "legacy"
        n_requested: original N requested by user
        parameters: extra context (img_size, n_az, n_el, n, etc.)

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

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, ((az, el), img_bytes) in enumerate(zip(directions, image_bytes_list)):
            filename = build_projection_filename(i, az, el)
            zf.writestr(filename, img_bytes)

        metadata = build_metadata_json(mode, n_requested, directions, parameters)
        zf.writestr("metadata.json", json.dumps(metadata, indent=2))

    return buf.getvalue()
