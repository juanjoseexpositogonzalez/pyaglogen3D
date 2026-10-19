"""Add nullable pixels_per_100nm to FraktalBatchImage (R2 MODIFIED,
change fraktal-batch-extensions).

Additive, reversible, no backfill: rows written before this migration keep
``pixels_per_100nm = NULL`` and fall back to the batch scale on re-analysis.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("fractal_analysis", "0011_add_bisection_diagnostic_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="fraktalbatchimage",
            name="pixels_per_100nm",
            field=models.FloatField(
                blank=True,
                null=True,
                verbose_name="Pixels per 100 nm",
            ),
        ),
    ]
