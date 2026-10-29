from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("fractal_analysis", "0007_add_scientific_png_field"),
    ]

    operations = [
        migrations.AddField(
            model_name="fraktalbatchimage",
            name="analysis_input_variant",
            field=models.CharField(
                default="presentation",
                max_length=16,
                verbose_name="Analysis input variant",
            ),
        ),
    ]
