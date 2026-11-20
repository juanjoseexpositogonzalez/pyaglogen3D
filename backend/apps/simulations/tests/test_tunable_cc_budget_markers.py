"""Contract witnesses for budget-exhausted Tunable CC results."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest

from apps.accounts.models import User
from apps.ai_assistant.models import Notification
from apps.projects.models import Project
from apps.simulations.models import Simulation, SimulationStatus
from apps.simulations.tasks import run_simulation_task


@pytest.fixture
def project(db: Any) -> Project:
    owner = User.objects.create_user(
        email="budget-marker@example.com", password="irrelevant"
    )
    return Project.objects.create(name="Budget marker project", owner=owner)


def _budget_exhausted_result() -> SimpleNamespace:
    return SimpleNamespace(
        coordinates=np.array([[0.0, 0.0, 0.0]]),
        radii=np.array([1.0]),
        fractal_dimension=1.8,
        fractal_dimension_std=0.05,
        prefactor=1.3,
        radius_of_gyration=1.0,
        porosity=0.5,
        coordination_mean=2.0,
        coordination_std=0.0,
        rg_evolution=np.array([], dtype=np.float64),
        rg_evolution_n=np.array([], dtype=np.int64),
        anisotropy=1.0,
        asphericity=0.0,
        acylindricity=0.0,
        principal_moments=np.array([1.0, 1.0, 1.0]),
        principal_axes=np.eye(3),
        execution_time_ms=7,
        merge_trace=[],
        budget_exhausted=True,
        operations_used=123,
    )


@pytest.mark.django_db
def test_budget_exhaustion_is_persisted_returned_and_notified_as_partial(project: Project) -> None:
    simulation = Simulation.objects.create(
        project=project,
        name="Bounded Tunable CC",
        algorithm="tunable_cc",
        parameters={"n_particles": 10, "target_df": 1.8, "target_kf": 1.3},
        seed=42,
    )

    with (
        patch("aglogen_core.run_tunable_cc", return_value=_budget_exhausted_result()),
        patch("aglogen_core.version", return_value="0.0.0-test"),
        patch("apps.simulations.tasks.run_box_counting_if_configured", return_value=None),
    ):
        response = run_simulation_task(str(simulation.id))

    simulation.refresh_from_db()
    notification = Notification.objects.get(user=project.owner)
    assert simulation.status == SimulationStatus.COMPLETED
    metrics = simulation.metrics
    assert isinstance(metrics, dict)
    assert metrics["budget_exhausted"] is True
    assert metrics["operations_used"] == 123
    assert response["budget_exhausted"] is True
    assert response["operations_used"] == 123
    assert notification.notification_type == Notification.NotificationType.INFO
    assert "partial" in notification.title.lower()
    assert "budget" in notification.message.lower()
