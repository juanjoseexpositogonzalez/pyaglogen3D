"""Add 5 bisection diagnostic fields to FraktalBatchImage (PYA-13 T3.1).

Additive migration — no destructive changes. Existing rows get
quality='converged' (column default) and NULL for the four nullable fields.
Reverse drops only these 5 columns and restores pre-migration table state.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("fractal_analysis", "0010_add_rg_nm_field"),
    ]

    FAILURE_CHOICES = [
        ("no_sign_change", "No sign change"),
        ("kf_negative", "kf negative"),
        ("iteration_limit", "Iteration limit"),
    ]

    QUALITY_CHOICES = [
        ("converged", "Converged"),
        ("approximate", "Approximate"),
        ("excluded", "Excluded"),
        ("failed", "Failed"),
    ]

    operations = [
        migrations.AddField(
            model_name="fraktalbatchimage",
            name="bisection_iterations",
            field=models.IntegerField(
                null=True, blank=True, verbose_name="Bisection iterations"
            ),
        ),
        migrations.AddField(
            model_name="fraktalbatchimage",
            name="bisection_residual",
            field=models.FloatField(
                null=True, blank=True, verbose_name="Bisection residual"
            ),
        ),
        migrations.AddField(
            model_name="fraktalbatchimage",
            name="failure_reason",
            field=models.CharField(
                max_length=20,
                null=True,
                blank=True,
                choices=[
                    ("no_sign_change", "No sign change"),
                    ("kf_negative", "kf negative"),
                    ("iteration_limit", "Iteration limit"),
                ],
            ),
        ),
        migrations.AddField(
            model_name="fraktalbatchimage",
            name="df_estimate",
            field=models.FloatField(
                null=True, blank=True, verbose_name="Df best estimate"
            ),
        ),
        migrations.AddField(
            model_name="fraktalbatchimage",
            name="quality",
            field=models.CharField(
                max_length=12,
                default="converged",
                choices=[
                    ("converged", "Converged"),
                    ("approximate", "Approximate"),
                    ("excluded", "Excluded"),
                    ("failed", "Failed"),
                ],
                verbose_name="Analysis quality",
            ),
        ),
    ]
