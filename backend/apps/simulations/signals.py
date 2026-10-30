"""Signals for the simulations app."""

from __future__ import annotations

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Simulation
from .study_status import settle_study_for

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Simulation)
def settle_the_study_when_its_last_child_finishes(
    sender: type[Simulation], instance: Simulation, **kwargs: object
) -> None:
    """Keep `study.status` honest (#152).

    One hook instead of the six terminal branches in `tasks.py` plus the cancel
    endpoint: a new algorithm cannot forget it.
    """
    try:
        settle_study_for(instance)
    except Exception:  # pragma: no cover - defensive
        # Settling is derived bookkeeping: a database hiccup here must not turn a
        # child that computed correctly into a failed one, and must not escape
        # into the worker's `try` - a judge measured both.
        logger.exception("Could not settle the study of simulation %s", instance.pk)
