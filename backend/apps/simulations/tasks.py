"""Simulation Celery tasks."""
import io
import logging
import math
from uuid import UUID

import numpy as np
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


# ============================================================================
# Limiting Case Geometry Generators
# ============================================================================

# ============================================================================
# Configuration Types and Packing Types
# ============================================================================

# Df=1 configuration types
DF1_CONFIGS = ['lineal', 'cruz2d', 'asterisco', 'cruz3d']

# Df=2 configuration types
DF2_CONFIGS = ['plano', 'dobleplano', 'tripleplano']

# Df=3 configuration types
DF3_CONFIGS = ['cuboctaedro']

# Packing types for 2D (plane) and 3D (sphere) configurations
PACKING_2D = ['HC', 'CS']  # Hexagonal Compact, Cubic Simple
PACKING_3D = ['HC', 'CS', 'CCC']  # + Face-Centered Cubic


def generate_linear_chain(n_particles: int, radius: float = 1.0) -> np.ndarray:
    """Generate a linear chain of touching particles (Df=1, config='lineal').

    Particles are arranged in a straight line along the x-axis, centered at origin.

    Examples:
        N=1: [(0, 0, 0)]
        N=2: [(-r, 0, 0), (r, 0, 0)]
        N=3: [(-2r, 0, 0), (0, 0, 0), (2r, 0, 0)]
    """
    if n_particles <= 0:
        return np.zeros((0, 3))

    coords = np.zeros((n_particles, 3))
    d = 2.0 * radius  # Center-to-center distance for touching spheres

    # Position particles along x-axis
    for i in range(n_particles):
        coords[i, 0] = d * i

    # Center at origin
    coords -= coords.mean(axis=0)
    return coords


def generate_cruz2d(n_branches: int, radius: float = 1.0) -> np.ndarray:
    """Generate a 2D cross structure (Df=1, config='cruz2d').

    Based on MATLAB casosLimiteEsferas.m 'cruz2d' case.
    Two perpendicular branches of particles in the xy-plane.

    Args:
        n_branches: Number of particles per branch arm
        radius: Particle radius

    Returns:
        Coordinates array centered at origin
    """
    if n_branches <= 0:
        return np.zeros((0, 3))

    d = 2.0 * radius
    coords = []

    if n_branches % 2 != 0:  # Odd
        # Main horizontal branch (along x)
        for i in range(n_branches):
            coords.append([d * i, 0.0, 0.0])

        # Center of the cross is at x = (n-1)*d/2
        center_x = (n_branches - 1) * d / 2.0

        # Vertical branch (positive y)
        for j in range(1, n_branches // 2 + 1):
            coords.append([center_x, d * j, 0.0])

        # Vertical branch (negative y)
        for k in range(1, n_branches // 2 + 1):
            coords.append([center_x, -d * k, 0.0])
    else:  # Even
        half = n_branches // 2
        gap = 2 * (math.sqrt(2) - 1)  # Gap at junction

        # Left horizontal half
        for i in range(half):
            coords.append([d * i, 0.0, 0.0])

        # Right horizontal half (with gap)
        for j in range(half):
            coords.append([half * d + gap + d * j, 0.0, 0.0])

        # Vertical center x
        center_x = half * d + gap / 2.0 - radius

        # Upper vertical half
        for k in range(half):
            coords.append([center_x, math.sqrt(2) + d * k, 0.0])

        # Lower vertical half
        for s in range(half):
            coords.append([center_x, -math.sqrt(2) - d * s, 0.0])

    coords = np.array(coords)
    coords -= coords.mean(axis=0)
    return coords


def generate_asterisco(n_branches: int, radius: float = 1.0) -> np.ndarray:
    """Generate an asterisk structure with 6 branches at 60° (Df=1, config='asterisco').

    Based on MATLAB casosLimiteEsferas.m 'asterisco' case.
    Six branches radiating from center at 60° intervals in xy-plane.

    Args:
        n_branches: Number of particles per branch arm (must be odd, will be adjusted)
        radius: Particle radius

    Returns:
        Coordinates array centered at origin
    """
    if n_branches <= 0:
        return np.zeros((0, 3))

    # Ensure odd number for proper geometry
    if n_branches % 2 == 0:
        n_branches += 1

    d = 2.0 * radius
    half = n_branches // 2
    coords = []

    # Branch 1: Vertical (along y)
    for i in range(n_branches):
        x = half * d
        y = half * d - d * i
        coords.append([x, y, 0.0])

    # Branch 2: 60° (positive slope)
    for j in range(n_branches):
        x = (half * d + radius - half * math.sqrt(3)) + j * math.sqrt(3)
        y = -half * radius + j * radius
        coords.append([x, y, 0.0])

    # Branch 3: -60° (negative slope)
    for k in range(n_branches):
        x = (half * d + radius - half * math.sqrt(3)) + k * math.sqrt(3)
        y = half * radius - k * radius
        coords.append([x, y, 0.0])

    coords = np.array(coords)
    coords -= coords.mean(axis=0)
    return np.unique(coords, axis=0)  # Remove duplicates at center


def generate_cruz3d(n_branches: int, radius: float = 1.0) -> np.ndarray:
    """Generate a 3D cross structure (Df=1, config='cruz3d').

    Based on MATLAB casosLimiteEsferas.m 'cruz3d' case.
    Three orthogonal branches: along x, y, and z axes.

    Args:
        n_branches: Number of particles per branch arm (must be odd, will be adjusted)
        radius: Particle radius

    Returns:
        Coordinates array centered at origin
    """
    if n_branches <= 0:
        return np.zeros((0, 3))

    # Ensure odd number for proper geometry
    if n_branches % 2 == 0:
        n_branches += 1

    d = 2.0 * radius
    half = n_branches // 2
    coords = []

    # Vertical branch (along z)
    center_x = half * d
    for i in range(n_branches):
        z = radius + half * d - d * i
        coords.append([center_x, 0.0, z])

    # Branch in xy-plane at +60° from x-axis
    for j in range(n_branches):
        x = (half * d + radius - half * math.sqrt(3)) + j * math.sqrt(3)
        y = -half * radius + j * radius
        coords.append([x, y, 0.0])

    # Branch in xy-plane at -60° from x-axis
    for k in range(n_branches):
        x = (half * d + radius - half * math.sqrt(3)) + k * math.sqrt(3)
        y = half * radius - k * radius
        coords.append([x, y, 0.0])

    coords = np.array(coords)
    coords -= coords.mean(axis=0)
    return np.unique(coords, axis=0)  # Remove duplicates at center


def get_complete_hexagonal_counts() -> list[int]:
    """Return particle counts for complete hexagonal arrangements.

    Formula: N(k) = 1 + 3k(k+1) for k complete rings.
    k=0: 1, k=1: 7, k=2: 19, k=3: 37, k=4: 61, k=5: 91, ...
    """
    counts = []
    for k in range(20):  # Up to 20 rings
        n = 1 + 3 * k * (k + 1)
        counts.append(n)
    return counts


def generate_hexagonal_plane(n_particles: int = None, layers: int = None, radius: float = 1.0,
                              packing: str = 'HC', complete_rings: bool = True) -> np.ndarray:
    """Generate a single-layer plane (Df=2, config='plano').

    Based on MATLAB casosLimiteEsferas.m 'plano' case.

    Args:
        n_particles: Target number of particles (ignored if layers is set)
        layers: Number of layers/rings (k for HC, produces specific N)
        radius: Particle radius
        packing: 'HC' (Hexagonal Compact) or 'CS' (Cubic Simple)
        complete_rings: If True, adjusts n_particles to nearest complete number

    Returns:
        Coordinates array centered at origin
    """
    d = 2.0 * radius

    if packing.upper() == 'CS':
        # Cubic Simple: square grid
        if layers is not None:
            n_side = layers + 1
            n_particles = n_side * n_side
        elif n_particles is None:
            n_particles = 1

        n_side = int(math.ceil(math.sqrt(n_particles)))
        coords = []
        for j in range(n_side):
            for i in range(n_side):
                if len(coords) >= n_particles:
                    break
                coords.append([d * i, d * j, 0.0])

        coords = np.array(coords) if coords else np.zeros((0, 3))
        if len(coords) > 0:
            coords -= coords.mean(axis=0)
        return coords

    # Hexagonal Compact (HC) packing
    if layers is not None:
        # Direct formula: N = 1 + 3*k*(k+1) for k rings
        n_particles = 1 + 3 * layers * (layers + 1)
    elif n_particles is None:
        n_particles = 1

    # For complete hexagonal geometry, adjust to nearest hexagonal number
    if complete_rings and n_particles > 6:
        hex_counts = get_complete_hexagonal_counts()
        actual_n = 1
        for hc in hex_counts:
            if hc <= n_particles:
                actual_n = hc
            else:
                break
        n_particles = actual_n

    coords = []
    max_ring = int(math.ceil(math.sqrt(n_particles))) + 2

    # Generate hexagonal grid positions
    all_positions = []
    for ring in range(max_ring + 1):
        if ring == 0:
            all_positions.append((0.0, 0.0, 0.0))
        else:
            for side in range(6):
                angle = side * math.pi / 3.0
                next_angle = (side + 1) * math.pi / 3.0
                corner_x = ring * d * math.cos(angle)
                corner_y = ring * d * math.sin(angle)
                next_corner_x = ring * d * math.cos(next_angle)
                next_corner_y = ring * d * math.sin(next_angle)
                for j in range(ring):
                    t = j / ring
                    px = corner_x + t * (next_corner_x - corner_x)
                    py = corner_y + t * (next_corner_y - corner_y)
                    all_positions.append((px, py, 0.0))

    all_positions.sort(key=lambda p: p[0]**2 + p[1]**2)
    coords = np.array(all_positions[:n_particles])

    if len(coords) > 0:
        coords -= coords.mean(axis=0)

    return coords


def generate_doble_plano(layers: int, radius: float = 1.0, packing: str = 'HC') -> np.ndarray:
    """Generate two perpendicular planes (Df=2, config='dobleplano').

    Based on MATLAB casosLimiteEsferas.m 'dobleplano' case.
    Two planes intersecting at 90° along a shared axis.

    Args:
        layers: Number of layers (k for HC packing, n for CS)
        radius: Particle radius
        packing: 'HC' (Hexagonal Compact) or 'CS' (Cubic Simple)

    Returns:
        Coordinates array centered at origin
    """
    d = 2.0 * radius
    coords = []

    if packing.upper() == 'HC':
        esferas2 = layers * 2 + 1

        # First plane (xy-plane, horizontal)
        for i in range(1, esferas2 // 2 + 2):
            for j in range(i, esferas2 + 1):
                xx = d * (j - 1) - (i - 1)
                yy = math.sqrt(3) * (i - 1)
                coords.append([xx, yy, 0.0])
                if i > 1:
                    coords.append([xx, -yy, 0.0])

        # Second plane (xz-plane, vertical)
        for i in range(1, esferas2 // 2 + 2):
            for j in range(i, esferas2 + 1):
                xx = d * (j - 1) - (i - 1)
                zz = math.sqrt(3) * (i - 1)
                coords.append([xx, 0.0, zz])
                coords.append([xx, 0.0, -zz])

    else:  # CS packing
        n_side = layers + 1

        # First plane (xy-plane)
        for j in range(n_side):
            for i in range(n_side):
                coords.append([d * i, d * j, 0.0])

        # Second plane (xz-plane, offset to share central axis)
        center_y = layers * d / 2.0
        for j in range(n_side):
            for i in range(n_side):
                z = (j - layers / 2.0) * d
                if abs(z) > 0.01:  # Skip overlap with first plane
                    coords.append([d * i, center_y, z])

    coords = np.array(coords)
    coords = np.unique(np.round(coords, 10), axis=0)  # Remove duplicates
    coords -= coords.mean(axis=0)
    return coords


def generate_triple_plano(layers: int, radius: float = 1.0) -> np.ndarray:
    """Generate three planes at 60° angles (Df=2, config='tripleplano').

    Based on MATLAB casosLimiteEsferas.m 'tripleplano' case.
    Three planes sharing a common axis, separated by 60° rotations.
    Only available with HC (Hexagonal Compact) packing.

    Args:
        layers: Number of layers (k value)
        radius: Particle radius

    Returns:
        Coordinates array centered at origin
    """
    d = 2.0 * radius
    coords = []
    esferas2 = layers * 2 + 1

    # Plane 1: xy-plane
    for i in range(1, esferas2 // 2 + 2):
        for j in range(i, esferas2 + 1):
            xx = d * (j - 1) - (i - 1)
            yy = math.sqrt(3) * (i - 1)
            coords.append([xx, yy, 0.0])
            coords.append([xx, -yy, 0.0])

    # Plane 2: rotated 60° around x-axis
    for i in range(1, esferas2 // 2 + 2):
        for j in range(i, esferas2 + 1):
            xx = d * (j - 1) - (i - 1)
            yy = math.sqrt(3) / 2 * (i - 1)
            zz = 1.5 * (i - 1)  # 3/2
            coords.append([xx, yy, zz])
            coords.append([xx, -yy, -zz])

    # Plane 3: rotated -60° around x-axis
    for i in range(1, esferas2 // 2 + 2):
        for j in range(i, esferas2 + 1):
            xx = d * (j - 1) - (i - 1)
            yy = -math.sqrt(3) / 2 * (i - 1)
            zz = 1.5 * (i - 1)
            coords.append([xx, yy, zz])
            coords.append([xx, -yy, -zz])

    coords = np.array(coords)
    coords = np.unique(np.round(coords, 10), axis=0)
    coords -= coords.mean(axis=0)
    return coords


def get_complete_shell_counts() -> list[tuple[int, str]]:
    """Return particle counts for notable 3D close-packed arrangements.

    These are "magic numbers" for compact clusters.
    """
    return [
        (1, "single"),
        (4, "tetrahedron"),
        (6, "octahedron"),
        (13, "icosahedron / cuboctahedron"),  # First shell
        (55, "second Mackay icosahedron"),
        (147, "third Mackay icosahedron"),
    ]


def generate_cuboctaedro(layers: int, radius: float = 1.0, packing: str = 'HC') -> np.ndarray:
    """Generate a 3D compact structure (Df=3, config='cuboctaedro').

    Based on MATLAB casosLimiteEsferas.m 'cuboctaedro' case.

    Args:
        layers: Number of layers/shells
        radius: Particle radius
        packing: 'HC' (Hexagonal Compact), 'CS' (Cubic Simple), or 'CCC' (Face-Centered Cubic)

    Returns:
        Coordinates array centered at origin
    """
    d = 2.0 * radius
    coords = []

    if packing.upper() == 'HC':
        esferas2 = layers * 2 + 1

        # Base hexagonal layer
        for i in range(1, esferas2 // 2 + 2):
            for j in range(i, esferas2 + 1):
                xx = d * (j - 1) - (i - 1)
                yy = math.sqrt(3) * (i - 1)
                coords.append([xx, yy, 0.0])
                coords.append([xx, -yy, 0.0])

        # Upper layers (triangular regions above hexagon)
        for j in range(1, layers):
            for k in range(1, layers - j + 1):
                for i in range(1, esferas2 - k - j + 1):
                    xx = d + d * (i - 1) + radius * (j - 1) + radius * (k - 1)
                    yy = math.sqrt(3) * j + math.sqrt(3) / 3 * k
                    zz = 1.6345 * k  # sqrt(8/3) ≈ 1.6345
                    coords.append([xx, yy, zz])

        # Triangular regions on sides
        for k in range(1, esferas2 // 2):
            for j in range(1, esferas2 // 2 + 1):
                for i in range(1, esferas2 - j - (k - 1) + 1):
                    xx = (k - 1) * radius + radius * j + d * (i - 1)
                    yy = math.sqrt(3) / 3 - math.sqrt(3) * (j - 1) + (k - 1) * math.sqrt(3) / 3
                    zz = 1.6345 * k
                    coords.append([xx, yy, zz])

        # Lower layers (mirror of upper)
        for j in range(1, layers):
            for k in range(1, layers - j + 1):
                for i in range(1, esferas2 - k - j + 1):
                    xx = d + d * (i - 1) + radius * (j - 1) + radius * (k - 1)
                    yy = -math.sqrt(3) * j - math.sqrt(3) / 3 * k
                    zz = -1.6345 * k
                    coords.append([xx, yy, zz])

        for k in range(1, esferas2 // 2):
            for j in range(1, esferas2 // 2 + 1):
                for i in range(1, esferas2 - j - (k - 1) + 1):
                    xx = (k - 1) * radius + radius * j + d * (i - 1)
                    yy = -math.sqrt(3) / 3 + math.sqrt(3) * (j - 1) - (k - 1) * math.sqrt(3) / 3
                    zz = -1.6345 * k
                    coords.append([xx, yy, zz])

    elif packing.upper() == 'CS':
        # Cubic Simple packing
        n_side = layers + 1
        for j in range(n_side):
            for i in range(n_side):
                for k in range(n_side):
                    coords.append([d * i, d * j, d * k])

    elif packing.upper() == 'CCC':
        # Face-Centered Cubic packing
        n_side = layers + 1
        spacing = 4 / math.sqrt(3)

        # Corner positions
        for j in range(n_side):
            for i in range(n_side):
                for k in range(n_side):
                    coords.append([spacing * radius * i, spacing * radius * j, spacing * radius * k])

        # Face-center positions (offset)
        offset = 2 / math.sqrt(3)
        for j in range(layers):
            for i in range(layers):
                for k in range(layers):
                    coords.append([
                        offset + spacing * radius * i,
                        offset + spacing * radius * j,
                        offset + spacing * radius * k
                    ])

    coords = np.array(coords) if coords else np.zeros((0, 3))
    coords = np.unique(np.round(coords, 10), axis=0)
    if len(coords) > 0:
        coords -= coords.mean(axis=0)
    return coords


def generate_hcp_sphere(n_particles: int = None, layers: int = None, radius: float = 1.0,
                        packing: str = 'HC') -> np.ndarray:
    """Generate a 3D compact structure (Df=3).

    Wrapper that handles both direct n_particles input and layer-based input.
    For small N (1-6), uses special compact configurations.

    Args:
        n_particles: Target number of particles (used for small N)
        layers: Number of layers (used for larger structures via cuboctaedro)
        radius: Particle radius
        packing: 'HC', 'CS', or 'CCC'

    Returns:
        Coordinates array centered at origin
    """
    d = 2.0 * radius

    # Handle layer-based input for larger structures
    if layers is not None and layers > 0:
        return generate_cuboctaedro(layers, radius, packing)

    # Handle small N special cases
    if n_particles is None or n_particles <= 0:
        return np.zeros((0, 3))

    if n_particles == 1:
        return np.array([[0.0, 0.0, 0.0]])

    if n_particles == 2:
        return np.array([[-radius, 0.0, 0.0], [radius, 0.0, 0.0]])

    if n_particles == 3:
        coords = np.array([
            [0.0, 0.0, 0.0],
            [d, 0.0, 0.0],
            [d / 2.0, d * math.sqrt(3.0) / 2.0, 0.0],
        ])
        coords -= coords.mean(axis=0)
        return coords

    if n_particles == 4:
        h = d * math.sqrt(2.0 / 3.0)
        coords = np.array([
            [0.0, 0.0, 0.0],
            [d, 0.0, 0.0],
            [d / 2.0, d * math.sqrt(3.0) / 2.0, 0.0],
            [d / 2.0, d * math.sqrt(3.0) / 6.0, h],
        ])
        coords -= coords.mean(axis=0)
        return coords

    if n_particles == 5:
        h = d * math.sqrt(2.0 / 3.0)
        coords = np.array([
            [0.0, 0.0, 0.0],
            [d, 0.0, 0.0],
            [d / 2.0, d * math.sqrt(3.0) / 2.0, 0.0],
            [d / 2.0, d * math.sqrt(3.0) / 6.0, h],
            [d / 2.0, d * math.sqrt(3.0) / 6.0, -h],
        ])
        coords -= coords.mean(axis=0)
        return coords

    if n_particles == 6:
        a = d / math.sqrt(2.0)
        return np.array([
            [a, 0.0, 0.0], [-a, 0.0, 0.0],
            [0.0, a, 0.0], [0.0, -a, 0.0],
            [0.0, 0.0, a], [0.0, 0.0, -a],
        ])

    # For larger N, use cuboctaedro with appropriate layers
    # Estimate layers needed (rough approximation)
    estimated_layers = int(math.ceil((n_particles / 13) ** (1/3)))
    return generate_cuboctaedro(max(1, estimated_layers), radius, packing)


def compute_limiting_metrics(coords: np.ndarray, n_particles: int) -> dict:
    """Compute metrics for a limiting case geometry.

    These are deterministic geometries, so no random seed or simulation time.
    """
    if len(coords) == 0:
        return {
            "fractal_dimension": 0.0,
            "fractal_dimension_std": 0.0,
            "prefactor": 0.0,
            "radius_of_gyration": 0.0,
            "porosity": 0.0,
            "coordination": {"mean": 0.0, "std": 0.0},
            "rg_evolution": [],
            "anisotropy": 1.0,
            "asphericity": 0.0,
            "acylindricity": 0.0,
            "principal_moments": [0.0, 0.0, 0.0],
            "principal_axes": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        }

    # Center of mass
    cdg = coords.mean(axis=0)
    centered = coords - cdg

    # Radius of gyration
    rg = math.sqrt(np.sum(centered**2) / n_particles)

    # Compute coordination numbers (count neighbors within 2.1 * radius)
    radius = 1.0
    threshold = 2.1 * radius
    coordinations = []
    for i in range(n_particles):
        count = 0
        for j in range(n_particles):
            if i != j:
                dist = np.linalg.norm(coords[i] - coords[j])
                if dist <= threshold:
                    count += 1
        coordinations.append(count)
    coord_mean = np.mean(coordinations)
    coord_std = np.std(coordinations)

    # Inertia tensor
    inertia = np.zeros((3, 3))
    for coord in centered:
        r2 = np.dot(coord, coord)
        inertia += r2 * np.eye(3) - np.outer(coord, coord)
    inertia /= n_particles

    # Principal moments and axes
    eigenvalues, eigenvectors = np.linalg.eigh(inertia)
    idx = np.argsort(eigenvalues)
    eigenvalues = eigenvalues[idx]
    eigenvectors = eigenvectors[:, idx]

    # Shape descriptors
    I1, I2, I3 = eigenvalues
    I_mean = (I1 + I2 + I3) / 3.0
    anisotropy = I3 / I1 if I1 > 1e-10 else 1.0
    asphericity = I3 - 0.5 * (I1 + I2)
    acylindricity = I2 - I1

    # Rg evolution (for limiting cases, Rg grows predictably)
    rg_evolution = []
    for n in range(1, n_particles + 1, max(1, n_particles // 100)):
        subset = centered[:n]
        rg_n = math.sqrt(np.sum(subset**2) / n)
        rg_evolution.append(float(rg_n))

    return {
        "fractal_dimension": 0.0,  # Will be computed from geometry type
        "fractal_dimension_std": 0.0,
        "prefactor": 0.0,  # Will be computed from geometry type
        "radius_of_gyration": float(rg),
        "porosity": 0.0,  # N/A for limiting cases
        "coordination": {
            "mean": float(coord_mean),
            "std": float(coord_std),
        },
        "rg_evolution": rg_evolution,
        "anisotropy": float(anisotropy),
        "asphericity": float(asphericity),
        "acylindricity": float(acylindricity),
        "principal_moments": eigenvalues.tolist(),
        "principal_axes": eigenvectors.T.tolist(),
    }


def compute_kf_chain(n: int) -> float:
    """Prefactor for linear chain (Df=1)."""
    if n <= 1:
        return 1.0
    return n / math.sqrt(3.0 / 5.0 + (n**2 - 1) / 3.0)


def compute_kf_plane(n: int) -> float:
    """Prefactor for hexagonal plane (Df=2)."""
    if n <= 1:
        return 1.0
    denominator = 3.0 / 5.0 + (5.0 * n**2 - 4.0 * n - 1.0) / (9.0 * n)
    return n / denominator


def compute_kf_sphere(n: int) -> float:
    """Prefactor for compact sphere (Df=3)."""
    # For ideal HCP packing, kf ≈ 1.0
    return 1.0


@shared_task(bind=True, max_retries=1)
def run_simulation_task(self, simulation_id: str) -> dict:
    """Execute simulation using Rust engine."""
    from .models import Simulation, SimulationStatus

    simulation = Simulation.objects.get(id=UUID(simulation_id))

    # Update status to running
    simulation.status = SimulationStatus.RUNNING
    simulation.started_at = timezone.now()
    simulation.save(update_fields=["status", "started_at"])

    try:
        import aglogen_core

        algorithm = simulation.algorithm
        params = simulation.parameters
        seed = simulation.seed

        logger.info(
            f"Running {algorithm} simulation {simulation_id} "
            f"with {params.get('n_particles', 1000)} particles"
        )

        # Get radius parameters (support both old and new parameter names)
        radius_min = params.get("radius_min") or params.get("seed_radius") or params.get("particle_radius") or 1.0
        radius_max = params.get("radius_max")  # None means monodisperse (same as radius_min)

        # Run the appropriate algorithm
        if algorithm == "dla":
            result = aglogen_core.run_dla(
                n_particles=params.get("n_particles", 1000),
                sticking_probability=params.get("sticking_probability", 1.0),
                lattice_size=params.get("lattice_size", 200),
                radius_min=radius_min,
                radius_max=radius_max,
                seed=seed,
            )
        elif algorithm == "cca":
            result = aglogen_core.run_cca(
                n_particles=params.get("n_particles", 1000),
                sticking_probability=params.get("sticking_probability", 1.0),
                radius_min=radius_min,
                radius_max=radius_max,
                box_size=params.get("box_size", 100.0),
                single_agglomerate=params.get("single_agglomerate", True),
                seed=seed,
            )
        elif algorithm == "ballistic":
            result = aglogen_core.run_ballistic(
                n_particles=params.get("n_particles", 1000),
                sticking_probability=params.get("sticking_probability", 1.0),
                radius_min=radius_min,
                radius_max=radius_max,
                seed=seed,
            )
        elif algorithm == "ballistic_cc":
            # Ballistic Cluster-Cluster aggregation (thesis section 6.2)
            result = aglogen_core.run_ballistic_cc(
                n_particles=params.get("n_particles", 1000),
                sticking_probability=params.get("sticking_probability", 1.0),
                radius_min=radius_min,
                radius_max=radius_max,
                seed=seed,
            )
        elif algorithm == "tunable":
            # Tunable PC with controllable fractal dimension
            result = aglogen_core.run_tunable(
                n_particles=params.get("n_particles", 1000),
                target_df=params.get("target_df", 1.8),
                target_kf=params.get("target_kf", 1.3),
                radius_min=radius_min,
                radius_max=radius_max,
                seed=seed,
            )
        elif algorithm == "tunable_cc":
            # Tunable CC with controllable fractal dimension (cluster-cluster)
            result = aglogen_core.run_tunable_cc(
                n_particles=params.get("n_particles", 1000),
                target_df=params.get("target_df", 1.8),
                target_kf=params.get("target_kf", 1.3),
                radius_min=radius_min,
                radius_max=radius_max,
                seed_cluster_size=params.get("seed_cluster_size"),
                max_rotation_attempts=params.get("max_rotation_attempts", 50),
                seed=seed,
            )
        elif algorithm == "limiting":
            # Limiting case geometry (deterministic, no simulation)
            import time
            start_time = time.perf_counter()

            n_particles = params.get("n_particles", 100)
            geometry_type = params.get("geometry_type", "chain")
            configuration_type = params.get("configuration_type", None)
            packing = params.get("packing", "HC")
            layers = params.get("layers")  # Optional: layer-based input
            radius = radius_min


            # Generate coordinates based on geometry type and configuration
            if geometry_type == "chain":
                df = 1.0
                config = configuration_type or "lineal"

                if config == "lineal":
                    coordinates = generate_linear_chain(n_particles, radius)
                elif config == "cruz2d":
                    coordinates = generate_cruz2d(n_particles, radius)
                elif config == "asterisco":
                    coordinates = generate_asterisco(n_particles, radius)
                elif config == "cruz3d":
                    coordinates = generate_cruz3d(n_particles, radius)
                else:
                    coordinates = generate_linear_chain(n_particles, radius)

            elif geometry_type == "plane":
                df = 2.0
                config = configuration_type or "plano"

                if config == "plano":
                    coordinates = generate_hexagonal_plane(
                        n_particles=n_particles if layers is None else None,
                        layers=layers,
                        radius=radius,
                        packing=packing,
                        complete_rings=True
                    )
                elif config == "dobleplano":
                    use_layers = layers if layers is not None else max(1, int(math.sqrt(n_particles / 4)))
                    coordinates = generate_doble_plano(use_layers, radius, packing)
                elif config == "tripleplano":
                    use_layers = layers if layers is not None else max(1, int(math.sqrt(n_particles / 6)))
                    coordinates = generate_triple_plano(use_layers, radius)
                else:
                    coordinates = generate_hexagonal_plane(
                        n_particles=n_particles,
                        radius=radius,
                        packing=packing,
                        complete_rings=True
                    )

            elif geometry_type == "sphere":
                df = 3.0
                config = configuration_type or "cuboctaedro"

                # For small N (1-6), use special configurations
                if n_particles <= 6 and layers is None:
                    coordinates = generate_hcp_sphere(n_particles=n_particles, radius=radius, packing=packing)
                else:
                    # Use layer-based or estimate layers from n_particles
                    use_layers = layers if layers is not None else max(1, int((n_particles / 13) ** (1/3)))
                    coordinates = generate_cuboctaedro(use_layers, radius, packing)
            else:
                raise ValueError(f"Unknown geometry type: {geometry_type}")

            # Update n_particles to actual count (may differ for complete geometries)
            actual_n = len(coordinates)
            if actual_n != n_particles:
                logger.info(
                    f"Limiting geometry: adjusted particle count from {n_particles} to {actual_n} "
                    f"for {configuration_type or geometry_type} geometry"
                )
                n_particles = actual_n

            # Compute prefactor with actual particle count
            if geometry_type == "chain":
                kf = compute_kf_chain(n_particles)
            elif geometry_type == "plane":
                kf = compute_kf_plane(n_particles)
            else:
                kf = compute_kf_sphere(n_particles)

            radii = np.full(n_particles, radius)
            execution_time_ms = int((time.perf_counter() - start_time) * 1000)

            # Compute metrics
            metrics = compute_limiting_metrics(coordinates, n_particles)
            metrics["fractal_dimension"] = df
            metrics["prefactor"] = kf

            # Convert coordinates to bytes (N x 4: x, y, z, radius)
            geometry_array = np.column_stack([coordinates, radii.reshape(-1, 1)])
            buffer = io.BytesIO()
            np.save(buffer, geometry_array)
            simulation.geometry = buffer.getvalue()
            simulation.metrics = metrics
            simulation.execution_time_ms = execution_time_ms
            simulation.engine_version = "python"

            # Update parameters to reflect actual N and configuration
            updated_params = dict(simulation.parameters)
            updated_params["n_particles"] = n_particles
            updated_params["geometry_type"] = geometry_type
            updated_params["configuration_type"] = configuration_type or config
            updated_params["packing"] = packing
            updated_params["fractal_dimension"] = df
            simulation.parameters = updated_params

            simulation.status = SimulationStatus.COMPLETED
            simulation.completed_at = timezone.now()
            simulation.save()

            logger.info(
                f"Limiting geometry {simulation_id} ({config}, packing={packing}) completed: "
                f"Df={df:.1f}, kf={kf:.3f}, N={n_particles}, Rg={metrics['radius_of_gyration']:.2f}, "
                f"time={execution_time_ms}ms"
            )

            return {
                "status": "completed",
                "simulation_id": simulation_id,
                "fractal_dimension": df,
                "execution_time_ms": execution_time_ms,
            }
        else:
            raise ValueError(f"Unknown algorithm: {algorithm}")

        # Convert coordinates to bytes (N x 4: x, y, z, radius)
        geometry_array = np.column_stack([
            result.coordinates,
            result.radii.reshape(-1, 1)
        ])
        buffer = io.BytesIO()
        np.save(buffer, geometry_array)
        simulation.geometry = buffer.getvalue()

        # Store metrics
        simulation.metrics = {
            "fractal_dimension": float(result.fractal_dimension),
            "fractal_dimension_std": float(result.fractal_dimension_std),
            "prefactor": float(result.prefactor),
            "radius_of_gyration": float(result.radius_of_gyration),
            "porosity": float(result.porosity),
            "coordination": {
                "mean": float(result.coordination_mean),
                "std": float(result.coordination_std),
            },
            "rg_evolution": result.rg_evolution.tolist(),
            # Inertia tensor analysis
            "anisotropy": float(result.anisotropy),
            "asphericity": float(result.asphericity),
            "acylindricity": float(result.acylindricity),
            "principal_moments": result.principal_moments.tolist(),
            "principal_axes": result.principal_axes.tolist(),
        }
        simulation.execution_time_ms = result.execution_time_ms
        simulation.engine_version = aglogen_core.version()

        simulation.status = SimulationStatus.COMPLETED
        simulation.completed_at = timezone.now()
        simulation.save()

        logger.info(
            f"Simulation {simulation_id} completed: "
            f"Df={result.fractal_dimension:.3f}, Rg={result.radius_of_gyration:.2f}, "
            f"time={result.execution_time_ms}ms"
        )

        return {
            "status": "completed",
            "simulation_id": simulation_id,
            "fractal_dimension": simulation.metrics["fractal_dimension"],
            "execution_time_ms": simulation.execution_time_ms,
        }

    except ImportError as e:
        logger.error(f"aglogen_core not installed: {e}")
        simulation.status = SimulationStatus.FAILED
        simulation.error_message = "Rust engine not installed. Run: cd aglogen_core && maturin develop --release"
        simulation.completed_at = timezone.now()
        simulation.save()

        return {
            "status": "failed",
            "simulation_id": simulation_id,
            "error": str(simulation.error_message),
        }

    except Exception as e:
        logger.exception(f"Simulation {simulation_id} failed: {e}")
        simulation.status = SimulationStatus.FAILED
        simulation.error_message = str(e)
        simulation.completed_at = timezone.now()
        simulation.save()

        return {
            "status": "failed",
            "simulation_id": simulation_id,
            "error": str(e),
        }
