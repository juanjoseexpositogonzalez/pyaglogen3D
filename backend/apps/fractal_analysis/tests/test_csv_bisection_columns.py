"""P4 — CSV export: 5 new bisection diagnostic columns appended.

T4.1: Single-image CSV + Batch CSV → 5 new columns at end.
T4.2: Locale-aware formatting for numeric fields.
T4.3: Backwards compatibility — pre-existing columns unchanged.

Spec: csv-export-locale-delta.md (R3 MODIFIED, R4 MODIFIED).
"""

from __future__ import annotations

import csv
import io
import uuid

import pytest

from apps.core.services.csv_locale import write_localized_row
from apps.fractal_analysis.services.csv_export import (
    BATCH_IMAGE_COLUMNS,
    SINGLE_IMAGE_COLUMNS,
    build_batch_csv,
    build_single_image_csv,
)


# ---------------------------------------------------------------------------
# T4.1 — Single-image CSV: 5 new columns appended
# ---------------------------------------------------------------------------


class TestSingleImageCsvBisectionColumns:
    """R3 csv-export-locale-delta: single-image CSV gains 5 quality columns."""

    def test_header_has_5_new_columns_at_end(self) -> None:
        """Column list ends with quality, bisection_iterations, bisection_residual, failure_reason, df_estimate."""
        expected_tail = [
            "quality",
            "bisection_iterations",
            "bisection_residual",
            "failure_reason",
            "df_estimate",
        ]
        assert SINGLE_IMAGE_COLUMNS[-5:] == expected_tail

    def test_converged_image_row_has_correct_values(self) -> None:
        """Scenario 3.1: converged analysis → 5 new cells populated correctly."""
        from unittest.mock import MagicMock

        analysis = MagicMock()
        analysis.id = uuid.uuid4()
        analysis.created_at = "2024-01-15T10:00:00Z"
        analysis.model = "granulated_2012"
        analysis.original_filename = "test.png"
        analysis.results = {
            "df": 1.82,
            "kf": 1.50,
            "r_squared": 0.995,
            "n_particles": 55,
            "rg": 100.0,
            "ap": 40000.0,
            "volume": 90000.0,
            "mass": 0.4,
            "surface_area": 70000.0,
            "quality": "converged",
            "bisection_iterations": 12,
            "bisection_residual": 0.04,
            "failure_reason": "none",
            "df_estimate": 1.82,
        }
        analysis.error_message = ""
        analysis.dpo = 25.0
        analysis.auto_calibrate = False
        analysis.escala = 10.0
        analysis.npix = 500.0
        analysis.simulation_id = None

        csv_output = build_single_image_csv(analysis, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_output))
        rows = list(reader)

        # Header + 1 data row
        assert len(rows) == 2
        header = rows[0]
        data = rows[1]

        # Last 5 header columns
        assert header[-5:] == [
            "quality",
            "bisection_iterations",
            "bisection_residual",
            "failure_reason",
            "df_estimate",
        ]
        # Last 5 data cells
        assert data[-5] == "converged"
        assert data[-4] == "12"
        assert data[-3] == "0.04"
        assert data[-2] == "none"
        assert data[-1] == "1.82"

    def test_excluded_image_row_no_sign_change(self) -> None:
        """Scenario 3.2: excluded analysis → failure_reason populated, nulls → empty."""
        from unittest.mock import MagicMock

        analysis = MagicMock()
        analysis.id = uuid.uuid4()
        analysis.created_at = "2024-01-15T10:00:00Z"
        analysis.model = "granulated_2012"
        analysis.original_filename = "excluded.png"
        analysis.results = {
            "df": None,
            "kf": None,
            "r_squared": None,
            "n_particles": 0,
            "rg": None,
            "ap": None,
            "volume": None,
            "mass": None,
            "surface_area": None,
            "quality": "excluded",
            "bisection_iterations": None,
            "bisection_residual": None,
            "failure_reason": "no_sign_change",
            "df_estimate": None,
        }
        analysis.error_message = ""
        analysis.dpo = 25.0
        analysis.auto_calibrate = False
        analysis.escala = 10.0
        analysis.npix = 500.0
        analysis.simulation_id = None

        csv_output = build_single_image_csv(analysis, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_output))
        rows = list(reader)
        data = rows[1]

        assert data[-5] == "excluded"
        assert data[-4] == ""  # bisection_iterations None → empty
        assert data[-3] == ""  # bisection_residual None → empty
        assert data[-2] == "no_sign_change"
        assert data[-1] == ""  # df_estimate None → empty

    def test_legacy_image_all_none_fields(self) -> None:
        """Scenario 3.3 variant: legacy analysis with all 5 new fields absent/None."""
        from unittest.mock import MagicMock

        analysis = MagicMock()
        analysis.id = uuid.uuid4()
        analysis.created_at = "2024-01-15T10:00:00Z"
        analysis.model = "granulated_2012"
        analysis.original_filename = "legacy.png"
        # Legacy results dict: no quality/bisection fields
        analysis.results = {
            "df": 1.75,
            "kf": 1.50,
            "r_squared": 0.99,
            "n_particles": 42,
            "rg": 120.0,
            "ap": 45000.0,
            "volume": 100000.0,
            "mass": 0.5,
            "surface_area": 80000.0,
        }
        analysis.error_message = ""
        analysis.dpo = 25.0
        analysis.auto_calibrate = False
        analysis.escala = 10.0
        analysis.npix = 500.0
        analysis.simulation_id = None

        csv_output = build_single_image_csv(analysis, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_output))
        rows = list(reader)
        data = rows[1]

        # All 5 new columns → empty string (no crash)
        assert data[-5] == ""  # quality absent → empty
        assert data[-4] == ""  # bisection_iterations
        assert data[-3] == ""  # bisection_residual
        assert data[-2] == ""  # failure_reason
        assert data[-1] == ""  # df_estimate

    def test_eu_locale_decimal_comma_for_numeric_columns(self) -> None:
        """Scenario 3.3: EU locale → bisection_residual and df_estimate use comma."""
        from unittest.mock import MagicMock

        analysis = MagicMock()
        analysis.id = uuid.uuid4()
        analysis.created_at = "2024-01-15T10:00:00Z"
        analysis.model = "granulated_2012"
        analysis.original_filename = "test.png"
        analysis.results = {
            "df": 1.82,
            "kf": 1.50,
            "r_squared": 0.995,
            "n_particles": 55,
            "rg": 100.0,
            "ap": 40000.0,
            "volume": 90000.0,
            "mass": 0.4,
            "surface_area": 70000.0,
            "quality": "converged",
            "bisection_iterations": 12,
            "bisection_residual": 0.04,
            "failure_reason": "none",
            "df_estimate": 1.82,
        }
        analysis.error_message = ""
        analysis.dpo = 25.0
        analysis.auto_calibrate = False
        analysis.escala = 10.0
        analysis.npix = 500.0
        analysis.simulation_id = None

        csv_output = build_single_image_csv(analysis, decimal=",", delimiter=";")
        reader = csv.reader(io.StringIO(csv_output), delimiter=";")
        rows = list(reader)
        data = rows[1]

        # String fields unaffected by locale
        assert data[-5] == "converged"
        assert data[-2] == "none"
        # Integer: no decimal → unchanged
        assert data[-4] == "12"
        # Floats: decimal comma
        assert data[-3] == "0,04"
        assert data[-1] == "1,82"


# ---------------------------------------------------------------------------
# T4.1 + T4.2 — Batch CSV: 5 new columns + summary row counters
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestBatchCsvBisectionColumns:
    """R4 csv-export-locale-delta: batch CSV gains 5 quality columns + summary counters."""

    def _make_batch_with_quality_mix(self):
        """Create batch with mixed quality images for testing."""
        from apps.accounts.models import User
        from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage
        from apps.projects.models import Project

        user = User.objects.create_user(
            email=f"csv-{uuid.uuid4()}@test.com", password="x"
        )
        project = Project.objects.create(name=f"p-{uuid.uuid4()}", owner=user)
        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
            n_images=4,
            n_successful=3,
            mean_df=1.78,
            std_df=0.03,
            median_df=1.78,
            min_df=1.75,
            max_df=1.82,
        )

        import io

        from PIL import Image

        buf = io.BytesIO()
        Image.new("L", (32, 32), 128).save(buf, format="PNG")
        png = buf.getvalue()

        # Image 0: converged
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="img_000.png",
            azimuth=0.0,
            elevation=0.0,
            fractal_dimension=1.82,
            prefactor=1.5,
            r_squared=0.99,
            n_particles_counted=42,
            dpo_used=25.0,
            error="",
            image_png=png,
            quality="converged",
            bisection_iterations=8,
            bisection_residual=0.02,
            failure_reason=None,
            df_estimate=1.82,
        )
        # Image 1: approximate
        FraktalBatchImage.objects.create(
            batch=batch,
            index=1,
            filename="img_001.png",
            azimuth=30.0,
            elevation=15.0,
            fractal_dimension=1.78,
            prefactor=1.4,
            r_squared=0.95,
            n_particles_counted=30,
            dpo_used=25.0,
            error="",
            image_png=png,
            quality="approximate",
            bisection_iterations=50,
            bisection_residual=0.8,
            failure_reason="iteration_limit",
            df_estimate=1.78,
        )
        # Image 2: excluded
        FraktalBatchImage.objects.create(
            batch=batch,
            index=2,
            filename="img_002.png",
            azimuth=60.0,
            elevation=30.0,
            fractal_dimension=None,
            prefactor=None,
            r_squared=None,
            n_particles_counted=0,
            dpo_used=25.0,
            error="",
            image_png=png,
            quality="excluded",
            bisection_iterations=None,
            bisection_residual=None,
            failure_reason="no_sign_change",
            df_estimate=None,
        )
        # Image 3: failed
        FraktalBatchImage.objects.create(
            batch=batch,
            index=3,
            filename="img_003.png",
            azimuth=90.0,
            elevation=45.0,
            fractal_dimension=None,
            prefactor=None,
            r_squared=None,
            n_particles_counted=None,
            dpo_used=25.0,
            error="Engine crash",
            image_png=png,
            quality="failed",
            bisection_iterations=None,
            bisection_residual=None,
            failure_reason="kf_negative",
            df_estimate=None,
        )
        return batch

    def test_batch_header_has_5_new_columns_at_end(self) -> None:
        """Batch image column list ends with 5 new columns."""
        expected_tail = [
            "quality",
            "bisection_iterations",
            "bisection_residual",
            "failure_reason",
            "df_estimate",
        ]
        assert BATCH_IMAGE_COLUMNS[-5:] == expected_tail

    def test_converged_image_row_in_batch(self) -> None:
        """Scenario 4.1: converged batch image → 5 new cells populated."""
        batch = self._make_batch_with_quality_mix()
        csv_output = build_batch_csv(batch, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_output))
        rows = list(reader)

        # Row 0 = header, Row 1 = image 0 (converged)
        data = rows[1]
        assert data[-5] == "converged"
        assert data[-4] == "8"
        assert data[-3] == "0.02"
        assert data[-2] == ""  # failure_reason=None → empty
        assert data[-1] == "1.82"

    def test_excluded_image_row_in_batch(self) -> None:
        """Scenario 4.2: excluded batch image → nulls are empty strings."""
        batch = self._make_batch_with_quality_mix()
        csv_output = build_batch_csv(batch, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_output))
        rows = list(reader)

        # Row 3 = image at index 2 (excluded)
        data = rows[3]
        assert data[-5] == "excluded"
        assert data[-4] == ""  # bisection_iterations None
        assert data[-3] == ""  # bisection_residual None
        assert data[-2] == "no_sign_change"
        assert data[-1] == ""  # df_estimate None

    def test_summary_row_has_quality_counters(self) -> None:
        """Scenario 4.4: summary row has n_converged, n_approximate, n_excluded, n_failed, mean_df_inclusive."""
        batch = self._make_batch_with_quality_mix()
        csv_output = build_batch_csv(batch, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_output))
        rows = list(reader)

        # Find summary row (after blank line)
        summary_idx = None
        for i, row in enumerate(rows):
            if row and row[0] == "SUMMARY":
                summary_idx = i
                break
        assert summary_idx is not None, "Summary row not found"
        summary = rows[summary_idx]

        # Summary should end with: n_converged, n_approximate, n_excluded, n_failed, mean_df_inclusive
        assert summary[-5] == "1"  # n_converged
        assert summary[-4] == "1"  # n_approximate
        assert summary[-3] == "1"  # n_excluded
        assert summary[-2] == "1"  # n_failed
        # mean_df_inclusive = mean of converged + approximate df values = (1.82 + 1.78)/2 = 1.8
        assert summary[-1] == "1.8"

    def test_batch_csv_eu_locale(self) -> None:
        """Scenario 4.1 EU: decimal comma for numeric fields, string fields unchanged."""
        batch = self._make_batch_with_quality_mix()
        csv_output = build_batch_csv(batch, decimal=",", delimiter=";")
        reader = csv.reader(io.StringIO(csv_output), delimiter=";")
        rows = list(reader)

        # Image 0 (converged) — EU locale
        data = rows[1]
        assert data[-5] == "converged"  # string, unaffected
        assert data[-4] == "8"  # integer, no decimal → unchanged
        assert data[-3] == "0,02"  # float with comma
        assert data[-1] == "1,82"  # float with comma

    def test_legacy_batch_image_no_quality_fields(self) -> None:
        """Scenario 4.3: legacy image (pre-migration) — quality defaults to 'converged', others None."""
        from apps.accounts.models import User
        from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage
        from apps.projects.models import Project

        user = User.objects.create_user(
            email=f"csv-leg-{uuid.uuid4()}@test.com", password="x"
        )
        project = Project.objects.create(name=f"p-{uuid.uuid4()}", owner=user)
        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
            n_images=1,
            n_successful=1,
            mean_df=1.75,
        )

        import io as _io

        from PIL import Image

        buf = _io.BytesIO()
        Image.new("L", (32, 32), 128).save(buf, format="PNG")
        png = buf.getvalue()

        # Legacy image — quality defaults to "converged", diagnostic fields all None
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="legacy.png",
            azimuth=0.0,
            elevation=0.0,
            fractal_dimension=1.75,
            prefactor=1.5,
            r_squared=0.99,
            n_particles_counted=42,
            dpo_used=25.0,
            error="",
            image_png=png,
            # quality defaults to "converged" via model default
            # bisection_iterations, bisection_residual, failure_reason, df_estimate all None
        )

        csv_output = build_batch_csv(batch, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_output))
        rows = list(reader)

        data = rows[1]
        assert data[-5] == "converged"  # model default
        assert data[-4] == ""  # None → empty
        assert data[-3] == ""  # None → empty
        assert data[-2] == ""  # None → empty
        assert data[-1] == ""  # None → empty


# ---------------------------------------------------------------------------
# T4.3 — Backwards compatibility: pre-existing columns unchanged
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestCsvBackwardsCompatibility:
    """Pre-existing columns byte-identical; 5 new columns are appended only."""

    def test_batch_old_columns_unchanged_with_new_fields_none(self) -> None:
        """Legacy batch image (new fields=None): old columns produce same values."""
        from apps.accounts.models import User
        from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage
        from apps.projects.models import Project

        user = User.objects.create_user(
            email=f"compat-{uuid.uuid4()}@test.com", password="x"
        )
        project = Project.objects.create(name=f"p-{uuid.uuid4()}", owner=user)
        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
            n_images=1,
            n_successful=1,
            mean_df=1.75,
        )

        import io as _io

        from PIL import Image

        buf = _io.BytesIO()
        Image.new("L", (32, 32), 128).save(buf, format="PNG")
        png = buf.getvalue()

        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="proj_000.png",
            azimuth=0.0,
            elevation=15.0,
            fractal_dimension=1.75,
            prefactor=1.5,
            r_squared=0.99,
            n_particles_counted=42,
            dpo_used=25.0,
            error="",
            image_png=png,
        )

        csv_output = build_batch_csv(batch, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_output))
        rows = list(reader)

        # The OLD column count was 13. Data row's first 13 values should match expected.
        data = rows[1]
        old_column_count = 13  # original BATCH_IMAGE_COLUMNS length
        old_cells = data[:old_column_count]

        assert old_cells[0] == "0"  # index
        assert old_cells[1] == "proj_000.png"  # filename
        assert old_cells[2] == "0.0"  # azimuth
        assert old_cells[3] == "15.0"  # elevation
        assert old_cells[4] == "1.75"  # fractal_dimension
        assert old_cells[5] == "1.5"  # prefactor
        assert old_cells[6] == "0.99"  # r_squared
        assert old_cells[7] == "42"  # n_particles_counted
        assert old_cells[8] == ""  # error (empty string)
        assert old_cells[9] == "25.0"  # dpo_used
        assert old_cells[10] == ""  # autocalibrate_source
        assert old_cells[11] == "50000.0"  # scale_factor_nm = pixels_per_100nm * 100
        assert old_cells[12] == "500.0"  # pixels_per_100nm

        # Total columns should be old + 5
        assert len(data) == old_column_count + 5
