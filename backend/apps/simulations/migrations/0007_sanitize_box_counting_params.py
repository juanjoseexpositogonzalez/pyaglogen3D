"""Sanitize legacy box_counting_params (F5 — judgment-day fix round A).

R1.2 of ``batch-windowed-box-counting`` turned unknown keys into a 400.
Studies created before the change may carry legacy extra keys in
``ParametricStudy.box_counting_params``; any client PATCH that round-trips
the stored value would then 400 with no migration path. This data migration
keeps only the known persisted keys (``points_per_sphere``, ``precision``,
``windowed``) and drops everything else.

Non-dict values are left untouched (JD-B-007 guards them at the validation
boundary). The reverse migration is a no-op: dropped keys cannot be
reconstructed, and pre-change behavior (silently ignoring extras) is what a
rollback would restore anyway.
"""

from typing import Any

from django.db import migrations

#: The persisted shape enforced by ``validate_box_counting_params_dict``
#: (R1.2) — keep exactly these keys.
_BC_PARAM_KEYS = {"points_per_sphere", "precision", "windowed"}


def sanitize_box_counting_params(apps: Any, schema_editor: Any) -> None:
    ParametricStudy = apps.get_model("simulations", "ParametricStudy")
    for study in ParametricStudy.objects.exclude(
        box_counting_params__isnull=True
    ).iterator():
        params = study.box_counting_params
        if not isinstance(params, dict):
            continue
        sanitized = {k: v for k, v in params.items() if k in _BC_PARAM_KEYS}
        if sanitized != params:
            study.box_counting_params = sanitized
            study.save(update_fields=["box_counting_params"])


class Migration(migrations.Migration):
    """Drop legacy extra keys from stored box_counting_params (F5)."""

    dependencies = [
        ("simulations", "0006_add_seed_type_field"),
    ]

    operations = [
        migrations.RunPython(
            sanitize_box_counting_params,
            migrations.RunPython.noop,
        ),
    ]
