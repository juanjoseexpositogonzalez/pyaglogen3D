"""Tests for CSV export coordination sections (per-particle + distribution).

Strict TDD: Ensures SimViewSet.export_csv emits coordination_per_particle
and coordination_distribution sections, and ParametricStudyViewSet.export_csv
appends coord_mean, coord_std, coord_mode, coord_max columns.
"""

from __future__ import annotations

import csv
import io
import uuid

import numpy as np
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation


# ── Helpers (local fixtures, no shared state) ─────────────────────────


def _geometry_bytes(n: int = 3, radius: float = 1.0) -> bytes:
    """n-particle chain on x-axis."""
    coords = np.array(
        [[2 * radius * i, 0.0, 0.0, radius] for i in range(n)],
        dtype=np.float64,
    )
    buf = io.BytesIO()
    np.save(buf, coords)
    return buf.getvalue()


def _metrics_with_coordination() -> dict:
    """Metrics dict including all 6 coordination fields."""
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
    """Metrics dict WITHOUT per_particle/distribution (legacy sim)."""
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
        email=f"coord-csv-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(owner: User) -> Project:
    return Project.objects.create(name="Coord CSV Project", owner=owner)


def _make_sim(
    project: Project,
    metrics: dict | None = None,
    *,
    name: str = "sim",
    seed: int = 42,
    is_batch: bool = False,
) -> Simulation:
    return Simulation.objects.create(
        project=project,
        name=name,
        algorithm="dla",
        parameters={
            "n_particles": 3,
            "primary_particle_diameter_nm": 40.0,
            "parameters_schema_version": "v2",
        },
        seed=seed,
        status="completed",
        geometry=_geometry_bytes(),
        metrics=metrics or _metrics_with_coordination(),
        is_batch=is_batch,
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _parse_csv(body: bytes, delimiter: str = ",") -> list[list[str]]:
    return list(csv.reader(io.StringIO(body.decode("utf-8")), delimiter=delimiter))


# ── T3.1: per-sim CSV has new sections ────────────────────────────────


@pytest.mark.django_db
def test_export_csv_has_coordination_per_particle_section():
    """SimViewSet.export_csv must emit '# section: coordination_per_particle'."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project)

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    assert response.status_code == 200

    text = response.content.decode("utf-8")
    assert "# section: coordination_per_particle" in text


@pytest.mark.django_db
def test_export_csv_has_coordination_distribution_section():
    """SimViewSet.export_csv must emit '# section: coordination_distribution'."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project)

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    assert response.status_code == 200

    text = response.content.decode("utf-8")
    assert "# section: coordination_distribution" in text


# ── T3.2: section content is correct ─────────────────────────────────


@pytest.mark.django_db
def test_export_csv_per_particle_section_content():
    """Per-particle section has correct headers and data rows."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project)

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    rows = _parse_csv(response.content)

    # Find the per-particle section
    section_idx = None
    for i, row in enumerate(rows):
        if row and row[0] == "# section: coordination_per_particle":
            section_idx = i
            break
    assert section_idx is not None, "coordination_per_particle section not found"

    # Next row should be headers
    header = rows[section_idx + 1]
    assert header == ["particle_id", "n_contacts", "contact_neighbors"]

    # Data rows
    data_row_0 = rows[section_idx + 2]
    assert data_row_0[0] == "0"  # particle_id
    assert data_row_0[1] == "1"  # n_contacts
    assert data_row_0[2] == "1"  # contact_neighbors (single neighbor)


@pytest.mark.django_db
def test_export_csv_distribution_section_content():
    """Distribution section has correct headers and data rows."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project)

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    rows = _parse_csv(response.content)

    # Find the distribution section
    section_idx = None
    for i, row in enumerate(rows):
        if row and row[0] == "# section: coordination_distribution":
            section_idx = i
            break
    assert section_idx is not None, "coordination_distribution section not found"

    header = rows[section_idx + 1]
    assert header == ["coordination", "count"]

    # Check distribution data — sum must equal n_particles
    dist_sum = 0
    for row in rows[section_idx + 2:]:
        if not row or row[0].startswith("#"):
            break
        dist_sum += int(row[1])
    assert dist_sum == 3


# ── T3.3: existing column order regression ────────────────────────────


@pytest.mark.django_db
def test_export_csv_existing_sections_preserved():
    """Existing sections (AGGLOMERATE PROPERTIES, PARTICLE DATA) unchanged."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project)

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    rows = _parse_csv(response.content)

    # Existing sections must still be present in order
    sections = [row[0] for row in rows if row and row[0].startswith("#")]
    assert "# AGGLOMERATE PROPERTIES" in sections
    assert "# PARTICLE DATA" in sections

    # Particle header must have original columns in original order
    particle_header = None
    for i, row in enumerate(rows):
        if row and row[0] == "Particle #":
            particle_header = row
            break
    assert particle_header is not None
    expected_prefix = ["Particle #", "X", "Y", "Z", "Radius", "radius_nm", "Coordination #"]
    assert particle_header[:len(expected_prefix)] == expected_prefix


# ── T3.3b: legacy sim (no per_particle) still exports ────────────────


@pytest.mark.django_db
def test_export_csv_legacy_sim_no_crash():
    """Legacy sim without per_particle in metrics still exports without crash."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project, metrics=_metrics_legacy())

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    assert response.status_code == 200

    text = response.content.decode("utf-8")
    # Sections should still appear (possibly empty if no data)
    assert "# section: coordination_per_particle" in text
    assert "# section: coordination_distribution" in text


# ── T3.4: batch CSV has 4 new columns ────────────────────────────────


@pytest.mark.django_db
def test_batch_export_has_coord_columns():
    """ParametricStudy.export_csv must have coord_mean, coord_std, coord_mode, coord_max."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project, is_batch=True)
    study = ParametricStudy.objects.create(
        project=project,
        name="Batch test",
        base_algorithm="dla",
        base_parameters={"n_particles": 3},
        parameter_grid={},
        status="completed",
    )
    study.simulations.add(sim)

    url = reverse(
        "project-studies-export",
        kwargs={"project_pk": project.id, "pk": study.id},
    )
    response = _authed_client(user).get(url)
    assert response.status_code == 200

    rows = _parse_csv(response.content)
    header = rows[0]

    for col in ["Coord_Mode", "Coord_Max"]:
        assert col in header, f"Missing column: {col}"


# ── T3.5: coord columns have correct values ──────────────────────────


@pytest.mark.django_db
def test_batch_export_coord_values():
    """Batch CSV coord columns have correct values from distribution."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project, is_batch=True)
    study = ParametricStudy.objects.create(
        project=project,
        name="Batch values test",
        base_algorithm="dla",
        base_parameters={"n_particles": 3},
        parameter_grid={},
        status="completed",
    )
    study.simulations.add(sim)

    url = reverse(
        "project-studies-export",
        kwargs={"project_pk": project.id, "pk": study.id},
    )
    response = _authed_client(user).get(url)
    rows = _parse_csv(response.content)
    header = rows[0]
    data = rows[1]

    mode_col = header.index("Coord_Mode")
    max_col = header.index("Coord_Max")

    # Distribution: {"0": 0, "1": 2, "2": 1} → mode=1, max=2
    assert int(data[mode_col]) == 1
    assert int(data[max_col]) == 2


# ── T3.6: mode smallest of multiple modes (R6 contract) ──────────────


@pytest.mark.django_db
def test_batch_export_coord_mode_smallest_multimodal():
    """When distribution has multiple modes, coord_mode = smallest."""
    user = _make_user()
    project = _make_project(user)

    # Create metrics with multimodal distribution: {0: 3, 2: 3, 5: 2}
    metrics = _metrics_with_coordination()
    metrics["coordination"]["distribution"] = {"0": 3, "2": 3, "5": 2}

    sim = _make_sim(project, metrics=metrics, is_batch=True)
    study = ParametricStudy.objects.create(
        project=project,
        name="Multimodal test",
        base_algorithm="dla",
        base_parameters={"n_particles": 3},
        parameter_grid={},
        status="completed",
    )
    study.simulations.add(sim)

    url = reverse(
        "project-studies-export",
        kwargs={"project_pk": project.id, "pk": study.id},
    )
    response = _authed_client(user).get(url)
    rows = _parse_csv(response.content)
    header = rows[0]
    data = rows[1]

    mode_col = header.index("Coord_Mode")
    # Mode 0 and 2 both have count 3 → smallest = 0
    assert int(data[mode_col]) == 0


# ── T3.7: regression — existing batch columns still parseable ─────────


@pytest.mark.django_db
def test_batch_export_existing_columns_preserved():
    """Existing Coord_Mean, Coord_Std columns preserved at same position."""
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(project, is_batch=True)
    study = ParametricStudy.objects.create(
        project=project,
        name="Regression test",
        base_algorithm="dla",
        base_parameters={"n_particles": 3},
        parameter_grid={},
        status="completed",
    )
    study.simulations.add(sim)

    url = reverse(
        "project-studies-export",
        kwargs={"project_pk": project.id, "pk": study.id},
    )
    response = _authed_client(user).get(url)
    rows = _parse_csv(response.content)
    header = rows[0]

    # Existing columns must still be present
    assert "Coord_Mean" in header
    assert "Coord_Std" in header

    # New columns must come AFTER existing columns
    coord_mean_idx = header.index("Coord_Mean")
    coord_mode_idx = header.index("Coord_Mode")
    coord_max_idx = header.index("Coord_Max")

    assert coord_mode_idx > coord_mean_idx
    assert coord_max_idx > coord_mean_idx
