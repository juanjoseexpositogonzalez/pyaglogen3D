from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("fractal_analysis", "0008_add_analysis_input_variant_field"),
    ]

    operations = [
        migrations.AddField(
            model_name="fraktalbatch",
            name="origin",
            field=models.CharField(
                default="external",
                max_length=16,
                verbose_name="Batch origin",
            ),
        ),
    ]
