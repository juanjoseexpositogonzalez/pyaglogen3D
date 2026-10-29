"""Tests for migration 0007 — sanitize legacy box_counting_params (F5).

R1.2 turned unknown keys into a 400, which 400s every PATCH that
round-trips a pre-change study's stored box_counting_params. The data
migration keeps only the known persisted keys; this test drives the
migration's forward function directly against a pre-migration row with
junk keys and asserts the API PATCH works afterwards.
"""

from __future__ import annotations

import importlib
from typing import Any

import pytest
from django.apps import apps as django_apps
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy

_MIGRATION = importlib.import_module(
    "apps.simulations.migrations.0007_sanitize_box_counting_params"
)


def _make_user() -> User:
    import uuid

    return User.objects.create_user(
        email=f"bc-mig-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


@pytest.mark.django_db
def test_migration_drops_junk_keys_and_patch_then_works() -> None:
    user = _make_user()
    project = Project.objects.create(name="BC Migration Project", owner=user)

    # Pre-migration row: stored params carry legacy extra keys (bypassing
    # the serializer, exactly as pre-change writes did).
    pre_migration_params: dict[str, Any] = {
        "points_per_sphere": 100,
        "precision": 18,
        "windowed": False,
        "legacy_extra": "junk",
        "another_legacy": 42,
    }
    study = ParametricStudy.objects.create(
        project=project,
        name="BC Migration Study",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 100},
        parameter_grid={"n_particles": [100]},
        include_box_counting=True,
        box_counting_params=pre_migration_params,
    )

    # Drive the migration's forward function directly (schema_editor unused).
    _MIGRATION.sanitize_box_counting_params(django_apps, None)

    study.refresh_from_db()
    assert study.box_counting_params == {
        "points_per_sphere": 100,
        "precision": 18,
        "windowed": False,
    }

    # The round-trip PATCH that used to 400 on unknown keys now works.
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.patch(
        reverse(
            "project-studies-detail",
            kwargs={"project_pk": project.id, "pk": study.id},
        ),
        {"box_counting_params": study.box_counting_params},
        format="json",
    )
    assert response.status_code == 200, response.data


@pytest.mark.django_db
def test_migration_keeps_clean_rows_untouched() -> None:
    user = _make_user()
    project = Project.objects.create(name="BC Migration Project 2", owner=user)
    clean = {"points_per_sphere": 200, "precision": 12, "windowed": True}
    study = ParametricStudy.objects.create(
        project=project,
        name="Clean Study",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 100},
        parameter_grid={"n_particles": [100]},
        box_counting_params=dict(clean),
    )

    _MIGRATION.sanitize_box_counting_params(django_apps, None)

    study.refresh_from_db()
    assert study.box_counting_params == clean


@pytest.mark.django_db
def test_migration_leaves_null_params_alone() -> None:
    user = _make_user()
    project = Project.objects.create(name="BC Migration Project 3", owner=user)
    study = ParametricStudy.objects.create(
        project=project,
        name="Null Params Study",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 100},
        parameter_grid={"n_particles": [100]},
        box_counting_params=None,
    )

    _MIGRATION.sanitize_box_counting_params(django_apps, None)

    study.refresh_from_db()
    assert study.box_counting_params is None
