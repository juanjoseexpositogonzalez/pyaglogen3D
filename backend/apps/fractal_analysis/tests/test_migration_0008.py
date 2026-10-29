"""Tests for migration 0008_add_analysis_input_variant_field.

Validates:
- Migration file exists with correct structure
- Adds CharField with expected attributes
- Additive only — no destructive operations
- Reversible
"""

from __future__ import annotations

import importlib
import types

import pytest
from django.db import migrations as dj_migrations


def _load_migration() -> types.ModuleType:
    return importlib.import_module(
        "apps.fractal_analysis.migrations.0008_add_analysis_input_variant_field"
    )


class TestMigration0008Structure:
    """Structural tests — no DB needed."""

    def test_migration_module_exists(self) -> None:
        mod = _load_migration()
        assert hasattr(mod, "Migration")

    def test_depends_on_0007(self) -> None:
        mod = _load_migration()
        deps = mod.Migration.dependencies
        assert any("0007" in d[1] for d in deps)

    def test_single_add_field_operation(self) -> None:
        mod = _load_migration()
        ops = mod.Migration.operations
        assert len(ops) == 1
        assert isinstance(ops[0], dj_migrations.AddField)

    def test_field_targets_fraktalbatchimage(self) -> None:
        mod = _load_migration()
        op = mod.Migration.operations[0]
        assert op.model_name.lower() == "fraktalbatchimage"

    def test_field_name_is_analysis_input_variant(self) -> None:
        mod = _load_migration()
        op = mod.Migration.operations[0]
        assert op.name == "analysis_input_variant"

    def test_field_is_charfield_with_correct_attrs(self) -> None:
        mod = _load_migration()
        op = mod.Migration.operations[0]
        field = op.field
        from django.db import models

        assert isinstance(field, models.CharField)
        assert field.max_length == 16
        assert field.default == "presentation"
        # NOT NULL (null not set or False)
        assert not getattr(field, "null", False)

    def test_additive_no_remove_or_alter(self) -> None:
        """Migration must be purely additive — no RemoveField/AlterField."""
        mod = _load_migration()
        for op in mod.Migration.operations:
            assert not isinstance(op, dj_migrations.RemoveField)
            assert not isinstance(op, dj_migrations.AlterField)
            assert not isinstance(op, dj_migrations.DeleteModel)

    def test_migration_is_reversible(self) -> None:
        """AddField is inherently reversible (drops the column on reverse)."""
        mod = _load_migration()
        op = mod.Migration.operations[0]
        # AddField supports deconstruct → reversible
        assert isinstance(op, dj_migrations.AddField)
        # Verify deconstruct doesn't raise
        op.deconstruct()
