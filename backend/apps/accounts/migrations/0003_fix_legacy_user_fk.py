# Generated manually to fix legacy integer foreign keys to UUID User model

from django.db import connection, migrations


def _is_postgres():
    return connection.vendor == "postgresql"


def _pg_forward(apps, schema_editor):
    """PostgreSQL-only DDL: drop orphaned auth_user tables, fix admin_log FK."""
    if not _is_postgres():
        return  # SQLite (tests) doesn't have these legacy tables

    cursor = schema_editor.connection.cursor()
    cursor.execute("DROP TABLE IF EXISTS auth_user_groups CASCADE;")
    cursor.execute("DROP TABLE IF EXISTS auth_user_user_permissions CASCADE;")
    cursor.execute("DROP TABLE IF EXISTS auth_user CASCADE;")
    cursor.execute("""
        ALTER TABLE django_admin_log
        DROP CONSTRAINT IF EXISTS django_admin_log_user_id_c564eba6_fk_auth_user_id;

        ALTER TABLE django_admin_log
        ALTER COLUMN user_id TYPE uuid USING NULL;

        ALTER TABLE django_admin_log
        ADD CONSTRAINT django_admin_log_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    """)


def _pg_rename_m2m_forward(apps, schema_editor):
    """Rename ManyToMany tables to match User model's db_table='users'."""
    if not _is_postgres():
        return
    cursor = schema_editor.connection.cursor()
    cursor.execute("ALTER TABLE IF EXISTS accounts_user_groups RENAME TO users_groups;")
    cursor.execute(
        "ALTER TABLE IF EXISTS accounts_user_user_permissions"
        " RENAME TO users_user_permissions;"
    )


def _pg_rename_m2m_reverse(apps, schema_editor):
    if not _is_postgres():
        return
    cursor = schema_editor.connection.cursor()
    cursor.execute("ALTER TABLE IF EXISTS users_groups RENAME TO accounts_user_groups;")
    cursor.execute(
        "ALTER TABLE IF EXISTS users_user_permissions"
        " RENAME TO accounts_user_user_permissions;"
    )


class Migration(migrations.Migration):
    """Fix legacy Django tables that have integer user_id instead of UUID.

    When switching to a custom User model with UUID primary key, some legacy
    Django tables still have integer foreign keys. This migration fixes them.
    Also renames ManyToMany tables to match the User model's db_table setting.

    NOTE: These operations are PostgreSQL-specific DDL. On SQLite (test DB)
    the functions are no-ops — the orphaned tables never exist there.
    """

    dependencies = [
        ("accounts", "0002_sharing"),
        ("admin", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(_pg_forward, migrations.RunPython.noop),
        migrations.RunPython(_pg_rename_m2m_forward, _pg_rename_m2m_reverse),
    ]
