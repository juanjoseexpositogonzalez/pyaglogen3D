"""Cross-cutting integration test for fraktal-bisection-ux (frente 12, PYA-13 T6.1).

End-to-end validation of the bisection quality pipeline through the backend:

    Engine result dict (mocked) → persist_batch_results → DB rows
    → batch_detail_view (quality counters + mean_df_inclusive)
    → batch_image_detail_view (5 diagnostic fields)
    → batch CSV export (quality column populated)

The engine→binding tier is NOT tested here — that's covered by:
- P1 cargo tests (13 tests across bisection/granulated_2012/result)
- P2 binding crate tests (22 tests in aglogen_core/python)

Simplification: engine result dicts are synthetic (not from the real
Rust engine). This test focuses on the persist→DB→serialize→API tier,
which is where the UX actually surfaces.
"""

from __future__ import annotations

import csv
import io
import uuid

import numpy as np
import pytest
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage
from apps.fractal_analysis.services.batch import persist_batch_results
from apps.fractal_analysis.services.csv_export import build_batch_csv


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"integ-bisection-{uuid.uuid4()}@example.com", password="x"
    )


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name="bisection-quality-integ", owner=user)


def _make_batch(project, user: User) -> FraktalBatch:
    return FraktalBatch.objects.create(
        project=project,
        created_by=user,
        algorithm="granulated_2012",
        calibration_source="metadata",
        pixels_per_100nm=500.0,
        dpo_used=25.0,
    )


def _make_png(size: int = 32) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (size, size), 128).save(buf, format="PNG")
    return buf.getvalue()


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _synthetic_engine_results() -> list[dict]:
    """Simulate engine output: 5 converged + 2 approximate + 1 excluded + 1 failed.

    This distribution exercises all 4 quality states and allows verifying
    that counters, mean_df, and mean_df_inclusive are computed correctly.
    """
    results: list[dict] = []

    # 5 converged images: residual < 0.1, valid Df + kf
    for i in range(5):
        df = 1.80 + i * 0.02  # 1.80, 1.82, 1.84, 1.86, 1.88
        results.append(
            {
                "index": i,
                "filename": f"img_{i:03d}.png",
                "azimuth": float(i * 10),
                "elevation": 0.0,
                "fractal_dimension": df,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "rg_nm": 120.0,
                "error": None,
                "quality": "converged",
                "bisection_iterations": 10 + i,
                "bisection_residual": 0.01 + i * 0.01,
                "failure_reason": "none",
                "df_estimate": df,
            }
        )

    # 2 approximate images: residual 0.1-1.0, Df reported with warning
    for j in range(2):
        idx = 5 + j
        df_est = 1.70 + j * 0.05  # 1.70, 1.75
        results.append(
            {
                "index": idx,
                "filename": f"img_{idx:03d}.png",
                "azimuth": float(idx * 10),
                "elevation": 0.0,
                "fractal_dimension": None,
                "prefactor": None,
                "r_squared": None,
                "n_particles_counted": None,
                "rg_nm": None,
                "error": None,
                "quality": "approximate",
                "bisection_iterations": 50,
                "bisection_residual": 0.3 + j * 0.3,
                "failure_reason": "iteration_limit",
                "df_estimate": df_est,
            }
        )

    # 1 excluded image: no_sign_change
    results.append(
        {
            "index": 7,
            "filename": "img_007.png",
            "azimuth": 70.0,
            "elevation": 0.0,
            "fractal_dimension": None,
            "prefactor": None,
            "r_squared": None,
            "n_particles_counted": None,
            "rg_nm": None,
            "error": None,
            "quality": "excluded",
            "bisection_iterations": None,
            "bisection_residual": None,
            "failure_reason": "no_sign_change",
            "df_estimate": None,
        }
    )

    # 1 failed image: engine says converged but error is set → safety net override
    results.append(
        {
            "index": 8,
            "filename": "blank_008.png",
            "azimuth": 80.0,
            "elevation": 0.0,
            "fractal_dimension": None,
            "prefactor": None,
            "r_squared": None,
            "n_particles_counted": None,
            "rg_nm": None,
            "error": "No particles found",
            "quality": "converged",  # engine bug — safety net must override to "failed"
            "bisection_iterations": None,
            "bisection_residual": None,
            "failure_reason": None,
            "df_estimate": None,
        }
    )

    return results


# ---------------------------------------------------------------------------
# Cross-cutting integration test
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestFraktalBisectionQualityPipeline:
    """Full backend pipeline: persist → DB → batch_detail → drill-down → CSV.

    Uses 9 synthetic engine results (5 converged + 2 approximate + 1 excluded
    + 1 failed) to exercise all quality states through every backend tier.
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        """Create shared test fixtures."""
        self.user = _make_user()
        self.project = _make_project(self.user)
        self.batch = _make_batch(self.project, self.user)
        self.results = _synthetic_engine_results()
        self.png_list = [_make_png() for _ in self.results]

        # Persist: engine result → DB
        persist_batch_results(self.batch, self.results, self.png_list, dpo_used=25.0)

        # Update batch summary (normally done by persist, but counts need updating)
        self.batch.n_images = len(self.results)
        self.batch.n_successful = sum(
            1 for r in self.results if r.get("fractal_dimension") is not None
        )
        self.batch.save(update_fields=["n_images", "n_successful"])

        self.client = _authed_client(self.user)

    # -- Step 1: Verify engine result dict has 5 new fields per image ------

    def test_engine_result_dict_has_5_diagnostic_fields(self) -> None:
        """Each synthetic engine result dict carries the 5 new fields."""
        expected_keys = {
            "quality",
            "bisection_iterations",
            "bisection_residual",
            "failure_reason",
            "df_estimate",
        }
        for r in self.results:
            missing = expected_keys - r.keys()
            assert not missing, f"Image {r['index']} missing fields: {missing}"

    # -- Step 2: Verify persist_batch_results stores correctly -------------

    def test_persist_stores_all_quality_states(self) -> None:
        """DB has correct quality distribution after persist."""
        imgs = FraktalBatchImage.objects.filter(batch=self.batch).order_by("index")
        assert imgs.count() == 9

        qualities = [img.quality for img in imgs]
        assert qualities.count("converged") == 5
        assert qualities.count("approximate") == 2
        assert qualities.count("excluded") == 1
        assert qualities.count("failed") == 1

    def test_persist_quality_override_safety_net(self) -> None:
        """Image with error + engine quality='converged' → overridden to 'failed'."""
        failed_img = FraktalBatchImage.objects.get(batch=self.batch, index=8)
        assert failed_img.quality == "failed"
        assert failed_img.error == "No particles found"

    def test_persist_converged_image_has_diagnostic_fields(self) -> None:
        """Converged image has all 5 diagnostic fields populated."""
        img = FraktalBatchImage.objects.get(batch=self.batch, index=0)
        assert img.quality == "converged"
        assert img.bisection_iterations == 10
        assert img.bisection_residual == pytest.approx(0.01)
        assert img.failure_reason == "none"
        assert img.df_estimate == pytest.approx(1.80)

    def test_persist_approximate_image_has_diagnostic_fields(self) -> None:
        """Approximate image preserves failure_reason and df_estimate."""
        img = FraktalBatchImage.objects.get(batch=self.batch, index=5)
        assert img.quality == "approximate"
        assert img.bisection_iterations == 50
        assert img.bisection_residual == pytest.approx(0.3)
        assert img.failure_reason == "iteration_limit"
        assert img.df_estimate == pytest.approx(1.70)

    def test_persist_excluded_image_nulls_correctly(self) -> None:
        """Excluded image has no_sign_change, null iterations/residual."""
        img = FraktalBatchImage.objects.get(batch=self.batch, index=7)
        assert img.quality == "excluded"
        assert img.failure_reason == "no_sign_change"
        assert img.bisection_iterations is None
        assert img.bisection_residual is None
        assert img.df_estimate is None

    # -- Step 3: Fetch batch detail via API --------------------------------

    def test_batch_detail_quality_counters(self) -> None:
        """batch_detail_view returns correct n_converged/n_approximate/n_excluded/n_failed."""
        url = f"/api/v1/projects/{self.project.id}/fraktal/batches/{self.batch.id}/"
        resp = self.client.get(url)
        assert resp.status_code == 200

        stats = resp.json()["stats"]
        assert stats["n_converged"] == 5
        assert stats["n_approximate"] == 2
        assert stats["n_excluded"] == 1
        assert stats["n_failed"] == 1

    def test_batch_detail_mean_df_is_converged_only(self) -> None:
        """mean_df computed from converged images only (not approximate)."""
        url = f"/api/v1/projects/{self.project.id}/fraktal/batches/{self.batch.id}/"
        resp = self.client.get(url)
        stats = resp.json()["stats"]

        # Converged Df values: 1.80, 1.82, 1.84, 1.86, 1.88
        expected_mean_df = float(np.mean([1.80, 1.82, 1.84, 1.86, 1.88]))
        assert stats["mean_df"] == pytest.approx(expected_mean_df)

    def test_batch_detail_mean_df_inclusive_differs(self) -> None:
        """mean_df_inclusive includes approximate df_estimate values."""
        url = f"/api/v1/projects/{self.project.id}/fraktal/batches/{self.batch.id}/"
        resp = self.client.get(url)
        stats = resp.json()["stats"]

        # Inclusive: converged (1.80..1.88) + approximate (1.70, 1.75)
        converged = [1.80, 1.82, 1.84, 1.86, 1.88]
        approximate = [1.70, 1.75]
        expected_inclusive = float(np.mean(converged + approximate))
        assert stats["mean_df_inclusive"] == pytest.approx(expected_inclusive)
        assert stats["mean_df"] != stats["mean_df_inclusive"]

    # -- Step 4: Fetch drill-down for one approximate image ----------------

    def test_drill_down_approximate_image_all_5_fields(self) -> None:
        """batch_image_detail_view for approximate image has all 5 diagnostic fields."""
        url = (
            f"/api/v1/projects/{self.project.id}"
            f"/fraktal/batches/{self.batch.id}/images/5/"
        )
        resp = self.client.get(url)
        assert resp.status_code == 200

        data = resp.json()
        assert data["quality"] == "approximate"
        assert data["bisection_iterations"] == 50
        assert data["bisection_residual"] == pytest.approx(0.3)
        assert data["failure_reason"] == "iteration_limit"
        assert data["df_estimate"] == pytest.approx(1.70)

    def test_drill_down_converged_image_all_5_fields(self) -> None:
        """Converged image drill-down has all 5 diagnostic fields."""
        url = (
            f"/api/v1/projects/{self.project.id}"
            f"/fraktal/batches/{self.batch.id}/images/0/"
        )
        resp = self.client.get(url)
        assert resp.status_code == 200

        data = resp.json()
        assert data["quality"] == "converged"
        assert data["bisection_iterations"] == 10
        assert data["bisection_residual"] == pytest.approx(0.01)
        assert data["failure_reason"] == "none"
        assert data["df_estimate"] == pytest.approx(1.80)

    def test_drill_down_failed_image_shows_override(self) -> None:
        """Failed image (safety net override) drill-down shows quality=failed."""
        url = (
            f"/api/v1/projects/{self.project.id}"
            f"/fraktal/batches/{self.batch.id}/images/8/"
        )
        resp = self.client.get(url)
        assert resp.status_code == 200

        data = resp.json()
        assert data["quality"] == "failed"
        assert data["error"] == "No particles found"

    # -- Step 5: CSV export has quality column populated -------------------

    def test_csv_export_quality_column_populated(self) -> None:
        """Batch CSV export has quality column correctly populated per image."""
        csv_body = build_batch_csv(self.batch, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_body))
        rows = list(reader)

        header = rows[0]
        quality_col_idx = header.index("quality")

        # 9 image rows (indices 1-9)
        image_rows = rows[1:10]
        qualities = [row[quality_col_idx] for row in image_rows]

        assert qualities.count("converged") == 5
        assert qualities.count("approximate") == 2
        assert qualities.count("excluded") == 1
        assert qualities.count("failed") == 1

    def test_csv_export_has_all_5_diagnostic_columns(self) -> None:
        """CSV header includes all 5 new diagnostic columns."""
        csv_body = build_batch_csv(self.batch, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_body))
        header = next(reader)

        expected = [
            "quality",
            "bisection_iterations",
            "bisection_residual",
            "failure_reason",
            "df_estimate",
        ]
        assert header[-5:] == expected

    def test_csv_converged_row_has_diagnostic_values(self) -> None:
        """Converged image row in CSV carries all 5 diagnostic values."""
        csv_body = build_batch_csv(self.batch, decimal=".", delimiter=",")
        reader = csv.reader(io.StringIO(csv_body))
        rows = list(reader)

        # Row 1 = first image (converged, index=0)
        data = rows[1]
        assert data[-5] == "converged"
        assert data[-4] == "10"  # bisection_iterations
        assert data[-3] == "0.01"  # bisection_residual
        assert data[-2] == "none"  # failure_reason
        assert data[-1] == "1.8"  # df_estimate (1.80)
