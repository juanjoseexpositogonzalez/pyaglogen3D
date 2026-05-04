"""Tests for ``seed_type``: model (T4.1), serializer (T4.2+T4.3), task wiring (T4.4).

Covers:
- Model field exists with correct choices and default
- Migration creates the field
- Existing simulations default to 'monomers'
- Serializer accepts seed_type, validates choices, defaults to 'monomers'
- Task runner passes seed_type to engine binding
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from apps.projects.models import Project
from apps.simulations.models import Simulation
from apps.simulations.serializers import SimulationSerializer
from apps.simulations.tasks import run_simulation_task


SEED_TYPE_CHOICES = ["monomers", "dimers", "trimers"]


@pytest.fixture
def project(db) -> Project:
    return Project.objects.create(name="Seed Type Test Project")


class TestSeedTypeModelField:
    """T4.1 — seed_type CharField on Simulation."""

    def test_field_exists_on_model(self, project: Project) -> None:
        """Simulation model has a seed_type field."""
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 100},
            seed=42,
        )
        assert hasattr(sim, "seed_type")

    def test_default_is_monomers(self, project: Project) -> None:
        """When seed_type is not provided, default is 'monomers'."""
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 100},
            seed=42,
        )
        assert sim.seed_type == "monomers"

    def test_accepts_dimers(self, project: Project) -> None:
        """seed_type='dimers' is accepted and persisted."""
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 100},
            seed=42,
            seed_type="dimers",
        )
        sim.refresh_from_db()
        assert sim.seed_type == "dimers"

    def test_accepts_trimers(self, project: Project) -> None:
        """seed_type='trimers' is accepted and persisted."""
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 100},
            seed=42,
            seed_type="trimers",
        )
        sim.refresh_from_db()
        assert sim.seed_type == "trimers"

    def test_field_choices_match_spec(self) -> None:
        """The field's choices contain exactly monomers/dimers/trimers."""
        field = Simulation._meta.get_field("seed_type")
        choice_values = [c[0] for c in field.choices]
        assert sorted(choice_values) == sorted(SEED_TYPE_CHOICES)

    def test_field_max_length(self) -> None:
        """max_length is 16 as specified."""
        field = Simulation._meta.get_field("seed_type")
        assert field.max_length == 16


class TestSeedTypeSerializer:
    """T4.2+T4.3 — SimulationSerializer accepts and validates seed_type."""

    def test_serializer_accepts_dimers(self, project: Project) -> None:
        """POST with seed_type='dimers' succeeds and persists the value."""
        serializer = SimulationSerializer(
            data={
                "algorithm": "tunable_cc",
                "parameters": {"n_particles": 100},
                "seed": 42,
                "seed_type": "dimers",
            }
        )
        assert serializer.is_valid(), serializer.errors
        sim = serializer.save(project=project)
        assert sim.seed_type == "dimers"

    def test_serializer_accepts_trimers(self, project: Project) -> None:
        """POST with seed_type='trimers' succeeds."""
        serializer = SimulationSerializer(
            data={
                "algorithm": "tunable_cc",
                "parameters": {"n_particles": 100},
                "seed": 42,
                "seed_type": "trimers",
            }
        )
        assert serializer.is_valid(), serializer.errors
        sim = serializer.save(project=project)
        assert sim.seed_type == "trimers"

    def test_serializer_defaults_to_monomers_when_omitted(
        self, project: Project
    ) -> None:
        """When seed_type is not in the payload, default is 'monomers' (R6)."""
        serializer = SimulationSerializer(
            data={
                "algorithm": "tunable_cc",
                "parameters": {"n_particles": 100},
                "seed": 42,
            }
        )
        assert serializer.is_valid(), serializer.errors
        sim = serializer.save(project=project)
        assert sim.seed_type == "monomers"

    def test_serializer_rejects_invalid_seed_type(self) -> None:
        """An invalid seed_type value is rejected with a validation error."""
        serializer = SimulationSerializer(
            data={
                "algorithm": "tunable_cc",
                "parameters": {"n_particles": 100},
                "seed": 42,
                "seed_type": "quadrimers",
            }
        )
        assert not serializer.is_valid()
        assert "seed_type" in serializer.errors

    def test_serializer_includes_seed_type_in_output(self, project: Project) -> None:
        """seed_type appears in the serialized response payload."""
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 100},
            seed=42,
            seed_type="dimers",
        )
        serializer = SimulationSerializer(sim)
        assert "seed_type" in serializer.data
        assert serializer.data["seed_type"] == "dimers"


def _fake_engine_result() -> SimpleNamespace:
    """Minimal stand-in for ``aglogen_core.run_tunable_cc`` return value."""
    coordinates = np.zeros((2, 3), dtype=np.float64)
    radii = np.ones(2, dtype=np.float64)
    return SimpleNamespace(
        coordinates=coordinates,
        radii=radii,
        fractal_dimension=1.8,
        fractal_dimension_std=0.0,
        prefactor=1.0,
        radius_of_gyration=1.0,
        porosity=0.5,
        coordination_mean=2.0,
        coordination_std=0.0,
        rg_evolution=np.array([], dtype=np.float64),
        anisotropy=1.0,
        asphericity=0.0,
        acylindricity=0.0,
        principal_moments=np.array([1.0, 1.0, 1.0]),
        principal_axes=np.eye(3),
        execution_time_ms=1,
    )


@pytest.fixture(autouse=False)
def _silence_side_effects():
    """Stub post-run side-effects not relevant to seed_type wiring."""
    with (
        patch("apps.simulations.tasks.create_simulation_notification"),
        patch(
            "apps.simulations.tasks.run_box_counting_if_configured",
            return_value=None,
        ),
    ):
        yield


class TestSeedTypeTaskWiring:
    """T4.4 — tasks.py passes seed_type to the engine binding."""

    @pytest.mark.usefixtures("_silence_side_effects")
    @patch("aglogen_core.run_tunable_cc")
    def test_task_passes_seed_type_dimers(self, mock_run_cc, project: Project) -> None:
        """seed_type='dimers' on the Simulation flows to the engine call."""
        mock_run_cc.return_value = _fake_engine_result()
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 100},
            seed=42,
            seed_type="dimers",
        )
        run_simulation_task(str(sim.id))
        assert mock_run_cc.called
        _, kwargs = mock_run_cc.call_args
        assert kwargs["seed_type"] == "dimers"

    @pytest.mark.usefixtures("_silence_side_effects")
    @patch("aglogen_core.run_tunable_cc")
    def test_task_passes_seed_type_monomers_by_default(
        self, mock_run_cc, project: Project
    ) -> None:
        """When seed_type not set, 'monomers' (model default) is forwarded."""
        mock_run_cc.return_value = _fake_engine_result()
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 100},
            seed=42,
        )
        run_simulation_task(str(sim.id))
        assert mock_run_cc.called
        _, kwargs = mock_run_cc.call_args
        assert kwargs["seed_type"] == "monomers"

    @pytest.mark.usefixtures("_silence_side_effects")
    @patch("aglogen_core.run_tunable_cc")
    def test_task_passes_seed_type_trimers(self, mock_run_cc, project: Project) -> None:
        """seed_type='trimers' round-trips through the task."""
        mock_run_cc.return_value = _fake_engine_result()
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 100},
            seed=42,
            seed_type="trimers",
        )
        run_simulation_task(str(sim.id))
        assert mock_run_cc.called
        _, kwargs = mock_run_cc.call_args
        assert kwargs["seed_type"] == "trimers"
