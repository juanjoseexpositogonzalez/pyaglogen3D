"""Tests for the comparison surface and per-config aggregates (R4/R5 — T4/T5).

Covers spec requirements of `batch-windowed-box-counting`:
- R4: results rows carry the windowed block; bc_delta only when the
  windowed status is ok; no rg_df alias
- R5.1: hand-computed aggregate over bc_windowed values incl. refusals
- R5: rg reads fractal_dimension; config keys from parameter_grid
"""

from __future__ import annotations

import uuid

import numpy as np
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation

# ── Fixtures / helpers ─────────────────────────────────────────────────


def _make_user() -> User:
    return User.objects.create_user(
        email=f"bc-agg-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(user: User) -> Project:
    return Project.objects.create(name="BC Agg Project", owner=user)


def _make_study(project: Project) -> ParametricStudy:
    return ParametricStudy.objects.create(
        project=project,
        name="BC Agg Study",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
        parameter_grid={"n_particles": [100, 200]},
        include_box_counting=True,
    )


def _make_sim(
    project: Project,
    study: ParametricStudy,
    *,
    n_particles: int,
    metrics: dict,
) -> Simulation:
    sim = Simulation.objects.create(
        project=project,
        name=f"sim-{uuid.uuid4()}",
        algorithm="dla",
        parameters={"n_particles": n_particles},
        seed=42,
        status="completed",
        geometry=None,
        metrics=metrics,
    )
    study.simulations.add(sim)
    return sim


def _legacy_block(dimension: float) -> dict:
    return {
        "dimension": dimension,
        "r_squared": 0.99,
        "std_error": 0.01,
        "confidence_interval": [dimension - 0.1, dimension + 0.1],
        "log_scales": [1.0],
        "log_values": [2.0],
        "execution_time_ms": 5,
        "parameters": {"points_per_sphere": 100, "precision": 18},
    }


def _windowed_block(dimension: float | None, status: str) -> dict:
    return {
        "dimension": dimension,
        "r_squared": 0.98 if status == "ok" else None,
        "std_error": 0.02 if status == "ok" else None,
        "confidence_interval": [dimension - 0.1, dimension + 0.1]
        if status == "ok"
        else None,
        "log_scales": [1.0] if status == "ok" else None,
        "log_values": [2.0] if status == "ok" else None,
        "execution_time_ms": 5 if status == "ok" else 0,
        "parameters": {"points_per_sphere": 100, "precision": 18},
        "status": status,
        "fit_window_used": [0, 2] if status == "ok" else None,
        "error_message": None,
    }


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _results_url(study: ParametricStudy) -> str:
    return reverse(
        "project-studies-results",
        kwargs={"project_pk": study.project_id, "pk": study.id},
    )


def _summary_url(study: ParametricStudy) -> str:
    return reverse(
        "project-studies-fractal-analysis",
        kwargs={"project_pk": study.project_id, "pk": study.id},
    )


@pytest.fixture
def user(db):
    return _make_user()


@pytest.fixture
def project(user):
    return _make_project(user)


# ── R4 — comparison surface ────────────────────────────────────────────


@pytest.mark.django_db
class TestR4ResultsRows:
    def test_ok_windowed_row_has_block_and_delta(self, user, project):
        study = _make_study(project)
        _make_sim(
            project,
            study,
            n_particles=100,
            metrics={
                "fractal_dimension": 1.8,
                "box_counting": _legacy_block(2.0),
                "box_counting_windowed": _windowed_block(2.3, "ok"),
            },
        )
        client = _authed_client(user)

        response = client.get(_results_url(study))

        assert response.status_code == 200
        row = response.data["results"][0]
        assert row["box_counting_windowed"]["status"] == "ok"
        assert row["bc_delta"] == pytest.approx(0.3)
        # R4/M4: no rg_df alias — the Rg Df is fractal_dimension itself
        assert "rg_df" not in row
        assert row["fractal_dimension"] == 1.8

    def test_refusal_row_has_block_but_no_delta(self, user, project):
        study = _make_study(project)
        _make_sim(
            project,
            study,
            n_particles=100,
            metrics={
                "box_counting": _legacy_block(2.0),
                "box_counting_windowed": _windowed_block(None, "insufficient_levels"),
            },
        )
        client = _authed_client(user)

        response = client.get(_results_url(study))

        row = response.data["results"][0]
        assert row["box_counting_windowed"]["status"] == "insufficient_levels"
        assert "bc_delta" not in row

    def test_legacy_only_row_has_no_windowed_keys(self, user, project):
        study = _make_study(project)
        _make_sim(
            project,
            study,
            n_particles=100,
            metrics={"box_counting": _legacy_block(2.0)},
        )
        client = _authed_client(user)

        response = client.get(_results_url(study))

        row = response.data["results"][0]
        assert row["box_counting_windowed"] is None
        assert "bc_delta" not in row


# ── R5 — per-config distributions ──────────────────────────────────────


@pytest.mark.django_db
class TestR5FractalAnalysisSummary:
    def test_r5_1_hand_computed_windowed_aggregate(self, user, project):
        """bc_windowed values [2.30, 2.50, 2.70] + 1 refusal per R5.1."""
        study = _make_study(project)
        for dimension in (2.30, 2.50, 2.70):
            _make_sim(
                project,
                study,
                n_particles=100,
                metrics={
                    "box_counting": _legacy_block(dimension - 0.1),
                    "box_counting_windowed": _windowed_block(dimension, "ok"),
                },
            )
        _make_sim(
            project,
            study,
            n_particles=100,
            metrics={
                "box_counting": _legacy_block(2.0),
                "box_counting_windowed": _windowed_block(None, "insufficient_levels"),
            },
        )
        client = _authed_client(user)

        response = client.get(_summary_url(study))

        assert response.status_code == 200
        configs = response.data["configs"]
        assert len(configs) == 1
        win = configs[0]["estimators"]["bc_windowed"]
        arr = np.array([2.30, 2.50, 2.70])
        assert win["n"] == 3
        assert win["mean"] == pytest.approx(float(np.mean(arr)))
        assert win["median"] == pytest.approx(float(np.median(arr)))
        assert win["q1"] == pytest.approx(float(np.percentile(arr, 25)))
        assert win["q3"] == pytest.approx(float(np.percentile(arr, 75)))
        assert win["min"] == pytest.approx(2.30)
        assert win["max"] == pytest.approx(2.70)
        assert win["values"] == [2.30, 2.50, 2.70]
        assert win["insufficient_levels"] == 1
        assert win["errors"] == 0

    def test_rg_reads_fractal_dimension_and_groups_by_config(self, user, project):
        study = _make_study(project)
        _make_sim(
            project,
            study,
            n_particles=100,
            metrics={"fractal_dimension": 1.8, "box_counting": _legacy_block(2.0)},
        )
        _make_sim(
            project,
            study,
            n_particles=100,
            metrics={"fractal_dimension": 1.9, "box_counting": _legacy_block(2.1)},
        )
        _make_sim(
            project,
            study,
            n_particles=200,
            metrics={"fractal_dimension": 2.1, "box_counting": _legacy_block(2.4)},
        )
        client = _authed_client(user)

        response = client.get(_summary_url(study))

        configs = response.data["configs"]
        assert len(configs) == 2
        # Config mirrors sim.parameters restricted to parameter_grid keys
        assert configs[0]["config"] == {"n_particles": 100}
        assert configs[1]["config"] == {"n_particles": 200}

        rg_small = configs[0]["estimators"]["rg"]
        assert rg_small["n"] == 2
        assert rg_small["values"] == [1.8, 1.9]
        assert rg_small["insufficient_levels"] == 0
        assert rg_small["errors"] == 0

        bc_legacy_small = configs[0]["estimators"]["bc_legacy"]
        assert bc_legacy_small["n"] == 2
        assert bc_legacy_small["values"] == [2.0, 2.1]

    def test_empty_study_yields_null_stats(self, user, project):
        study = _make_study(project)
        _make_sim(project, study, n_particles=100, metrics={})
        client = _authed_client(user)

        response = client.get(_summary_url(study))

        config = response.data["configs"][0]
        for name in ("rg", "bc_legacy", "bc_windowed"):
            est = config["estimators"][name]
            assert est["n"] == 0
            assert est["mean"] is None
            assert est["values"] == []

    def test_windowed_error_counted_separately(self, user, project):
        study = _make_study(project)
        _make_sim(
            project,
            study,
            n_particles=100,
            metrics={
                "box_counting": _legacy_block(2.0),
                "box_counting_windowed": _windowed_block(None, "insufficient_levels"),
            },
        )
        _make_sim(
            project,
            study,
            n_particles=100,
            metrics={
                "box_counting": _legacy_block(2.0),
                "box_counting_windowed": {
                    **_windowed_block(None, "error"),
                    "error_message": "boom",
                },
            },
        )
        client = _authed_client(user)

        response = client.get(_summary_url(study))

        win = response.data["configs"][0]["estimators"]["bc_windowed"]
        assert win["n"] == 0
        assert win["insufficient_levels"] == 1
        assert win["errors"] == 1
