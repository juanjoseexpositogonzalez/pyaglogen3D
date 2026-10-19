"""Tests for the batch windowed box-counting run (R1, R2 — T1/T2).

Covers spec requirements of `batch-windowed-box-counting`:
- R1.1: absent `windowed` is a no-op (legacy-only run)
- R1.2: unknown-key rejection naming the offending key (body + persisted
  shape via the shared validator)
- R1.3: precedence request body > study params > absent; `save()` preserves
  the flag; explicit `windowed: false` overrides and persists
- R2.1: windowed block with the single 11-key schema, status ok, legacy
  block bit-identical to a legacy-only run
- R2.2: eff < 3 → insufficient_levels with nulls WITHOUT calling the
  windowed estimator; eff == 3 → window (0, 2) → ok
- R2.3: skip semantics and force re-run; `force` never persisted
"""

from __future__ import annotations

import io
from unittest.mock import patch

import numpy as np
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation
from apps.simulations.tasks import derive_fit_window

# ── Fixtures / helpers ─────────────────────────────────────────────────


def _geometry_bytes(n_spheres: int = 4, radius: float = 0.5) -> bytes:
    coords = np.array(
        [[2.0 * radius * i, 0.0, 0.0, radius] for i in range(n_spheres)],
        dtype=np.float64,
    )
    buf = io.BytesIO()
    np.save(buf, coords)
    return buf.getvalue()


def _make_user() -> User:
    return User.objects.create_user(
        email=f"bc-batch-{np.random.randint(1 << 30)}@example.com",
        password="irrelevant",
    )


def _make_study(
    project: Project,
    *,
    box_counting_params: dict | None = None,
) -> ParametricStudy:
    return ParametricStudy.objects.create(
        project=project,
        name="BC Study",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
        parameter_grid={"n_particles": [100]},
        include_box_counting=True,
        box_counting_params=box_counting_params,
    )


def _make_sim(
    project: Project,
    study: ParametricStudy,
    *,
    metrics: dict | None = None,
) -> Simulation:
    sim = Simulation.objects.create(
        project=project,
        name="sim",
        algorithm="dla",
        parameters={"n_particles": 100},
        seed=42,
        status="completed",
        geometry=_geometry_bytes(),
        metrics=metrics or {},
    )
    study.simulations.add(sim)
    return sim


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _run_url(study: ParametricStudy) -> str:
    return reverse(
        "project-studies-run-box-counting",
        kwargs={"project_pk": study.project_id, "pk": study.id},
    )


class _FakeResult:
    """Stand-in for the pyo3 result of box_counting_agglomerate."""

    def __init__(
        self,
        effective_levels: int,
        dimension: float = 2.5,
        r_squared: float = 0.99,
        std_error: float = 0.01,
    ) -> None:
        self.dimension = dimension
        self.r_squared = r_squared
        self.std_error = std_error
        self.confidence_interval = (dimension - 0.1, dimension + 0.1)
        self.log_scales = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        self.log_values = np.array([6.9, 5.2, 3.4, 1.7, 0.0])
        self.execution_time_ms = 12
        self.linear_region_start = 0
        self.effective_levels = effective_levels


_ELEVEN_KEYS = {
    "dimension",
    "r_squared",
    "std_error",
    "confidence_interval",
    "log_scales",
    "log_values",
    "execution_time_ms",
    "parameters",
    "status",
    "fit_window_used",
    "error_message",
}


@pytest.fixture
def user(db):
    return _make_user()


@pytest.fixture
def project(user):
    return Project.objects.create(name="BC Project", owner=user)


# ── Hand-computed window derivation (design D2) ────────────────────────


class TestDeriveFitWindow:
    """Window derivation from effective_levels, hand-computed (T2)."""

    def test_below_three_levels_derives_no_window(self):
        assert derive_fit_window(0) is None
        assert derive_fit_window(1) is None
        assert derive_fit_window(2) is None

    def test_three_levels_gives_full_window(self):
        assert derive_fit_window(3) == (0, 2)

    def test_four_levels_clamps_start_to_one(self):
        assert derive_fit_window(4) == (1, 3)

    def test_five_levels(self):
        assert derive_fit_window(5) == (1, 4)

    def test_many_levels(self):
        assert derive_fit_window(10) == (1, 9)


# ── R1 — parameter precedence and persistence ──────────────────────────


@pytest.mark.django_db
class TestR1WindowedParameter:
    def test_r1_1_absent_parameter_is_noop(self, user, project):
        """Without windowed (body and study), the run is legacy-only and the
        stored params carry no windowed key."""
        study = _make_study(project)
        sim = _make_sim(project, study)
        client = _authed_client(user)

        response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 200
        sim.refresh_from_db()
        assert "box_counting" in sim.metrics
        assert "box_counting_windowed" not in sim.metrics
        study.refresh_from_db()
        assert study.box_counting_params == {
            "points_per_sphere": 100,
            "precision": 18,
        }

    def test_r1_2_unknown_body_key_rejected_naming_key(self, user, project):
        study = _make_study(project)
        _make_sim(project, study)
        client = _authed_client(user)

        response = client.post(_run_url(study), {"bogus_key": 1}, format="json")

        assert response.status_code == 400
        assert "bogus_key" in str(response.data["error"])

    def test_r1_2_unknown_persisted_key_rejected_by_serializer(self, db):
        """The same rejection enforces the persisted box_counting_params
        shape via ParametricStudySerializer (R1.2)."""
        from apps.simulations.serializers import ParametricStudySerializer

        data = {
            "name": "S",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 100, "target_df": 1.8},
            "parameter_grid": {"n_particles": [100]},
            "seeds_per_combination": 1,
            "box_counting_params": {
                "points_per_sphere": 100,
                "precision": 18,
                "junk": 1,
            },
        }
        serializer = ParametricStudySerializer(data=data)
        assert not serializer.is_valid()
        assert "junk" in str(serializer.errors)

    def test_r1_2_force_accepted_never_persisted(self, user, project):
        """`force` is accepted in the body, drives re-runs, and is NEVER
        persisted to box_counting_params (R1/R2.3)."""
        study = _make_study(project)
        sim = _make_sim(project, study)
        client = _authed_client(user)

        response = client.post(_run_url(study), {"force": True}, format="json")

        assert response.status_code == 200
        study.refresh_from_db()
        sim.refresh_from_db()
        assert "force" not in study.box_counting_params
        assert sim.metrics.get("box_counting") is not None

    def test_r1_3_study_flag_runs_windowed_and_is_preserved(self, user, project):
        """study.windowed=true + body without windowed → dual run for sims
        without a legacy block; stored params retain windowed: true."""
        study = _make_study(
            project,
            box_counting_params={
                "points_per_sphere": 100,
                "precision": 18,
                "windowed": True,
            },
        )
        sim = _make_sim(project, study)
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.side_effect = [_FakeResult(5), _FakeResult(5, dimension=2.7)]
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 200
        sim.refresh_from_db()
        assert sim.metrics["box_counting_windowed"]["status"] == "ok"
        study.refresh_from_db()
        assert study.box_counting_params["windowed"] is True

    def test_r1_3_explicit_false_overrides_and_persists(self, user, project):
        """A body windowed:false overrides the study value for that run AND
        is persisted (explicit values win)."""
        study = _make_study(
            project,
            box_counting_params={
                "points_per_sphere": 100,
                "precision": 18,
                "windowed": True,
            },
        )
        sim = _make_sim(project, study)
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.return_value = _FakeResult(5)
            response = client.post(_run_url(study), {"windowed": False}, format="json")

        assert response.status_code == 200
        sim.refresh_from_db()
        assert "box_counting_windowed" not in sim.metrics
        study.refresh_from_db()
        assert study.box_counting_params["windowed"] is False


# ── R2 — dual-estimator storage ────────────────────────────────────────


@pytest.mark.django_db
class TestR2DualEstimatorStorage:
    def test_r2_1_ok_block_schema_and_window(self, user, project):
        """eff=5 → window (1, 4); block has exactly the 11 keys with
        fit_window_used [1, 4] and error_message None."""
        study = _make_study(project)
        sim = _make_sim(project, study)
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.side_effect = [_FakeResult(5), _FakeResult(5, dimension=2.7)]
            response = client.post(_run_url(study), {"windowed": True}, format="json")

        assert response.status_code == 200
        sim.refresh_from_db()
        block = sim.metrics["box_counting_windowed"]
        assert set(block.keys()) == _ELEVEN_KEYS
        assert block["status"] == "ok"
        assert block["fit_window_used"] == [1, 4]
        assert block["dimension"] == 2.7
        assert block["error_message"] is None
        assert block["parameters"] == {"points_per_sphere": 100, "precision": 18}

    def test_r2_1_legacy_block_bit_identical_with_and_without_windowed(
        self, user, project
    ):
        """The legacy block must be identical whether windowed is on or off
        (real engine, same geometry)."""
        study_a = _make_study(project)
        study_b = _make_study(project)
        sim_a = _make_sim(project, study_a)
        sim_b = _make_sim(project, study_b)
        client = _authed_client(user)

        assert client.post(_run_url(study_a), {}, format="json").status_code == 200
        assert (
            client.post(
                _run_url(study_b), {"windowed": True}, format="json"
            ).status_code
            == 200
        )

        sim_a.refresh_from_db()
        sim_b.refresh_from_db()
        legacy_a = sim_a.metrics["box_counting"]
        legacy_b = sim_b.metrics["box_counting"]
        # execution_time_ms is wall-clock measured per engine invocation and
        # legitimately differs across the two runs; every deterministic field
        # must be bit-identical (R2.1).
        assert legacy_a.pop("execution_time_ms") is not None
        assert legacy_b.pop("execution_time_ms") is not None
        assert legacy_b == legacy_a
        assert "box_counting_windowed" in sim_b.metrics
        assert "box_counting_windowed" not in sim_a.metrics

    def test_r2_2_insufficient_levels_without_calling_estimator(self, user, project):
        """eff=2 → insufficient_levels with nulls; the windowed estimator is
        NEVER called (mock invoked exactly once — the legacy call)."""
        study = _make_study(project)
        sim = _make_sim(project, study)
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.side_effect = [_FakeResult(2)]
            response = client.post(_run_url(study), {"windowed": True}, format="json")

        assert response.status_code == 200
        assert mock_bc.call_count == 1
        sim.refresh_from_db()
        block = sim.metrics["box_counting_windowed"]
        assert set(block.keys()) == _ELEVEN_KEYS
        assert block["status"] == "insufficient_levels"
        assert block["dimension"] is None
        assert block["r_squared"] is None
        assert block["std_error"] is None
        assert block["confidence_interval"] is None
        assert block["log_scales"] is None
        assert block["log_values"] is None
        assert block["fit_window_used"] is None
        assert block["error_message"] is None
        # Legacy block stored normally
        assert "box_counting" in sim.metrics

    def test_r2_2_three_levels_window_zero_two_ok(self, user, project):
        """eff=3 → window (0, 2) → status ok (≡ legacy, archive Log L4)."""
        study = _make_study(project)
        sim = _make_sim(project, study)
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.side_effect = [_FakeResult(3), _FakeResult(3, dimension=2.1)]
            response = client.post(_run_url(study), {"windowed": True}, format="json")

        assert response.status_code == 200
        sim.refresh_from_db()
        block = sim.metrics["box_counting_windowed"]
        assert block["status"] == "ok"
        assert block["fit_window_used"] == [0, 2]

    def test_r2_2_windowed_error_never_aborts_run(self, user, project):
        """A windowed-side failure stores status error with the message and
        never aborts the run (R2/D4)."""
        study = _make_study(project)
        sim = _make_sim(project, study)
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.side_effect = [
                _FakeResult(5),
                ValueError("pyo3 window out of range"),
            ]
            response = client.post(_run_url(study), {"windowed": True}, format="json")

        assert response.status_code == 200
        assert response.data["results"]["failed"] == 0
        sim.refresh_from_db()
        block = sim.metrics["box_counting_windowed"]
        assert block["status"] == "error"
        assert "pyo3 window out of range" in block["error_message"]
        assert block["dimension"] is None
        assert block["fit_window_used"] is None
        assert "box_counting" in sim.metrics

    def test_r2_3_existing_legacy_block_skipped_without_force(self, user, project):
        study = _make_study(project)
        existing = {
            "dimension": 1.9,
            "r_squared": 0.98,
            "std_error": 0.02,
            "confidence_interval": [1.8, 2.0],
            "log_scales": [1.0],
            "log_values": [2.0],
            "execution_time_ms": 5,
            "parameters": {"points_per_sphere": 100, "precision": 18},
        }
        sim = _make_sim(project, study, metrics={"box_counting": existing})
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            response = client.post(_run_url(study), {"windowed": True}, format="json")

        assert response.status_code == 200
        assert response.data["results"]["skipped"] == 1
        assert response.data["results"]["processed"] == 0
        mock_bc.assert_not_called()
        sim.refresh_from_db()
        assert sim.metrics["box_counting"] == existing
        assert "box_counting_windowed" not in sim.metrics

    def test_r2_3_force_recomputes_both_blocks(self, user, project):
        study = _make_study(project)
        sim = _make_sim(
            project,
            study,
            metrics={"box_counting": {"dimension": 1.9, "status": "old"}},
        )
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.side_effect = [_FakeResult(5), _FakeResult(5, dimension=2.7)]
            response = client.post(
                _run_url(study), {"windowed": True, "force": True}, format="json"
            )

        assert response.status_code == 200
        assert response.data["results"]["processed"] == 1
        assert response.data["results"]["skipped"] == 0
        sim.refresh_from_db()
        assert sim.metrics["box_counting"]["dimension"] == 2.5
        assert sim.metrics["box_counting_windowed"]["dimension"] == 2.7


# ── JD-A-004 — forced legacy-only re-run drops the stale windowed block ─


class TestForcedLegacyOnlyRemovesStaleWindowedBlock:
    """F6a (JD-A-004): windowed=false + force re-runs the legacy estimator
    and must REMOVE the stale ``box_counting_windowed`` block computed under
    earlier parameters / an earlier windowed flag — never leave it behind."""

    def test_force_without_windowed_removes_stale_block(self, user, project):
        study = _make_study(project)
        stale_windowed = {
            "dimension": 9.9,
            "r_squared": 0.5,
            "std_error": 9.9,
            "confidence_interval": [9.0, 10.0],
            "log_scales": [1.0],
            "log_values": [2.0],
            "execution_time_ms": 1,
            "parameters": {"points_per_sphere": 42, "precision": 9},
            "status": "ok",
            "fit_window_used": [0, 0],
            "error_message": None,
        }
        sim = _make_sim(
            project,
            study,
            metrics={
                "box_counting": {"dimension": 1.9, "status": "old"},
                "box_counting_windowed": stale_windowed,
            },
        )
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.side_effect = [_FakeResult(5)]
            response = client.post(_run_url(study), {"force": True}, format="json")

        assert response.status_code == 200
        assert response.data["results"]["processed"] == 1
        sim.refresh_from_db()
        # Legacy block recomputed...
        assert sim.metrics["box_counting"]["dimension"] == 2.5
        # ...and the stale windowed block is GONE (not stale-marked)
        assert "box_counting_windowed" not in sim.metrics

    def test_windowed_run_keeps_its_own_block(self, user, project):
        """Guard against over-removal: a windowed run still stores the block."""
        study = _make_study(project)
        sim = _make_sim(
            project,
            study,
            metrics={"box_counting": {"dimension": 1.9, "status": "old"}},
        )
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.side_effect = [_FakeResult(5), _FakeResult(5, dimension=2.7)]
            response = client.post(
                _run_url(study), {"windowed": True, "force": True}, format="json"
            )

        assert response.status_code == 200
        sim.refresh_from_db()
        assert sim.metrics["box_counting_windowed"]["status"] == "ok"


# ── JD-B-007 — non-dict box_counting_params → 400, never 500 ───────────


class TestNonDictParamsRejected:
    """F6f (JD-B-007): the JSONField accepts any JSON, so a non-dict
    box_counting_params (e.g. 42) must be rejected with a 400 by the shared
    validator — at the study serializer AND the run-box-counting body."""

    def test_validator_rejects_non_dict(self):
        from rest_framework.exceptions import ValidationError

        from apps.simulations.serializers import (
            validate_box_counting_params_dict,
        )

        for bad in (42, "nope", ["list"], True, 3.14):
            with pytest.raises(ValidationError):
                validate_box_counting_params_dict(bad)

    def test_patch_with_non_dict_params_returns_400(self, user, project):
        study = _make_study(project)
        client = _authed_client(user)

        response = client.patch(
            reverse(
                "project-studies-detail",
                kwargs={"project_pk": project.id, "pk": study.id},
            ),
            {"box_counting_params": 42},
            format="json",
        )

        assert response.status_code == 400

    def test_run_body_with_non_dict_params_returns_400(self, user, project):
        study = _make_study(project)
        _make_sim(project, study)
        client = _authed_client(user)

        response = client.post(_run_url(study), {"windowed": 42}, format="json")

        assert response.status_code == 400
