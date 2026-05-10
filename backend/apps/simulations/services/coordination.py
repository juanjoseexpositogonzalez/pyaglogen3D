"""Coordination service — per-particle contact computation + distribution histogram.

Unified threshold: (r_i + r_j) * (1 + tolerance) across all computation sites.
Vectorized via numpy broadcasting for O(N²) distance matrix.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class ParticleCoordination:
    """Per-particle coordination result."""

    particle_id: int
    n_contacts: int
    contact_neighbors: list[int]


@dataclass
class CoordinationData:
    """Full coordination analysis result."""

    per_particle: list[ParticleCoordination]
    distribution: dict[str, int]
    mean: float
    std: float
    threshold_strategy: str
    tolerance: float


def compute_coordination_data(
    coords: np.ndarray,
    radii: np.ndarray,
    tolerance: float = 0.01,
) -> CoordinationData:
    """Compute per-particle coordination data with unified threshold.

    Uses vectorized numpy: threshold = (r_i + r_j) * (1 + tolerance).
    Self-contacts excluded via dist > 1e-12 guard.

    Args:
        coords: (N, 3) particle positions.
        radii: (N,) particle radii.
        tolerance: Fractional tolerance above sum-of-radii (default 1%).

    Returns:
        CoordinationData with per-particle contacts, distribution, mean, std.
    """
    n = len(coords)
    if n == 0:
        return CoordinationData(
            per_particle=[],
            distribution={"0": 0},
            mean=0.0,
            std=0.0,
            threshold_strategy="unified_r_sum_with_tolerance",
            tolerance=tolerance,
        )

    # Vectorized pairwise distances
    diffs = coords[:, None, :] - coords[None, :, :]
    dists = np.linalg.norm(diffs, axis=2)

    # Unified threshold matrix
    sum_radii = radii[:, None] + radii[None, :]
    threshold = sum_radii * (1 + tolerance)

    # Contact matrix (exclude self via dist > 1e-12)
    contacts = (dists <= threshold) & (dists > 1e-12)

    # Per-particle results
    per_particle: list[ParticleCoordination] = []
    counts = np.sum(contacts, axis=1)

    for i in range(n):
        neighbors = np.where(contacts[i])[0].tolist()
        per_particle.append(
            ParticleCoordination(
                particle_id=i,
                n_contacts=int(counts[i]),
                contact_neighbors=neighbors,
            )
        )

    # Distribution: count how many particles have each coordination number
    max_coord = int(counts.max()) if n > 0 else 0
    distribution: dict[str, int] = {}
    for k in range(max_coord + 1):
        distribution[str(k)] = int(np.sum(counts == k))

    mean = float(np.mean(counts))
    std = float(np.std(counts))

    return CoordinationData(
        per_particle=per_particle,
        distribution=distribution,
        mean=mean,
        std=std,
        threshold_strategy="unified_r_sum_with_tolerance",
        tolerance=tolerance,
    )
