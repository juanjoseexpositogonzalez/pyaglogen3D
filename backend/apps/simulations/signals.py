"""Signals for the simulations app."""

from __future__ import annotations

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Simulation
from .study_status import settle_study_for


@receiver(post_save, sender=Simulation)
def settle_the_study_when_its_last_child_finishes(
    sender: type[Simulation], instance: Simulation, **kwargs: object
) -> None:
    """Keep `study.status` honest (#152).

    One hook instead of the six terminal branches in `tasks.py` plus the cancel
    endpoint: a new algorithm cannot forget it.
    """
    settle_study_for(instance)
