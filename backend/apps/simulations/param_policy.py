"""The window `max_rotation_attempts` must be in, in one place (#290).

`run_tunable_cc` takes `max_rotation_attempts: usize`, and a bigger number buys more
time and a *different* result. Measured with `seed=4242`, `n_particles=20`,
`target_df=2.0`, `target_kf=1.3` (the issue's Phase-0 table is another run and does
not agree to the millisecond):

    attempts      50    0.015 s   df=2.1109  kf=1.1000
    attempts    1000    0.176 s   df=2.0911  kf=1.1258
    attempts    5000    0.857 s   df=2.1256  kf=1.0897
    attempts   20000    1.460 s   df=2.1116  kf=1.0960
    attempts  100000   19.209 s   df=2.0420  kf=1.2082

`df` does not move in one direction, so clamping is not "a safety ceiling": it runs a
different experiment and returns it as the one that was asked for. `fracval`, in
`tasks.py`, does clamp its own `max_placement_attempts` silently; that is the shape
#290 ruled out here. The ceiling is policy, not physics (100_000 completes, in 19 s),
and the time depends on `n` as much as on this value — `n=100` reaches 6.5 s at
5_000 — so no fixed cap bounds the run. That budget belongs to the engine.

The floor is 1, not `fracval`'s 10: one attempt is a meaningful request and zero is
not. With zero, `resolve_overlap_by_rotation` returns immediately, the merge falls
back to ballistic, and the run completes with geometry nobody asked for (measured:
`df` 2.0245 at `target_df=2.0`). `gcca` forwards its own attempts value with no window
at all, so the siblings have no single policy — this is the one #290 decided.

Every surface that writes the key reads this module: the simulation serializer, the
worker and the study preview. One that skipped it answered 201 and then failed every
child.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

#: Inclusive on both ends. 10_000 is `fracval`'s ceiling, borrowed deliberately.
ROTATION_ATTEMPTS_WINDOW = (1, 10_000)

#: A backend copy of the binding's own default (`run_tunable_cc` declares
#: `max_rotation_attempts=50`), pinned against the real signature by a test: a
#: `null` cannot be forwarded, because the parameter is `usize` and not
#: `Option<usize>` — that is `seed_cluster_size` — so a stored `None` used to reach
#: the binding as `TypeError: 'NoneType' object cannot be interpreted as an integer`.
ROTATION_ATTEMPTS_DEFAULT = 50


def rotation_attempts(params: Any) -> int:
    """The value `run_tunable_cc` is called with, or a refusal naming the field.

    `null` and an absent key mean the engine's default. Everything else must be a
    whole number inside the window: `True` is refused on purpose — `isinstance(True,
    int)` holds, so without the check it would run as one attempt and nobody asked.

    A `parameters` that is not an object is refused here rather than raising: this
    function is read by the serializer, where `.get` on a list escaped as a 500, and
    by the worker, where the row failed with an `AttributeError` nobody could
    attribute to the payload (#231's class).
    """
    if not isinstance(params, Mapping):
        raise ValueError(f"parameters must be an object, got {type(params).__name__}")

    value = params.get("max_rotation_attempts")
    if value is None:
        return ROTATION_ATTEMPTS_DEFAULT
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"max_rotation_attempts must be a whole number, got {value!r}")

    low, high = ROTATION_ATTEMPTS_WINDOW
    if not (low <= value <= high):
        raise ValueError(
            f"max_rotation_attempts must be between {low} and {high}, got {value}"
        )
    # `int(...)` and not `value`: the mapping hands back `Any`, and the whole point of
    # this function is that what leaves it has been checked.
    return int(value)
