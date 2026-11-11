"""The window a numeric parameter must be in, in one place (#290).

`run_tunable_cc` takes `max_rotation_attempts: usize`, and a bigger number buys more
time rather than more information. Measured with `seed=4242`, `n_particles=20`,
`target_df=2.0`, `target_kf=1.3`:

    attempts      50    0.015 s   df=2.1109  kf=1.1000
    attempts    1000    0.176 s   df=2.0911  kf=1.1258
    attempts  100000   19.209 s   df=2.0420  kf=1.2082
    attempts 1e7       > 40 s     no result, child left without a state

Two things follow, and they are why this module exists rather than a one-line clamp:

1. **The value changes the result**, and not monotonically. Clamping it is not "a
   safety ceiling": it runs a different experiment and returns it as the one that was
   asked for. `fracval`, in `tasks.py`, does clamp its own `max_placement_attempts`
   silently; that is the shape #290 ruled out for this parameter.
2. **The time depends on `n` as much as on this value** — `n=100` reaches 6.5 s at
   5_000 attempts — so no fixed cap bounds the run. The window below is the siblings'
   policy window, and the time budget that does not depend on `n` belongs to the
   engine and to its own issue.

Both surfaces read this module so they cannot drift into two differently-worded
refusals: the serializer, where the refusal arrives as a 400 before a row exists, and
the worker, where every other door ends up — the admin, the AI assistant's tools, and
rows stored before this window existed.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

#: Inclusive on both ends. The upper bound is the `fracval` policy window, not a
#: number read off the time curve.
ROTATION_ATTEMPTS_WINDOW = (1, 10_000)

#: What `run_tunable_cc` uses when the argument is absent. Exposed because a `null`
#: means exactly this: the signature declares `max_rotation_attempts: usize`, not
#: `Option<usize>` (that is `seed_cluster_size`), so a stored `None` reached the
#: binding as `TypeError: 'NoneType' object cannot be interpreted as an integer`.
ROTATION_ATTEMPTS_DEFAULT = 50


def rotation_attempts(params: Mapping[str, Any]) -> int:
    """The value `run_tunable_cc` is called with, or a refusal naming the field.

    `null` (and an absent key) means the engine's own default, because the binding
    takes no `None` here. Everything else must be a whole number inside the window:
    `True` is refused on purpose — `isinstance(True, int)` holds, so without the
    explicit check it would run as one attempt and nobody would have asked for it.
    """
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
    # `int(...)` and not `value`: the mapping hands back `Any`, and the whole point
    # of this function is that what leaves it has been checked.
    return int(value)
