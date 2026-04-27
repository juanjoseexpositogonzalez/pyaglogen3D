"""Tests for persist_batch_results helper — Phase 3.

Covers:
- Creating FraktalBatchImage rows with correct data
- Updating FraktalBatch summary fields from per-image metrics
- Handling partial failures (some images have error, no Df)
- PNG bytes round-trip storage
"""

from __future__ import annotations

import io
import uuid

import numpy as np
import pytest
from PIL import Image

from apps.accounts.models import User
from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"persist-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name="test-persist", owner=user)


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


def _make_image_results(n: int, dpo_used: float = 25.0) -> list[dict]:
    """Build synthetic per-image result dicts matching _build_batch_response shape."""
    results = []
    for i in range(n):
        results.append(
            {
                "index": i,
                "filename": f"proj_{i:03d}.png",
                "azimuth": float(i * 10),
                "elevation": 0.0,
                "fractal_dimension": 1.70 + 0.01 * i,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "error": None,
            }
        )
    return results


def _make_image_results_with_failures(
    n: int, fail_indices: list[int], dpo_used: float = 25.0
) -> list[dict]:
    """Build results with some failures."""
    results = _make_image_results(n, dpo_used)
    for idx in fail_indices:
        results[idx]["fractal_dimension"] = None
        results[idx]["prefactor"] = None
        results[idx]["r_squared"] = None
        results[idx]["n_particles_counted"] = None
        results[idx]["error"] = f"Analyzer failed for image {idx}"
    return results


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestPersistBatchResults:
    """Unit tests for persist_batch_results helper."""

    def test_creates_correct_number_of_image_rows(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results(5)
        png_list = [_make_png() for _ in range(5)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        assert FraktalBatchImage.objects.filter(batch=batch).count() == 5

    def test_image_rows_have_correct_metrics(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results(3)
        png_list = [_make_png() for _ in range(3)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        img0 = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img0.filename == "proj_000.png"
        assert img0.fractal_dimension == pytest.approx(1.70)
        assert img0.prefactor == pytest.approx(1.5)
        assert img0.r_squared == pytest.approx(0.99)
        assert img0.n_particles_counted == 42
        assert img0.dpo_used == pytest.approx(25.0)
        assert img0.error == ""
        assert img0.azimuth == pytest.approx(0.0)
        assert img0.elevation == pytest.approx(0.0)

    def test_png_bytes_round_trip(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results(1)
        png_bytes = _make_png(64)
        png_list = [png_bytes]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert bytes(img.image_png) == png_bytes

    def test_updates_batch_summary_fields(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results(3)
        png_list = [_make_png() for _ in range(3)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        batch.refresh_from_db()
        assert batch.n_images == 3
        assert batch.n_successful == 3
        expected_dfs = [1.70, 1.71, 1.72]
        assert batch.mean_df == pytest.approx(np.mean(expected_dfs))
        assert batch.std_df == pytest.approx(np.std(expected_dfs, ddof=0))
        assert batch.median_df == pytest.approx(np.median(expected_dfs))
        assert batch.min_df == pytest.approx(min(expected_dfs))
        assert batch.max_df == pytest.approx(max(expected_dfs))

    def test_partial_failure_stats_exclude_failed(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results_with_failures(5, fail_indices=[1, 3])
        png_list = [_make_png() for _ in range(5)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        batch.refresh_from_db()
        assert batch.n_images == 5
        assert batch.n_successful == 3
        # Successful: idx 0 (1.70), 2 (1.72), 4 (1.74)
        successful_dfs = [1.70, 1.72, 1.74]
        assert batch.mean_df == pytest.approx(np.mean(successful_dfs))

    def test_failed_images_have_error_and_null_df(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results_with_failures(3, fail_indices=[1])
        png_list = [_make_png() for _ in range(3)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        failed_img = FraktalBatchImage.objects.get(batch=batch, index=1)
        assert failed_img.fractal_dimension is None
        assert "failed" in failed_img.error.lower()
        # PNG is still stored even for failed images
        assert len(bytes(failed_img.image_png)) > 0
