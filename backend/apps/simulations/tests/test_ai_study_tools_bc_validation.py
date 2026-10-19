"""Tests for the AI-assistant study tool's box_counting_params handling
(F6b — JD-A-006): the tool must route through the shared R1.2 validator so
a bad tool call cannot persist junk (or a non-dict) straight to the ORM.
"""

from __future__ import annotations

import pytest

from apps.ai_assistant.tools.study_tools import (
    create_parametric_study_handler,
)
from apps.simulations.models import ParametricStudy

# The handler imports the project model lazily-ish at call time; the
# validation happens BEFORE any database write, so these tests need no
# Celery dispatch (an invalid call must never reach study creation).


@pytest.mark.django_db
def test_unknown_key_in_box_counting_params_rejected_before_creation(db):
    """JD-A-006: an unknown key raises ValueError naming the key, and no
    study row is created (validation precedes the ORM write)."""
    with pytest.raises(ValueError) as exc_info:
        create_parametric_study_handler.handler(
            name="Junk params study",
            algorithm="dla",
            base_parameters={"n_particles": 100},
            parameter_grid={"n_particles": [100]},
            project_id="00000000-0000-0000-0000-000000000001",
            box_counting_params={"points_per_sphere": 100, "junk": 1},
        )

    assert "junk" in str(exc_info.value)
    assert not ParametricStudy.objects.filter(name="Junk params study").exists()


@pytest.mark.django_db
def test_non_dict_box_counting_params_rejected(db):
    """JD-B-007 interplay: a non-dict value is rejected, not persisted."""
    with pytest.raises(ValueError):
        create_parametric_study_handler.handler(
            name="Non-dict params study",
            algorithm="dla",
            base_parameters={"n_particles": 100},
            parameter_grid={"n_particles": [100]},
            project_id="00000000-0000-0000-0000-000000000002",
            box_counting_params=42,
        )

    assert not ParametricStudy.objects.filter(name="Non-dict params study").exists()


@pytest.mark.django_db
def test_out_of_range_points_per_sphere_rejected(db):
    with pytest.raises(ValueError):
        create_parametric_study_handler.handler(
            name="Range study",
            algorithm="dla",
            base_parameters={"n_particles": 100},
            parameter_grid={"n_particles": [100]},
            project_id="00000000-0000-0000-0000-000000000003",
            box_counting_params={"points_per_sphere": 5000},
        )

    assert not ParametricStudy.objects.filter(name="Range study").exists()


@pytest.mark.django_db
def test_valid_box_counting_params_pass_validation_and_persist(db):
    """Guard: a valid dict flows through to ORM creation (the study creation
    then fails on the unknown project — proving validation passed)."""
    with pytest.raises(ValueError) as exc_info:
        create_parametric_study_handler.handler(
            name="Valid params study",
            algorithm="dla",
            base_parameters={"n_particles": 100},
            parameter_grid={"n_particles": [100]},
            project_id="00000000-0000-0000-0000-000000000004",
            box_counting_params={"points_per_sphere": 100, "windowed": True},
        )

    # Validation passed; the failure is the missing project, NOT the params.
    assert "not found" in str(exc_info.value)
    assert "junk" not in str(exc_info.value)
