"""Tests for grid expansion logic in ParametricStudyViewSet.perform_create.

Covers spec requirements:
- R4.3, R17.6: seed_type from grid → Simulation.seed_type model field (BUG #634 FIX)
- R17.7: seed_type from base_parameters → Simulation.seed_type model field
- R3.3: sintering grid entry overrides study-level
- R3.4: sintering fallback to study-level config
- R1.5: distribution configs pass through as-is
- R5.1-R5.2: cartesian product correct count
- R5.3: child sim params match grid combo values
- R5.4-R5.5: integration POST → child sims created correctly
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation, SimulationStatus

User = get_user_model()


@pytest.fixture
def user(db) -> User:
    return User.objects.create_user(
        email=f"grid-{uuid.uuid4()}@example.com",
        password="testpass123",
    )


@pytest.fixture
def project(user) -> Project:
    return Project.objects.create(name="Grid Expansion Test Project", owner=user)


@pytest.fixture
def api_client(user) -> APIClient:
    """Authenticated API client."""
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture(autouse=True)
def _mock_celery_task():
    """Mock run_simulation_task globally for all tests in this module."""
    mock_result = MagicMock(id="fake-celery-task-id")
    with patch(
        "apps.simulations.views.run_simulation_task"
    ) as mock_task:
        mock_task.delay.return_value = mock_result
        yield mock_task


# ---------------------------------------------------------------------------
# T3.2 — Cartesian product over mixed keys → correct sim count (R5.1-R5.2)
# ---------------------------------------------------------------------------


class TestCartesianProductExpansion:
    """Grid expansion uses itertools.product with deterministic key order."""

    def test_correct_sim_count_with_mixed_keys(
        self, api_client, project
    ) -> None:
        """R5.1-R5.2: cartesian product of 2×3=6 combos × 1 seed = 6 sims."""
        resp = api_client.post(
            f"/api/v1/projects/{project.id}/studies/",
            data={
                "name": "Count Test",
                "base_algorithm": "tunable_cc",
                "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "parameter_grid": {
                    "n_particles": [100, 200],
                    "seed_type": ["monomers", "dimers", "trimers"],
                },
                "seeds_per_combination": 1,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        study = ParametricStudy.objects.get(id=resp.data["id"])
        assert study.simulations.count() == 6  # 2 × 3

    def test_correct_sim_count_with_seeds(
        self, api_client, project
    ) -> None:
        """R5.2: 2 combos × 3 seeds = 6 sims."""
        resp = api_client.post(
            f"/api/v1/projects/{project.id}/studies/",
            data={
                "name": "Seeds Test",
                "base_algorithm": "tunable_cc",
                "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "parameter_grid": {
                    "n_particles": [100, 200],
                },
                "seeds_per_combination": 3,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        study = ParametricStudy.objects.get(id=resp.data["id"])
        assert study.simulations.count() == 6  # 2 × 3


# ---------------------------------------------------------------------------
# T3.3 — Child sim params match grid combo values (R5.3)
# ---------------------------------------------------------------------------


class TestChildSimParams:
    """Child simulation parameters reflect the grid combo values."""

    def test_params_match_grid_combo(
        self, api_client, project
    ) -> None:
        """R5.3: child sim params include grid values."""
        resp = api_client.post(
            f"/api/v1/projects/{project.id}/studies/",
            data={
                "name": "Params Match",
                "base_algorithm": "tunable_cc",
                "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "parameter_grid": {"n_particles": [100, 500]},
                "seeds_per_combination": 1,
            },
            format="json",
        )
        assert resp.status_code == 201
        study = ParametricStudy.objects.get(id=resp.data["id"])
        sims = list(study.simulations.order_by("name"))
        n_vals = sorted([s.parameters["n_particles"] for s in sims])
        assert n_vals == [100, 500]


# ---------------------------------------------------------------------------
# T3.4 — seed_type from grid sets model field (BUG #634 FIX: R4.3, R17.6)
# ---------------------------------------------------------------------------


class TestSeedTypeBugFix:
    """Bug #634: create_simulation must pop seed_type → model kwarg."""

    def test_seed_type_from_grid_sets_model_field(
        self, api_client, project
    ) -> None:
        """R4.3 / R17.6: seed_type from grid entry → Simulation.seed_type."""
        resp = api_client.post(
            f"/api/v1/projects/{project.id}/studies/",
            data={
                "name": "SeedType Grid Fix",
                "base_algorithm": "tunable_cc",
                "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "parameter_grid": {
                    "seed_type": ["dimers", "trimers"],
                },
                "seeds_per_combination": 1,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        study = ParametricStudy.objects.get(id=resp.data["id"])
        sims = list(study.simulations.all())
        seed_types = sorted([s.seed_type for s in sims])
        assert seed_types == ["dimers", "trimers"]
        # seed_type must NOT be in parameters JSON
        for sim in sims:
            assert "seed_type" not in sim.parameters

    def test_seed_type_from_base_params_sets_model_field(
        self, api_client, project
    ) -> None:
        """R17.7: seed_type in base_parameters → model field, not in params."""
        resp = api_client.post(
            f"/api/v1/projects/{project.id}/studies/",
            data={
                "name": "SeedType Base Fix",
                "base_algorithm": "tunable_cc",
                "base_parameters": {
                    "n_particles": 100,
                    "target_df": 1.8,
                    "target_kf": 1.3,
                    "seed_type": "trimers",
                },
                "parameter_grid": {"n_particles": [100, 200]},
                "seeds_per_combination": 1,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        study = ParametricStudy.objects.get(id=resp.data["id"])
        sims = list(study.simulations.all())
        for sim in sims:
            assert sim.seed_type == "trimers"
            assert "seed_type" not in sim.parameters


# ---------------------------------------------------------------------------
# T3.6-T3.7 — Sintering grid override + fallback (R3.3-R3.4)
# ---------------------------------------------------------------------------


class TestSinteringGridOverride:
    """Sintering config: grid-level overrides study-level per combo."""

    def test_sintering_grid_overrides_study_level(
        self, api_client, project
    ) -> None:
        """R3.3: when sintering_config in grid, override study sintering."""
        resp = api_client.post(
            f"/api/v1/projects/{project.id}/studies/",
            data={
                "name": "Sintering Override",
                "base_algorithm": "tunable_cc",
                "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "parameter_grid": {
                    "sintering_config": [
                        {"distribution_type": "fixed", "coefficient": 0.85},
                    ],
                },
                "sintering_config": {"distribution_type": "fixed", "coefficient": 0.95},
                "seeds_per_combination": 1,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        study = ParametricStudy.objects.get(id=resp.data["id"])
        sim = study.simulations.first()
        # Grid entry (fixed 0.85) should be used, not study-level (0.95)
        assert sim.parameters.get("sintering_coeff") == 0.85

    def test_sintering_fallback_to_study_level(
        self, api_client, project
    ) -> None:
        """R3.4: when no sintering_config in grid, study-level is applied."""
        resp = api_client.post(
            f"/api/v1/projects/{project.id}/studies/",
            data={
                "name": "Sintering Fallback",
                "base_algorithm": "tunable_cc",
                "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "parameter_grid": {"n_particles": [100]},
                "sintering_config": {"distribution_type": "fixed", "coefficient": 0.95},
                "seeds_per_combination": 1,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        study = ParametricStudy.objects.get(id=resp.data["id"])
        sim = study.simulations.first()
        assert sim.parameters.get("sintering_coeff") == 0.95


# ---------------------------------------------------------------------------
# T3.8 — Distribution configs pass through as-is (R1.5)
# ---------------------------------------------------------------------------


class TestDistributionPassthrough:
    """Distribution configs are stored in child sim params for engine sampling."""

    def test_kf_distribution_passes_through(
        self, api_client, project
    ) -> None:
        """R1.5: kf_distribution config stored in child sim params as-is."""
        kf_config = {"distribution_type": "normal", "mean": 1.3, "std": 0.1}
        resp = api_client.post(
            f"/api/v1/projects/{project.id}/studies/",
            data={
                "name": "KF Passthrough",
                "base_algorithm": "tunable_cc",
                "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "parameter_grid": {
                    "kf_distribution": [kf_config],
                },
                "seeds_per_combination": 1,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        study = ParametricStudy.objects.get(id=resp.data["id"])
        sim = study.simulations.first()
        assert sim.parameters.get("kf_distribution") == kf_config

    def test_particle_radius_config_passes_through(
        self, api_client, project
    ) -> None:
        """Particle radius config stored in child sim params."""
        radius_config = {"distribution_type": "normal", "mean": 50.0, "std": 10.0}
        resp = api_client.post(
            f"/api/v1/projects/{project.id}/studies/",
            data={
                "name": "Radius Passthrough",
                "base_algorithm": "tunable_cc",
                "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "parameter_grid": {
                    "particle_radius_config": [radius_config],
                },
                "seeds_per_combination": 1,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        study = ParametricStudy.objects.get(id=resp.data["id"])
        sim = study.simulations.first()
        assert sim.parameters.get("particle_radius_config") == radius_config


# ---------------------------------------------------------------------------
# T3.9 — Integration: full POST with all 4 keys (R5.4-R5.5)
# ---------------------------------------------------------------------------


class TestFullIntegration:
    """Full POST with all new grid keys → child sims correct."""

    def test_all_four_keys_expand_correctly(
        self, api_client, project
    ) -> None:
        """R5.4-R5.5: all 4 new grid keys in one study."""
        kf1 = {"distribution_type": "fixed", "value": 1.3}
        kf2 = {"distribution_type": "normal", "mean": 1.5, "std": 0.1}
        sint1 = {"distribution_type": "fixed", "coefficient": 0.9}
        rad1 = {"distribution_type": "normal", "mean": 50.0, "std": 5.0}

        resp = api_client.post(
            f"/api/v1/projects/{project.id}/studies/",
            data={
                "name": "Full Integration",
                "base_algorithm": "tunable_cc",
                "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "parameter_grid": {
                    "kf_distribution": [kf1, kf2],
                    "particle_radius_config": [rad1],
                    "seed_type": ["monomers", "dimers"],
                    "sintering_config": [sint1],
                },
                "seeds_per_combination": 1,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        study = ParametricStudy.objects.get(id=resp.data["id"])
        # 2 × 1 × 2 × 1 = 4 sims
        assert study.simulations.count() == 4

        sims = list(study.simulations.all())
        seed_types = sorted([s.seed_type for s in sims])
        # 2 monomers, 2 dimers (2 kf × 1 radius × 1 sintering for each seed_type)
        assert seed_types == ["dimers", "dimers", "monomers", "monomers"]

        for sim in sims:
            # seed_type must NOT be in params
            assert "seed_type" not in sim.parameters
            # kf_distribution must be in params
            assert "kf_distribution" in sim.parameters
            # particle_radius_config must be in params
            assert "particle_radius_config" in sim.parameters
            # sintering_config from grid → applied (fixed, value 0.9)
            assert sim.parameters.get("sintering_coeff") == 0.9
