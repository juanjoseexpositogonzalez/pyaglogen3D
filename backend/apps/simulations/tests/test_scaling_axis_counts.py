"""Issue #275: the scaling axis must ship with the counts it was measured on.

The engine path is covered in Rust
(`aglogen_core/engine/tests/scaling_axis_counts_test.rs`). What is testable here is
the metric payload the API stores and a client reads, because a client that cannot
find the counts has to rebuild them — and rebuilding them from the array length is
exactly the defect: the count after a merge is not the point's index.
"""

import numpy as np

from apps.simulations.tasks import compute_limiting_metrics


def test_a_limiting_case_pairs_every_rg_point_with_its_prefix_size():
    coords = np.array([[float(i), 0.0, 0.0] for i in range(10)])

    metrics = compute_limiting_metrics(coords, n_particles=10, radius=1.0)

    assert len(metrics["rg_evolution_n"]) == len(metrics["rg_evolution"])
    # The prefix sizes the loop actually sampled, in the same order.
    assert metrics["rg_evolution_n"] == list(range(1, 11))


def test_a_geometry_with_no_evolution_ships_no_counts():
    # An empty pair is the honest answer: a client can say "no axis" instead of
    # drawing a line over counts nobody measured.
    metrics = compute_limiting_metrics(np.empty((0, 3)), n_particles=0, radius=1.0)

    assert metrics["rg_evolution"] == []
    assert metrics["rg_evolution_n"] == []
