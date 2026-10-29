"""Add seed_type field to Simulation model for CC tunable seed modes."""

from django.db import migrations, models


class Migration(migrations.Migration):
    """Add seed_type CharField with choices monomers/dimers/trimers."""

    dependencies = [
        ("simulations", "0005_add_is_batch_field"),
    ]

    operations = [
        migrations.AddField(
            model_name="simulation",
            name="seed_type",
            field=models.CharField(
                max_length=16,
                default="monomers",
                choices=[
                    ("monomers", "Monomers"),
                    ("dimers", "Dimers"),
                    ("trimers", "Trimers"),
                ],
                verbose_name="Seed type for CC tunable",
            ),
        ),
    ]
