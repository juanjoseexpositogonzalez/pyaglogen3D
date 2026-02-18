# Generated manually for FRAKTAL analysis

import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('fractal_analysis', '0001_initial'),
        ('projects', '0001_initial'),
        ('simulations', '0001_initial'),
    ]

    operations = [
        # Update FractalMethod choices to include FRAKTAL methods
        migrations.AlterField(
            model_name='imageanalysis',
            name='method',
            field=models.CharField(
                choices=[
                    ('box_counting', 'Box-Counting'),
                    ('sandbox', 'Sandbox Method'),
                    ('correlation', 'Correlation Dimension'),
                    ('lacunarity', 'Lacunarity'),
                    ('multifractal', 'Multifractal Dq'),
                    ('fraktal_granulated_2012', 'FRAKTAL Granulated 2012'),
                    ('fraktal_voxel_2018', 'FRAKTAL Voxel 2018'),
                ],
                max_length=30,
            ),
        ),
        # Create FraktalAnalysis model
        migrations.CreateModel(
            name='FraktalAnalysis',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('source_type', models.CharField(
                    choices=[('uploaded_image', 'Uploaded Image'), ('simulation_projection', 'Simulation Projection')],
                    default='uploaded_image',
                    max_length=30,
                )),
                ('original_image', models.BinaryField(blank=True, help_text='Original uploaded image', null=True)),
                ('original_filename', models.CharField(blank=True, max_length=255)),
                ('original_content_type', models.CharField(blank=True, max_length=50)),
                ('projection_params', models.JSONField(blank=True, help_text='Projection parameters: azimuth, elevation, resolution', null=True)),
                ('model', models.CharField(
                    choices=[('granulated_2012', 'Granulated 2012'), ('voxel_2018', 'Voxel 2018')],
                    help_text='FRAKTAL analysis model to use',
                    max_length=30,
                )),
                ('npix', models.FloatField(help_text='Pixels per 100nm in the scale bar')),
                ('dpo', models.FloatField(blank=True, help_text='Mean primary particle diameter (nm) - required for granulated model', null=True)),
                ('delta', models.FloatField(default=1.1, help_text='Filling factor (1.0-1.5)')),
                ('correction_3d', models.BooleanField(default=False, help_text='Apply 3D correction to Rg')),
                ('pixel_min', models.PositiveSmallIntegerField(default=10, help_text='Min pixel value for segmentation')),
                ('pixel_max', models.PositiveSmallIntegerField(default=240, help_text='Max pixel value for segmentation')),
                ('npo_limit', models.PositiveIntegerField(default=5, help_text='Minimum particle count (granulated model)')),
                ('escala', models.FloatField(default=100.0, help_text='Scale reference in nm')),
                ('m_exponent', models.FloatField(default=1.0, help_text='m exponent for zp calculation (voxel model)')),
                ('results', models.JSONField(blank=True, help_text='FRAKTAL results: rg, ap, df, npo, kf, zf, jf, volume, mass, surface_area', null=True)),
                ('status', models.CharField(
                    choices=[('queued', 'Queued'), ('running', 'Running'), ('completed', 'Completed'), ('failed', 'Failed'), ('cancelled', 'Cancelled')],
                    default='queued',
                    max_length=20,
                )),
                ('execution_time_ms', models.PositiveIntegerField(blank=True, null=True)),
                ('engine_version', models.CharField(blank=True, max_length=20)),
                ('error_message', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('project', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='fraktal_analyses',
                    to='projects.project',
                )),
                ('simulation', models.ForeignKey(
                    blank=True,
                    help_text='Source simulation for projection-based analysis',
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='fraktal_analyses',
                    to='simulations.simulation',
                )),
            ],
            options={
                'verbose_name_plural': 'FRAKTAL analyses',
                'db_table': 'fraktal_analyses',
                'ordering': ['-created_at'],
            },
        ),
        # Add indexes for FraktalAnalysis
        migrations.AddIndex(
            model_name='fraktalanalysis',
            index=models.Index(fields=['project', '-created_at'], name='fraktal_ana_project_a1b2c3_idx'),
        ),
        migrations.AddIndex(
            model_name='fraktalanalysis',
            index=models.Index(fields=['status'], name='fraktal_ana_status_d4e5f6_idx'),
        ),
        migrations.AddIndex(
            model_name='fraktalanalysis',
            index=models.Index(fields=['model'], name='fraktal_ana_model_g7h8i9_idx'),
        ),
        migrations.AddIndex(
            model_name='fraktalanalysis',
            index=models.Index(fields=['source_type'], name='fraktal_ana_source__j0k1l2_idx'),
        ),
        # Add fraktal_analyses to ComparisonSet
        migrations.AddField(
            model_name='comparisonset',
            name='fraktal_analyses',
            field=models.ManyToManyField(
                blank=True,
                related_name='comparison_sets',
                to='fractal_analysis.fraktalanalysis',
            ),
        ),
    ]
