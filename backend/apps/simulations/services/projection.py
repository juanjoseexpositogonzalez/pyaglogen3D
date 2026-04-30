"""2D Projection rendering service.

Renders 2D projections of agglomerates as PNG or SVG images using matplotlib.
"""

import io
from typing import Literal

import numpy as np
import matplotlib

matplotlib.use("Agg")  # Use non-interactive backend
import matplotlib.pyplot as plt
from matplotlib.patches import Circle
from matplotlib.collections import PatchCollection


def render_projection_png(
    x: list[float],
    y: list[float],
    radii: list[float],
    bounds: tuple[float, float, float, float],
    dpi: int = 150,
    figsize: tuple[float, float] | None = None,
    facecolor: str = "red",
    edgecolor: str = "black",
    background: str = "white",
    img_size: int | None = None,
) -> bytes:
    """Render 2D projection as PNG image.

    Args:
        x: X coordinates of particle centers
        y: Y coordinates of particle centers
        radii: Particle radii
        bounds: Bounding box (min_x, max_x, min_y, max_y)
        dpi: Image resolution (ignored when ``img_size`` is provided)
        figsize: Figure size in inches (width, height). Auto-calculated if None.
            Ignored when ``img_size`` is provided.
        facecolor: Fill color for particles
        edgecolor: Edge color for particles
        background: Background color
        img_size: Target output size in pixels (square). When provided,
            overrides ``dpi`` and ``figsize`` so the PNG is rendered at
            ``img_size × img_size`` pixels. Implementation: dpi=100,
            figsize=(img_size/100, img_size/100), and bbox tightening is
            disabled so final dimensions are predictable. When ``None``,
            legacy behavior is preserved (default dpi=150, auto figsize,
            ``bbox_inches='tight'``).

    Returns:
        PNG image as bytes
    """
    if img_size is not None:
        # Explicit-pixel mode: force dpi=100 and figsize so the output is
        # exactly img_size × img_size. ``bbox_inches='tight'`` would crop
        # the figure based on content and make the final dimensions
        # unpredictable — disable it here.
        effective_dpi = 100
        effective_figsize = (img_size / 100.0, img_size / 100.0)
        fig, _ax = _create_projection_figure(
            x,
            y,
            radii,
            bounds,
            effective_figsize,
            facecolor,
            edgecolor,
            background,
        )
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=effective_dpi, pad_inches=0)
        plt.close(fig)
        buf.seek(0)
        return buf.read()

    fig, ax = _create_projection_figure(
        x, y, radii, bounds, figsize, facecolor, edgecolor, background
    )

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def render_projection_svg(
    x: list[float],
    y: list[float],
    radii: list[float],
    bounds: tuple[float, float, float, float],
    figsize: tuple[float, float] | None = None,
    facecolor: str = "red",
    edgecolor: str = "black",
    background: str = "white",
) -> str:
    """Render 2D projection as SVG image.

    Args:
        x: X coordinates of particle centers
        y: Y coordinates of particle centers
        radii: Particle radii
        bounds: Bounding box (min_x, max_x, min_y, max_y)
        figsize: Figure size in inches (width, height). Auto-calculated if None.
        facecolor: Fill color for particles
        edgecolor: Edge color for particles
        background: Background color

    Returns:
        SVG image as string
    """
    fig, ax = _create_projection_figure(
        x, y, radii, bounds, figsize, facecolor, edgecolor, background
    )

    buf = io.StringIO()
    fig.savefig(buf, format="svg", bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def render_scientific_png(
    x: list[float],
    y: list[float],
    radii: list[float],
    bounds: tuple[float, float, float, float],
    img_size: int = 512,
) -> bytes:
    """Render scientific PNG: solid black on white, binary B/W, no AA halo.

    The output is a 3-channel RGB PNG where every pixel is exactly
    ``(0,0,0)`` (black particle) or ``(255,255,255)`` (white background).
    Anti-aliasing halos are removed via a post-render binary threshold.

    Geometry layout (bounds, padding, figsize, dpi) is IDENTICAL to the
    presentation render so both images have matching pixel coordinates.

    Args:
        x: X coordinates of particle centers.
        y: Y coordinates of particle centers.
        radii: Particle radii.
        bounds: Bounding box ``(min_x, max_x, min_y, max_y)``.
        img_size: Target output size in pixels (square).

    Returns:
        PNG image as bytes (RGB, strictly binary pixel values).
    """
    from PIL import Image

    effective_dpi = 100
    effective_figsize = (img_size / 100.0, img_size / 100.0)

    fig, ax = plt.subplots(figsize=effective_figsize)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    circles = [Circle((xi, yi), ri) for xi, yi, ri in zip(x, y, radii)]
    collection = PatchCollection(
        circles,
        facecolor="#000000",
        edgecolor="none",
        linewidth=0,
        alpha=1.0,
    )
    ax.add_collection(collection)

    min_x, max_x, min_y, max_y = bounds
    width = max_x - min_x
    height = max_y - min_y
    padding = max(width, height) * 0.02
    ax.set_xlim(min_x - padding, max_x + padding)
    ax.set_ylim(min_y - padding, max_y + padding)
    ax.set_aspect("equal")
    ax.axis("off")

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=effective_dpi, pad_inches=0)
    plt.close(fig)

    # Post-render binary threshold: remove anti-aliasing halos
    img = Image.open(io.BytesIO(buf.getvalue())).convert("L")
    arr = np.array(img, dtype=np.uint8)
    arr = np.where(arr > 127, 255, 0).astype(np.uint8)
    out = Image.fromarray(arr, mode="L").convert("RGB")
    out_buf = io.BytesIO()
    out.save(out_buf, format="PNG")
    return out_buf.getvalue()


def render_projection_dual_png(
    positions: np.ndarray,
    radii: np.ndarray,
    azimuth: float,
    elevation: float,
    img_size: int = 512,
) -> tuple[bytes, bytes, float, float]:
    """Render both presentation and scientific PNGs for a single direction.

    Calls ``aglogen_core.compute_2d_bbox`` once to obtain the 2D projected
    positions and bounding box, then passes the SAME geometry + bounds to
    both render functions so pixel coordinates match exactly.

    Args:
        positions: 3D particle positions, shape ``(N, 3)``.
        radii: Particle radii, shape ``(N,)``.
        azimuth: View azimuth in degrees.
        elevation: View elevation in degrees.
        img_size: Target output size in pixels (square).

    Returns:
        Tuple of ``(presentation_bytes, scientific_bytes,
        bbox_2d_w, bbox_2d_h)`` where bbox dimensions are in engine
        units (include particle radii on each side).
    """
    import aglogen_core

    coords_tuples = [(float(p[0]), float(p[1]), float(p[2])) for p in positions]
    radii_list = [float(r) for r in radii]

    bbox_w, bbox_h, positions_2d = aglogen_core.compute_2d_bbox(
        coords_tuples, radii_list, azimuth, elevation
    )

    # Extract projected x, y from 2D positions
    x_2d = [p[0] for p in positions_2d]
    y_2d = [p[1] for p in positions_2d]
    radii_flat = radii_list

    # Compute bounds from projected positions + radii (same as bbox logic)
    if len(x_2d) > 0:
        x_arr = np.array(x_2d)
        y_arr = np.array(y_2d)
        r_arr = np.array(radii_flat)
        min_x = float((x_arr - r_arr).min())
        max_x = float((x_arr + r_arr).max())
        min_y = float((y_arr - r_arr).min())
        max_y = float((y_arr + r_arr).max())
    else:
        min_x = max_x = min_y = max_y = 0.0

    bounds = (min_x, max_x, min_y, max_y)

    pres_bytes = render_projection_png(
        x=x_2d,
        y=y_2d,
        radii=radii_flat,
        bounds=bounds,
        img_size=img_size,
    )

    sci_bytes = render_scientific_png(
        x=x_2d,
        y=y_2d,
        radii=radii_flat,
        bounds=bounds,
        img_size=img_size,
    )

    return pres_bytes, sci_bytes, float(bbox_w), float(bbox_h)


def _create_projection_figure(
    x: list[float],
    y: list[float],
    radii: list[float],
    bounds: tuple[float, float, float, float],
    figsize: tuple[float, float] | None,
    facecolor: str,
    edgecolor: str,
    background: str,
) -> tuple[plt.Figure, plt.Axes]:
    """Create matplotlib figure with projected circles.

    Args:
        x: X coordinates
        y: Y coordinates
        radii: Radii
        bounds: (min_x, max_x, min_y, max_y)
        figsize: Figure size or None for auto
        facecolor: Circle fill color
        edgecolor: Circle edge color
        background: Figure background color

    Returns:
        Tuple of (figure, axes)
    """
    min_x, max_x, min_y, max_y = bounds

    # Calculate aspect ratio and figure size
    width = max_x - min_x
    height = max_y - min_y

    if figsize is None:
        # Auto-calculate figure size maintaining aspect ratio
        base_size = 8.0  # inches
        if width >= height:
            figsize = (
                base_size,
                base_size * height / width if width > 0 else base_size,
            )
        else:
            figsize = (
                base_size * width / height if height > 0 else base_size,
                base_size,
            )

    fig, ax = plt.subplots(figsize=figsize)
    fig.patch.set_facecolor(background)
    ax.set_facecolor(background)

    # Create circles
    circles = [Circle((xi, yi), ri) for xi, yi, ri in zip(x, y, radii)]

    # Add to collection for efficient rendering
    collection = PatchCollection(
        circles,
        facecolor=facecolor,
        edgecolor=edgecolor,
        linewidth=0.5,
        alpha=1.0,
    )
    ax.add_collection(collection)

    # Set axis limits with small padding
    padding = max(width, height) * 0.02
    ax.set_xlim(min_x - padding, max_x + padding)
    ax.set_ylim(min_y - padding, max_y + padding)

    # Equal aspect ratio and clean appearance
    ax.set_aspect("equal")
    ax.axis("off")

    return fig, ax


def create_projection_filename(
    base_name: str,
    azimuth: float,
    elevation: float,
    format: Literal["png", "svg"] = "png",
) -> str:
    """Create filename for projection following Matlab convention.

    Args:
        base_name: Base name for the file (e.g., simulation ID)
        azimuth: Azimuth angle in degrees
        elevation: Elevation angle in degrees
        format: Image format

    Returns:
        Filename like "Sim123_Az045_El030.png"
    """
    return f"{base_name}_Az{int(azimuth):03d}_El{int(elevation):03d}.{format}"
