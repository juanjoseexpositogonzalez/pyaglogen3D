"""Add nullable rg_nm column to FraktalBatchImage.

Additive migration — no destructive changes. Existing rows get rg_nm = NULL.
Reverse drops only the rg_nm column.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("fractal_analysis", "0009_add_origin_field"),
    ]

    operations = [
        migrations.AddField(
            model_name="fraktalbatchimage",
            name="rg_nm",
            field=models.FloatField(
                blank=True,
                null=True,
                verbose_name="Radius of gyration (nm)",
            ),
        ),
    ]
