"""Tests for ``seed_type`` field: model (T4.1), serializer (T4.2+T4.3).

Covers:
- Model field exists with correct choices and default
- Migration creates the field
- Existing simulations default to 'monomers'
- Serializer accepts seed_type, validates choices, defaults to 'monomers'
"""

from __future__ import annotations

import pytest

from apps.projects.models import Project
from apps.simulations.models import Simulation
from apps.simulations.serializers import SimulationSerializer


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
