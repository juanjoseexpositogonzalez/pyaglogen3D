"""Add is_batch field to Simulation model."""

from django.db import migrations, models


class Migration(migrations.Migration):
    """Add is_batch field to mark simulations created from parametric studies."""

    dependencies = [
        ("simulations", "0004_add_batch_features"),
    ]

    operations = [
        migrations.AddField(
            model_name="simulation",
            name="is_batch",
            field=models.BooleanField(
                default=False,
                help_text="True if created as part of a parametric study (batch simulation)",
            ),
        ),
    ]
