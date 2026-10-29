# Generated for import-aggregate T14: CSV locale preferences per user.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0003_fix_legacy_user_fk"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="csv_column_delimiter",
            field=models.CharField(
                choices=[(",", ","), (";", ";")],
                default=",",
                help_text="Column delimiter for CSV exports",
                max_length=1,
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="csv_decimal_separator",
            field=models.CharField(
                choices=[(".", "."), (",", ",")],
                default=".",
                help_text="Decimal separator for CSV exports",
                max_length=1,
            ),
        ),
    ]
