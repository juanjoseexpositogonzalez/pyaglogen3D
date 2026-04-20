"""Tests for ``SimulationSerializer`` — parameter schema stamping.

These tests lock in the contract established by the verify-rg change:

- Every newly created simulation MUST persist
  ``parameters_schema_version == "v2"``.
- New writes MUST use ``primary_particle_diameter_nm`` and MUST NOT persist
  ``primary_particle_radius_nm``.
- Legacy payloads that arrive at the API carrying
  ``primary_particle_radius_nm`` MUST be transparently upgraded to the v2
  diameter key (``radius × 2``) before persistence.
"""

from __future__ import annotations

import pytest

from apps.projects.models import Project
from apps.simulations.serializers import SimulationSerializer
from apps.simulations.services.params import (
    PARAM_KEY_DIAMETER,
    PARAM_KEY_RADIUS_LEGACY,
    PARAM_KEY_SCHEMA_VERSION,
    SCHEMA_VERSION_CURRENT,
)


@pytest.fixture
def project(db) -> Project:
    """Minimal project; the simulation FK is required on save."""
    return Project.objects.create(name="T6 Test Project")


def _save(project: Project, parameters: dict) -> dict:
    """Create a simulation via the serializer and return its persisted params."""
    serializer = SimulationSerializer(
        data={
            "algorithm": "dla",
            "parameters": parameters,
            "seed": 42,
        }
    )
    serializer.is_valid(raise_exception=True)
    simulation = serializer.save(project=project)
    return simulation.parameters


def test_create_stamps_schema_version_v2(project: Project) -> None:
    """A fresh create persists ``parameters_schema_version == "v2"``."""
    persisted = _save(
        project,
        {
            "n_particles": 100,
            "sticking_probability": 1.0,
            PARAM_KEY_DIAMETER: 50.0,
        },
    )
    assert persisted[PARAM_KEY_SCHEMA_VERSION] == SCHEMA_VERSION_CURRENT
    assert persisted[PARAM_KEY_SCHEMA_VERSION] == "v2"


def test_create_persists_diameter_key_only(project: Project) -> None:
    """New writes carry the v2 diameter key and never the legacy radius key."""
    persisted = _save(
        project,
        {
            "n_particles": 100,
            "sticking_probability": 1.0,
            PARAM_KEY_DIAMETER: 60.0,
        },
    )
    assert persisted[PARAM_KEY_DIAMETER] == 60.0
    assert PARAM_KEY_RADIUS_LEGACY not in persisted


def test_create_upgrades_legacy_radius_payload(project: Project) -> None:
    """Legacy clients sending radius get transparently upgraded to diameter × 2."""
    persisted = _save(
        project,
        {
            "n_particles": 100,
            "sticking_probability": 1.0,
            PARAM_KEY_RADIUS_LEGACY: 25.0,  # legacy payload
        },
    )
    assert persisted[PARAM_KEY_DIAMETER] == 50.0
    assert PARAM_KEY_RADIUS_LEGACY not in persisted
    assert persisted[PARAM_KEY_SCHEMA_VERSION] == "v2"


def test_create_drops_legacy_key_when_both_present(project: Project) -> None:
    """If both keys arrive, v2 wins and the legacy key is dropped."""
    persisted = _save(
        project,
        {
            "n_particles": 100,
            "sticking_probability": 1.0,
            PARAM_KEY_DIAMETER: 80.0,
            PARAM_KEY_RADIUS_LEGACY: 25.0,  # ignored / dropped
        },
    )
    assert persisted[PARAM_KEY_DIAMETER] == 80.0
    assert PARAM_KEY_RADIUS_LEGACY not in persisted


def test_create_without_particle_size_still_stamps_version(project: Project) -> None:
    """A payload that omits both keys is still stamped v2 (no raise)."""
    persisted = _save(
        project,
        {
            "n_particles": 100,
            "sticking_probability": 1.0,
        },
    )
    assert persisted[PARAM_KEY_SCHEMA_VERSION] == "v2"
    assert PARAM_KEY_RADIUS_LEGACY not in persisted


def test_create_ignores_non_positive_legacy_radius(project: Project) -> None:
    """A zero or negative legacy radius is NOT converted; no diameter written."""
    persisted = _save(
        project,
        {
            "n_particles": 100,
            "sticking_probability": 1.0,
            PARAM_KEY_RADIUS_LEGACY: 0,
        },
    )
    assert persisted[PARAM_KEY_SCHEMA_VERSION] == "v2"
    assert PARAM_KEY_RADIUS_LEGACY not in persisted
    assert PARAM_KEY_DIAMETER not in persisted
