"""Integration tests for CSV export unit scaling (v1 + v2 fixtures).

These tests exercise the real CSV export endpoints end-to-end for both the
single-simulation export (``SimulationViewSet.export_csv``) and the batch-study
export (``ParametricStudyViewSet.export_csv``).

They freeze the Rg-unit contract at the HTTP boundary:

- Every exported Rg value is pre-scaled to nm on the server as
  ``rg_engine * (dpo / 2)`` where ``dpo`` is resolved by the schema shim.
- The single-sim CSV carries a ``Unit`` column with ``"nm"`` on the Rg row.
- The batch CSV encodes the unit in the column header (``Rg_nm``).
- v1 (legacy ``primary_particle_radius_nm``) and v2
  (``primary_particle_diameter_nm`` + explicit version stamp) simulations are
  scaled correctly via the shim with no branching at the call sites.
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


# --- Fixture helpers ---------------------------------------------------------


def _minimal_geometry_bytes(n: int = 3, radius: float = 1.0) -> bytes:
    """Return a NumPy-saved ``(n, 4)`` geometry array as raw bytes.

    The single-sim export path reads ``simulation.geometry`` via ``np.load``
    and expects columns ``[x, y, z, radius]``. A 3-particle linear chain on
    the x-axis keeps the coordination/CDG calculations deterministic and
    cheap while still exercising the full view code path.
    """
    coords = np.array(
        [
            [0.0, 0.0, 0.0, radius],
            [2.0 * radius, 0.0, 0.0, radius],
            [4.0 * radius, 0.0, 0.0, radius],
        ],
        dtype=np.float64,
    )[:n]
    buf = io.BytesIO()
    np.save(buf, coords)
    return buf.getvalue()


def _metrics(rg_engine: float) -> dict:
    """Return a minimal ``metrics`` dict with a known dimensionless Rg."""
    return {
        "radius_of_gyration": rg_engine,
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
        email=f"csv-test-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(owner: User) -> Project:
    return Project.objects.create(name="CSV Export Test Project", owner=owner)


def _make_simulation(
    project: Project,
    parameters: dict,
    rg_engine: float,
    *,
    name: str = "sim",
    seed: int = 42,
    is_batch: bool = False,
) -> Simulation:
    """Create a completed Simulation with real geometry and known Rg."""
    return Simulation.objects.create(
        project=project,
        name=name,
        algorithm="dla",
        parameters=parameters,
        seed=seed,
        status="completed",
        geometry=_minimal_geometry_bytes(),
        metrics=_metrics(rg_engine),
        is_batch=is_batch,
    )


def _parse_csv(content: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(content.decode("utf-8"))))


def _find_rg_row(rows: list[list[str]]) -> list[str]:
    """Return the single-sim CSV row whose first cell starts with ``Radius of Gyration``."""
    for row in rows:
        if row and row[0].startswith("Radius of Gyration"):
            return row
    raise AssertionError(
        "Rg row not found in CSV; first column values were: "
        + repr([r[0] if r else "" for r in rows])
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# --- Single-sim CSV export ---------------------------------------------------


@pytest.mark.django_db
class TestSingleSimCsvExport:
    """Endpoint: ``/api/v1/projects/<project_pk>/simulations/<pk>/export/``."""

    def test_v2_simulation_exports_rg_in_nm(self) -> None:
        """v2 sim: dpo=40 nm, rg_engine=0.5 → Rg cell = 10.0 nm."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_simulation(
            project,
            parameters={
                "n_particles": 3,
                "primary_particle_diameter_nm": 40.0,
                "parameters_schema_version": "v2",
            },
            rg_engine=0.5,
        )

        url = reverse(
            "project-simulations-export",
            kwargs={"project_pk": project.id, "pk": sim.id},
        )
        response = _authed_client(user).get(url)

        assert response.status_code == 200, response.content
        rows = _parse_csv(response.content)
        rg_row = _find_rg_row(rows)

        # rg_nm = rg_engine * (dpo / 2) = 0.5 * 20 = 10.0
        assert float(rg_row[1]) == pytest.approx(10.0)
        assert rg_row[2] == "nm"

    def test_v1_legacy_simulation_uses_shim(self) -> None:
        """v1 sim: primary_particle_radius_nm=25 → dpo=50 → scale=25."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_simulation(
            project,
            parameters={
                "n_particles": 3,
                # Legacy v1 shape: radius only, no schema version stamp.
                "primary_particle_radius_nm": 25.0,
            },
            rg_engine=1.2,
        )

        url = reverse(
            "project-simulations-export",
            kwargs={"project_pk": project.id, "pk": sim.id},
        )
        response = _authed_client(user).get(url)

        assert response.status_code == 200, response.content
        rg_row = _find_rg_row(_parse_csv(response.content))

        # Shim: radius_nm=25 → dpo=50 → scale=25. Rg = 1.2 * 25 = 30.0
        assert float(rg_row[1]) == pytest.approx(30.0)
        assert rg_row[2] == "nm"

    def test_v1_zero_radius_falls_through_to_default(self) -> None:
        """Edge case: v1 radius=0 → shim defaults to dpo=50 → scale=25."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_simulation(
            project,
            parameters={
                "n_particles": 3,
                # Zero radius is rejected by the shim (non-positive) and
                # must fall through to ``DEFAULT_DIAMETER_NM`` (50.0).
                "primary_particle_radius_nm": 0,
            },
            rg_engine=0.8,
        )

        url = reverse(
            "project-simulations-export",
            kwargs={"project_pk": project.id, "pk": sim.id},
        )
        response = _authed_client(user).get(url)

        assert response.status_code == 200, response.content
        rg_row = _find_rg_row(_parse_csv(response.content))

        # Default dpo=50 → scale=25. Rg = 0.8 * 25 = 20.0
        assert float(rg_row[1]) == pytest.approx(20.0)
        assert rg_row[2] == "nm"


# --- Batch CSV export --------------------------------------------------------


@pytest.mark.django_db
class TestBatchCsvExport:
    """Endpoint: ``/api/v1/projects/<project_pk>/studies/<pk>/export/``."""

    def test_batch_mixed_v1_v2_scales_per_row(self) -> None:
        """Mixed v1/v2 batch: each row scaled by its own dpo/2 via the shim."""
        user = _make_user()
        project = _make_project(user)

        # v1 sim: radius=10 → dpo=20 → scale=10. Rg_engine=0.4 → 4.0 nm.
        v1_sim = _make_simulation(
            project,
            parameters={
                "n_particles": 3,
                "primary_particle_radius_nm": 10.0,
            },
            rg_engine=0.4,
            name="v1-sim",
            seed=1,
            is_batch=True,
        )
        # v2 sim: dpo=50 → scale=25. Rg_engine=0.6 → 15.0 nm.
        v2_sim = _make_simulation(
            project,
            parameters={
                "n_particles": 3,
                "primary_particle_diameter_nm": 50.0,
                "parameters_schema_version": "v2",
            },
            rg_engine=0.6,
            name="v2-sim",
            seed=2,
            is_batch=True,
        )

        study = ParametricStudy.objects.create(
            project=project,
            name="Mixed v1/v2 study",
            base_algorithm="dla",
            base_parameters={"n_particles": 3},
            parameter_grid={},
            status="completed",
        )
        study.simulations.add(v1_sim, v2_sim)

        url = reverse(
            "project-studies-export",
            kwargs={"project_pk": project.id, "pk": study.id},
        )
        response = _authed_client(user).get(url)

        assert response.status_code == 200, response.content
        rows = _parse_csv(response.content)
        assert len(rows) >= 3, f"expected header + 2 data rows, got {rows!r}"

        header, *data_rows = rows

        # Batch export encodes the unit in the column name, not a Unit column.
        assert "Rg_nm" in header, f"header missing Rg_nm: {header}"
        assert "Rg" not in [h for h in header if h == "Rg"], (
            f"header should use Rg_nm, not bare Rg: {header}"
        )
        rg_col = header.index("Rg_nm")
        id_col = header.index("Simulation ID")

        # Index data rows by simulation id so test order doesn't depend on
        # the ``created_at`` ordering applied by the view.
        rows_by_id = {row[id_col]: row for row in data_rows}
        assert str(v1_sim.id) in rows_by_id
        assert str(v2_sim.id) in rows_by_id

        v1_rg = float(rows_by_id[str(v1_sim.id)][rg_col])
        v2_rg = float(rows_by_id[str(v2_sim.id)][rg_col])

        # Each row uses its own shim-resolved scale factor.
        assert v1_rg == pytest.approx(4.0), (
            f"v1: rg_engine=0.4 * scale=10 should be 4.0, got {v1_rg}"
        )
        assert v2_rg == pytest.approx(15.0), (
            f"v2: rg_engine=0.6 * scale=25 should be 15.0, got {v2_rg}"
        )
