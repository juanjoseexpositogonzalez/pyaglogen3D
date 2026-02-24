# Generated manually for PyAglogen3D project sharing

import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
        ('projects', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectShare',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('permission', models.CharField(choices=[('view', 'View Only'), ('edit', 'Can Edit'), ('admin', 'Admin')], default='view', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('accepted_at', models.DateTimeField(blank=True, null=True)),
                ('invited_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='invitations_sent', to=settings.AUTH_USER_MODEL)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='shares', to='projects.project')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='shared_projects', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'project_shares',
                'ordering': ['-created_at'],
                'unique_together': {('project', 'user')},
            },
        ),
        migrations.CreateModel(
            name='ShareInvitation',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('email', models.EmailField(max_length=254)),
                ('permission', models.CharField(choices=[('view', 'View Only'), ('edit', 'Can Edit'), ('admin', 'Admin')], default='view', max_length=10)),
                ('token', models.CharField(max_length=64, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('invited_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='pending_invitations_sent', to=settings.AUTH_USER_MODEL)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pending_invitations', to='projects.project')),
            ],
            options={
                'db_table': 'share_invitations',
                'ordering': ['-created_at'],
                'unique_together': {('project', 'email')},
            },
        ),
    ]
