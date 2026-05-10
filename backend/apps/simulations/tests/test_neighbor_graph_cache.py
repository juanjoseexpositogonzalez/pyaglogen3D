"""Tests for neighbor_graph cache optimization (Phase 4).

Verifies that the neighbor_graph endpoint uses cached per_particle data
from metrics["coordination"]["per_particle"] when available, and falls
back to recomputation for legacy sims.
"""

from __future__ import annotations

import io
import uuid

import numpy as np
import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from unittest.mock import patch

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation


# ── Helpers ────────────────────────────────────────────────────────────


def _geometry_bytes_chain(n: int = 3, radius: float = 1.0) -> bytes:
    """n-particle chain on x-axis, touching at contact distance."""
    coords = np.array(
        [[2 * radius * i, 0.0, 0.0, radius] for i in range(n)],
        dtype=np.float64,
    )
    buf = io.BytesIO()
    np.save(buf, coords)
    return buf.getvalue()


def _metrics_with_per_particle() -> dict:
    """Metrics including cached coordination.per_particle for 3-particle chain."""
    return {
        "radius_of_gyration": 0.5,
        "fractal_dimension": 1.8,
        "fractal_dimension_std": 0.05,
        "prefactor": 1.0,
        "porosity": 0.5,
        "coordination": {
            "mean": 1.33,
            "std": 0.47,
            "per_particle": [
                {"particle_id": 0, "n_contacts": 1, "contact_neighbors": [1]},
                {"particle_id": 1, "n_contacts": 2, "contact_neighbors": [0, 2]},
                {"particle_id": 2, "n_contacts": 1, "contact_neighbors": [1]},
            ],
            "distribution": {"0": 0, "1": 2, "2": 1},
            "threshold_strategy": "unified_r_sum_with_tolerance",
            "tolerance": 0.01,
        },
        "anisotropy": 1.0,
        "asphericity": 0.0,
        "acylindricity": 0.0,
        "principal_moments": [1.0, 1.0, 1.0],
    }


def _metrics_legacy() -> dict:
    """Metrics WITHOUT per_particle (legacy sim)."""
    return {
        "radius_of_gyration": 0.5,
        "fractal_dimension": 1.8,
        "fractal_dimension_std": 0.05,
        "prefactor": 1.0,
        "porosity": 0.5,
        "coordination": {"mean": 2.0, "std": 0.1},
        "anisotropy": 1.0,
        "asphericity": 0.0,
        "acylindricity": 0.0,
        "principal_moments": [1.0, 1.0, 1.0],
    }


def _make_user() -> User:
    return User.objects.create_user(
        email=f"ng-cache-{uuid.uuid4()}@test.com",
        password="x",
    )


def _make_project(owner: User) -> Project:
    return Project.objects.create(name="NG Cache Test", owner=owner)


def _make_sim(project, metrics, geometry=None) -> Simulation:
    return Simulation.objects.create(
        project=project,
        name="cache sim",
        algorithm="dla",
        parameters={
            "n_particles": 3,
            "primary_particle_diameter_nm": 40.0,
            "parameters_schema_version": "v2",
        },
        seed=42,
        status="completed",
        geometry=geometry or _geometry_bytes_chain(),
        metrics=metrics,
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _ng_url(project_id, sim_id) -> str:
    return reverse(
        "project-simulations-neighbor-graph",
        kwargs={"project_pk": project_id, "pk": sim_id},
    )


# ── T4.1: cached per_particle avoids recomputation ───────────────────


@pytest.mark.django_db
def test_neighbor_graph_uses_cache_when_per_particle_exists():
    """When metrics.coordination.per_particle exists, _calculate_adjacency_graph is NOT called."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project, _metrics_with_per_particle())

    url = _ng_url(project.id, sim.id)

    with patch(
        "apps.simulations.views.SimulationViewSet._calculate_adjacency_graph"
    ) as mock_adj:
        response = _authed_client(user).get(url)

    assert response.status_code == 200
    # Adjacency graph should NOT have been called (cache hit)
    mock_adj.assert_not_called()


@pytest.mark.django_db
def test_neighbor_graph_cache_returns_correct_nodes():
    """Cache-hit path returns correct node structure with coordination from per_particle."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project, _metrics_with_per_particle())

    url = _ng_url(project.id, sim.id)
    response = _authed_client(user).get(url)
    assert response.status_code == 200

    data = response.json()
    nodes = data["nodes"]
    assert len(nodes) == 3

    # Node IDs are 1-based
    assert nodes[0]["id"] == 1
    assert nodes[0]["coordination"] == 1  # particle_id=0 has 1 contact
    assert nodes[1]["id"] == 2
    assert nodes[1]["coordination"] == 2  # particle_id=1 has 2 contacts
    assert nodes[2]["id"] == 3
    assert nodes[2]["coordination"] == 1  # particle_id=2 has 1 contact


@pytest.mark.django_db
def test_neighbor_graph_cache_returns_correct_edges():
    """Cache-hit path produces correct edges from contact_neighbors."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project, _metrics_with_per_particle())

    url = _ng_url(project.id, sim.id)
    response = _authed_client(user).get(url)
    data = response.json()

    edges = data["edges"]
    # 3-particle chain: edges (0,1) and (1,2) → (1,2) and (2,3) in 1-based
    edge_pairs = {tuple(sorted([e["source"], e["target"]])) for e in edges}
    assert edge_pairs == {(1, 2), (2, 3)}


# ── T4.3: legacy sim fallback (no per_particle in metrics) ────────────


@pytest.mark.django_db
def test_neighbor_graph_legacy_sim_falls_back_to_compute():
    """Legacy sim (no per_particle) falls back to _calculate_adjacency_graph."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project, _metrics_legacy())

    url = _ng_url(project.id, sim.id)

    with patch(
        "apps.simulations.views.SimulationViewSet._calculate_adjacency_graph",
    ) as mock_adj:
        # Return a valid adjacency list so the rest of the endpoint doesn't crash
        mock_adj.return_value = [[1], [0, 2], [1]]
        response = _authed_client(user).get(url)

    assert response.status_code == 200
    # Fallback: adjacency graph WAS computed
    mock_adj.assert_called_once()


@pytest.mark.django_db
def test_neighbor_graph_legacy_sim_returns_valid_data():
    """Legacy sim still returns valid nodes/edges/stats."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project, _metrics_legacy())

    url = _ng_url(project.id, sim.id)
    response = _authed_client(user).get(url)
    assert response.status_code == 200

    data = response.json()
    assert "nodes" in data
    assert "edges" in data
    assert "stats" in data
    assert len(data["nodes"]) == 3
    assert data["stats"]["n_particles"] == 3


# ── T4.4: cached vs recomputed produce IDENTICAL results ──────────────


@pytest.mark.django_db
def test_neighbor_graph_cached_vs_recomputed_identical():
    """Cache-hit and recompute paths produce identical contact sets."""
    user = _make_user()
    project = _make_project(user)
    geometry = _geometry_bytes_chain(3, 1.0)

    # Sim WITH cached per_particle
    sim_cached = _make_sim(
        project, _metrics_with_per_particle(), geometry=geometry
    )
    # Sim WITHOUT per_particle (legacy) but same geometry
    sim_legacy = _make_sim(
        project, _metrics_legacy(), geometry=geometry
    )

    client = _authed_client(user)

    resp_cached = client.get(_ng_url(project.id, sim_cached.id))
    resp_legacy = client.get(_ng_url(project.id, sim_legacy.id))

    assert resp_cached.status_code == 200
    assert resp_legacy.status_code == 200

    cached_data = resp_cached.json()
    legacy_data = resp_legacy.json()

    # Compare contact sets: extract edge pairs
    cached_edges = {
        tuple(sorted([e["source"], e["target"]])) for e in cached_data["edges"]
    }
    legacy_edges = {
        tuple(sorted([e["source"], e["target"]])) for e in legacy_data["edges"]
    }
    assert cached_edges == legacy_edges

    # Compare coordination numbers per node
    cached_coords = {n["id"]: n["coordination"] for n in cached_data["nodes"]}
    legacy_coords = {n["id"]: n["coordination"] for n in legacy_data["nodes"]}
    assert cached_coords == legacy_coords
