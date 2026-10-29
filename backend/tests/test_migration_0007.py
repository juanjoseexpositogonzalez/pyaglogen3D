"""Migration tests for 0007_add_scientific_png_field.

Verifies spec R-DELTA-F:
  - Forward migration adds nullable BinaryField (no data loss)
  - Reverse migration drops only the new column (no side effects)
  - Existing rows gain NULL for the new field
"""

from __future__ import annotations

from importlib import import_module

from apps.fractal_analysis.models import FraktalBatchImage

# Import the migration module by its full dotted path
_migration_mod = import_module(
    "apps.fractal_analysis.migrations.0007_add_scientific_png_field"
)
Migration0007 = _migration_mod.Migration


class TestMigration0007Structure:
    """Test migration 0007 structure without running migrate/rollback.

    These tests verify the migration file contents and the resulting
    model state. They run with --no-migrations (in-memory schema from models).
    """

    def test_migration_is_additive_single_operation(self):
        """Migration has exactly one AddField operation — no drops or renames."""
        assert len(Migration0007.operations) == 1
        op = Migration0007.operations[0]
        assert op.__class__.__name__ == "AddField"
        assert op.name == "png_scientific_bytes"
        assert op.model_name.lower() == "fraktalbatchimage"

    def test_migration_field_is_nullable(self):
        """AddField creates a nullable BinaryField."""
        field = Migration0007.operations[0].field
        assert field.null is True
        assert field.blank is True

    def test_migration_depends_on_0006(self):
        """Migration chains from 0006 (fraktal_batch_models)."""
        dep_labels = [dep[1] for dep in Migration0007.dependencies]
        assert "0006_fraktal_batch_models" in dep_labels

    def test_migration_is_reversible(self):
        """AddField is auto-reversible in Django (reverse = RemoveField)."""
        op = Migration0007.operations[0]
        # AddField is always reversible (Django auto-generates RemoveField).
        # Verify it's not a RunPython without reverse_code.
        assert op.__class__.__name__ == "AddField"

    def test_model_field_exists_after_migration(self):
        """FraktalBatchImage has png_scientific_bytes in its meta fields."""
        field_names = [f.name for f in FraktalBatchImage._meta.get_fields()]
        assert "png_scientific_bytes" in field_names

    def test_existing_model_fields_preserved(self):
        """All pre-existing fields remain after adding the new one."""
        expected_fields = {
            "id",
            "batch",
            "index",
            "filename",
            "azimuth",
            "elevation",
            "fractal_dimension",
            "prefactor",
            "r_squared",
            "n_particles_counted",
            "dpo_used",
            "error",
            "image_png",
            "png_scientific_bytes",
        }
        actual_fields = {f.name for f in FraktalBatchImage._meta.local_fields}
        assert expected_fields.issubset(actual_fields)
