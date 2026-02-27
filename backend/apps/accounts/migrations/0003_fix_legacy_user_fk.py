# Generated manually to fix legacy integer foreign keys to UUID User model

from django.db import migrations


class Migration(migrations.Migration):
    """Fix legacy Django tables that have integer user_id instead of UUID.

    When switching to a custom User model with UUID primary key, some legacy
    Django tables still have integer foreign keys. This migration fixes them.
    """

    dependencies = [
        ('accounts', '0002_sharing'),
    ]

    operations = [
        # Drop orphaned auth_user_* tables (we use accounts_user_* now)
        migrations.RunSQL(
            sql="DROP TABLE IF EXISTS auth_user_groups CASCADE;",
            reverse_sql="SELECT 1;",  # No reverse needed
        ),
        migrations.RunSQL(
            sql="DROP TABLE IF EXISTS auth_user_user_permissions CASCADE;",
            reverse_sql="SELECT 1;",  # No reverse needed
        ),
        # Fix django_admin_log to use UUID
        migrations.RunSQL(
            sql="""
                ALTER TABLE django_admin_log
                DROP CONSTRAINT IF EXISTS django_admin_log_user_id_c564eba6_fk_auth_user_id;

                ALTER TABLE django_admin_log
                ALTER COLUMN user_id TYPE uuid USING NULL;

                ALTER TABLE django_admin_log
                ADD CONSTRAINT django_admin_log_user_id_fk
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
            """,
            reverse_sql="SELECT 1;",
        ),
    ]
