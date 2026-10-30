"""Settle a batch study when its last child finishes (#152).

Measured before this module: eight places write `simulation.status` and none
wrote `study.status`, so a study created as `running` said that forever even
with every child completed. The interface looked right because the counts are
`SerializerMethodField`s computed per request - the status was the only thing
lying.

The rule, written down because no requirement states it: when every child of the
study is terminal the study is `completed` if at least one child completed -
there are results to look at - and `failed` if none did. A partial failure is
still a finished study, and the per-child status says which ones failed.

It is called from a `post_save` signal rather than from the worker's terminal
branches: there are six of those branches plus the cancel endpoint, and a new
algorithm would have to remember all of them.
"""

from __future__ import annotations

from django.utils import timezone

from .models import Simulation, SimulationStatus

#: A child in one of these states will not move again.
TERMINAL = frozenset(
    {
        SimulationStatus.COMPLETED,
        SimulationStatus.FAILED,
        SimulationStatus.CANCELLED,
    }
)

#: A study in one of these states still expects its children.
PENDING = frozenset({SimulationStatus.QUEUED, SimulationStatus.RUNNING})


def settle_study_for(child: Simulation) -> bool:
    """Settle the study `child` belongs to, if it is now finished.

    Returns whether the study changed. Idempotent and cheap to call on every
    save: it does nothing for a child that is not terminal, for a study that is
    already settled, or while a sibling is still working.
    """
    if child.status not in TERMINAL:
        return False

    study = child.studies.first()
    if study is None or study.status not in PENDING:
        return False

    siblings = study.simulations.all()
    if any(sibling.status not in TERMINAL for sibling in siblings):
        return False

    any_completed = any(sibling.status == SimulationStatus.COMPLETED for sibling in siblings)
    study.status = SimulationStatus.COMPLETED if any_completed else SimulationStatus.FAILED
    study.completed_at = timezone.now()
    study.save(update_fields=["status", "completed_at"])
    return True
