"""2D Projection rendering service.

Renders 2D projections of agglomerates as PNG or SVG images using matplotlib.
"""
import io
from typing import Literal

import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
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
    edgecolor: str = "darkred",
    background: str = "white",
) -> bytes:
    """Render 2D projection as PNG image.

    Args:
        x: X coordinates of particle centers
        y: Y coordinates of particle centers
        radii: Particle radii
        bounds: Bounding box (min_x, max_x, min_y, max_y)
        dpi: Image resolution
        figsize: Figure size in inches (width, height). Auto-calculated if None.
        facecolor: Fill color for particles
        edgecolor: Edge color for particles
        background: Background color

    Returns:
        PNG image as bytes
    """
    fig, ax = _create_projection_figure(
        x, y, radii, bounds, figsize, facecolor, edgecolor, background
    )

    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight', pad_inches=0.1)
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
    edgecolor: str = "darkred",
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
    fig.savefig(buf, format='svg', bbox_inches='tight', pad_inches=0.1)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


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
            figsize = (base_size, base_size * height / width if width > 0 else base_size)
        else:
            figsize = (base_size * width / height if height > 0 else base_size, base_size)

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
        alpha=0.9,
    )
    ax.add_collection(collection)

    # Set axis limits with small padding
    padding = max(width, height) * 0.02
    ax.set_xlim(min_x - padding, max_x + padding)
    ax.set_ylim(min_y - padding, max_y + padding)

    # Equal aspect ratio and clean appearance
    ax.set_aspect('equal')
    ax.axis('off')

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
