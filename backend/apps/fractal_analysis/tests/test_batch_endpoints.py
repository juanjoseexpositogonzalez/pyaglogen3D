"""Integration tests for Phase 4 batch endpoints.

Covers:
- GET /api/v1/projects/{pk}/fraktal/batches/{batchId}/  (batch detail)
- GET .../images/{index}/  (drill-down image detail)
- GET .../images/{index}/png/  (PNG bytes)
- POST .../images/{index}/reanalyze/  (re-analyze)
- DELETE /api/v1/projects/{pk}/fraktal/batches/{batchId}/  (delete cascade)
- GET .../batches/{batchId}/csv/  (batch CSV)
- GET .../fraktal/{analysisId}/csv/  (single-image CSV)

Spec: fraktal-batch-persistence.md (R3-R10), csv-export-locale.md (R3-R4).
"""

from __future__ import annotations

import io
import uuid

import pytest
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.fractal_analysis.models import (
    FraktalAnalysis,
    FraktalBatch,
    FraktalBatchImage,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user(**kwargs) -> User:
    email = kwargs.pop("email", f"ep-{uuid.uuid4()}@example.com")
    return User.objects.create_user(email=email, password="irrelevant", **kwargs)


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name=f"proj-{uuid.uuid4()}", owner=user)


def _make_png(size: int = 32) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (size, size), 128).save(buf, format="PNG")
    return buf.getvalue()


def _make_batch(project, user: User, **kwargs) -> FraktalBatch:
    defaults = dict(
        project=project,
        created_by=user,
        algorithm="granulated_2012",
        calibration_source="metadata",
        pixels_per_100nm=500.0,
        dpo_used=25.0,
    )
    defaults.update(kwargs)
    return FraktalBatch.objects.create(**defaults)


def _add_images(
    batch: FraktalBatch, n: int, *, png_bytes: bytes | None = None
) -> list[FraktalBatchImage]:
    """Add N image rows to a batch. Returns the created rows."""
    imgs = []
    for i in range(n):
        imgs.append(
            FraktalBatchImage.objects.create(
                batch=batch,
                index=i,
                filename=f"proj_{i:03d}.png",
                azimuth=float(i * 10),
                elevation=0.0,
                fractal_dimension=1.70 + 0.01 * i if i % 3 != 2 else None,
                prefactor=1.5 if i % 3 != 2 else None,
                r_squared=0.99 if i % 3 != 2 else None,
                n_particles_counted=42 if i % 3 != 2 else None,
                dpo_used=25.0,
                error="" if i % 3 != 2 else "Analyzer failed",
                image_png=png_bytes or _make_png(),
            )
        )
    # Update batch summary fields
    batch.n_images = n
    successful = [img for img in imgs if img.fractal_dimension is not None]
    batch.n_successful = len(successful)
    if successful:
        dfs = [img.fractal_dimension for img in successful]
        import numpy as np

        arr = np.array(dfs)
        batch.mean_df = float(arr.mean())
        batch.std_df = float(arr.std(ddof=0))
        batch.median_df = float(np.median(arr))
        batch.min_df = float(arr.min())
        batch.max_df = float(arr.max())
    batch.save()
    return imgs


def _batch_detail_url(project_id, batch_id) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/"


def _image_detail_url(project_id, batch_id, index: int) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/images/{index}/"


def _image_png_url(project_id, batch_id, index: int) -> str:
    return (
        f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/images/{index}/png/"
    )


def _reanalyze_url(project_id, batch_id, index: int) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/images/{index}/reanalyze/"


def _batch_delete_url(project_id, batch_id) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/"


def _batch_csv_url(project_id, batch_id) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/csv/"


def _single_csv_url(project_id, analysis_id) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/{analysis_id}/csv/"


# ===========================================================================
# T4.1 — Batch detail endpoint
# ===========================================================================


@pytest.mark.django_db
class TestBatchDetailEndpoint:
    """R8: GET /api/v1/projects/{pk}/fraktal/batches/{batchId}/"""

    def test_batch_detail_returns_200_with_images(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 3)
        client = _authed_client(user)

        resp = client.get(_batch_detail_url(project.id, batch.id))
        assert resp.status_code == 200
        data = resp.json()
        assert data["batch_id"] == str(batch.id)
        assert len(data["images"]) == 3

    def test_batch_detail_cross_project_returns_404(self) -> None:
        """R1 Scenario 1.3 — cross-project isolation."""
        owner = _make_user()
        other = _make_user()
        project_a = _make_project(owner)
        project_b = _make_project(other)
        batch = _make_batch(project_a, owner)
        _add_images(batch, 2)
        client = _authed_client(other)

        resp = client.get(_batch_detail_url(project_b.id, batch.id))
        assert resp.status_code == 404

    def test_batch_detail_nonexistent_returns_404(self) -> None:
        user = _make_user()
        project = _make_project(user)
        client = _authed_client(user)

        resp = client.get(_batch_detail_url(project.id, uuid.uuid4()))
        assert resp.status_code == 404


# ===========================================================================
# T4.2 — Image drill-down detail endpoint
# ===========================================================================


@pytest.mark.django_db
class TestImageDrilldownEndpoint:
    """R3: drill-down single image detail."""

    def test_first_image_prev_null_next_1(self) -> None:
        """Scenario 3.1 — first image boundary."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 10)
        client = _authed_client(user)

        resp = client.get(_image_detail_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        data = resp.json()
        assert data["prev_index"] is None
        assert data["next_index"] == 1
        assert data["index"] == 0

    def test_last_image_prev_8_next_null(self) -> None:
        """Scenario 3.2 — last image boundary."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 10)
        client = _authed_client(user)

        resp = client.get(_image_detail_url(project.id, batch.id, 9))
        assert resp.status_code == 200
        data = resp.json()
        assert data["prev_index"] == 8
        assert data["next_index"] is None

    def test_out_of_range_index_returns_404(self) -> None:
        """Scenario 3.3 — index out of range."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 10)
        client = _authed_client(user)

        resp = client.get(_image_detail_url(project.id, batch.id, 99))
        assert resp.status_code == 404

    def test_cross_project_returns_404(self) -> None:
        """Scenario 3.4 — cross-project access."""
        owner = _make_user()
        other = _make_user()
        project_a = _make_project(owner)
        project_b = _make_project(other)
        batch = _make_batch(project_a, owner)
        _add_images(batch, 3)
        client = _authed_client(other)

        resp = client.get(_image_detail_url(project_b.id, batch.id, 0))
        assert resp.status_code == 404

    def test_image_detail_has_metrics(self) -> None:
        """Drill-down includes fractal_dimension, filename, dpo_used."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 3)
        client = _authed_client(user)

        resp = client.get(_image_detail_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        data = resp.json()
        assert data["filename"] == "proj_000.png"
        assert data["dpo_used"] == pytest.approx(25.0)
        assert data["fractal_dimension"] == pytest.approx(1.70)

    def test_image_detail_includes_batch_calibration_fields(self) -> None:
        """Drill-down includes pixels_per_100nm and autocalibrate_source from
        the parent batch — needed for diagnostic metadata on failed images (C1).
        """
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(
            project,
            user,
            pixels_per_100nm=420.5,
            autocalibrate_source="image_0",
        )
        _add_images(batch, 2)
        client = _authed_client(user)

        resp = client.get(_image_detail_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        data = resp.json()
        assert data["pixels_per_100nm"] == pytest.approx(420.5)
        assert data["autocalibrate_source"] == "image_0"

    def test_image_detail_autocalibrate_source_null_when_manual(self) -> None:
        """When calibration_source is manual, autocalibrate_source is null."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(
            project,
            user,
            calibration_source="manual",
            autocalibrate_source=None,
        )
        _add_images(batch, 1)
        client = _authed_client(user)

        resp = client.get(_image_detail_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        data = resp.json()
        assert data["pixels_per_100nm"] == pytest.approx(500.0)
        assert data["autocalibrate_source"] is None


# ===========================================================================
# T4.3 — PNG bytes endpoint
# ===========================================================================


@pytest.mark.django_db
class TestPngBytesEndpoint:
    """R4: per-image PNG endpoint."""

    def test_png_returns_image_bytes(self) -> None:
        """Scenario 4.1 — PNG present."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        png_data = _make_png(64)
        _add_images(batch, 1, png_bytes=png_data)
        client = _authed_client(user)

        resp = client.get(_image_png_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        assert resp["Content-Type"] == "image/png"
        assert bytes(resp.content) == png_data

    def test_png_cache_headers(self) -> None:
        """Q1 LOCKED: Cache-Control: public, max-age=31536000, immutable."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 1)
        client = _authed_client(user)

        resp = client.get(_image_png_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        cc = resp.get("Cache-Control", "")
        assert "public" in cc
        assert "max-age=31536000" in cc
        assert "immutable" in cc

    def test_png_empty_bytes_returns_400(self) -> None:
        """Scenario 4.2 — empty PNG bytes."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="empty.png",
            dpo_used=25.0,
            image_png=b"",
        )
        batch.n_images = 1
        batch.save()
        client = _authed_client(user)

        resp = client.get(_image_png_url(project.id, batch.id, 0))
        assert resp.status_code == 400

    def test_png_cross_project_returns_404(self) -> None:
        """Scenario 4.3 — non-owner."""
        owner = _make_user()
        other = _make_user()
        project_a = _make_project(owner)
        project_b = _make_project(other)
        batch = _make_batch(project_a, owner)
        _add_images(batch, 1)
        client = _authed_client(other)

        resp = client.get(_image_png_url(project_b.id, batch.id, 0))
        assert resp.status_code == 404


# ===========================================================================
# T4.4 — Re-analyze endpoint
# ===========================================================================


@pytest.mark.django_db
class TestReanalyzeEndpoint:
    """R5: re-analyze creates persistent FraktalAnalysis."""

    def test_reanalyze_creates_fraktal_analysis(self) -> None:
        """Scenario 5.1 — happy path."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 1)
        client = _authed_client(user)

        resp = client.post(_reanalyze_url(project.id, batch.id, 0))
        assert resp.status_code == 201
        data = resp.json()
        assert "id" in data
        # FraktalAnalysis row must exist
        analysis = FraktalAnalysis.objects.get(id=data["id"])
        assert analysis.project_id == project.id
        assert analysis.dpo == pytest.approx(25.0)  # inherited from batch dpo_used

    def test_reanalyze_missing_png_returns_400(self) -> None:
        """Scenario 5.2 — empty PNG bytes."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="empty.png",
            dpo_used=25.0,
            image_png=b"",
        )
        batch.n_images = 1
        batch.save()
        client = _authed_client(user)

        resp = client.post(_reanalyze_url(project.id, batch.id, 0))
        assert resp.status_code == 400

    def test_reanalyze_multiple_creates_distinct_rows(self) -> None:
        """Scenario 5.3 — multiple re-analyses."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 1)
        client = _authed_client(user)

        ids = set()
        for _ in range(3):
            resp = client.post(_reanalyze_url(project.id, batch.id, 0))
            assert resp.status_code == 201
            ids.add(resp.json()["id"])
        assert len(ids) == 3

    def test_reanalyze_cross_project_returns_404(self) -> None:
        """Scenario 5.4 — non-owner."""
        owner = _make_user()
        other = _make_user()
        project_a = _make_project(owner)
        project_b = _make_project(other)
        batch = _make_batch(project_a, owner)
        _add_images(batch, 1)
        client = _authed_client(other)

        resp = client.post(_reanalyze_url(project_b.id, batch.id, 0))
        assert resp.status_code == 404


# ===========================================================================
# T4.5 — Delete batch endpoint
# ===========================================================================


@pytest.mark.django_db
class TestDeleteBatchEndpoint:
    """R6: DELETE cascade."""

    def test_delete_returns_204_and_removes_batch(self) -> None:
        """Scenario 6.1 — empty batch."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        client = _authed_client(user)

        resp = client.delete(_batch_delete_url(project.id, batch.id))
        assert resp.status_code == 204
        assert not FraktalBatch.objects.filter(id=batch.id).exists()

    def test_delete_cascades_images_preserves_reanalyses(self) -> None:
        """Scenario 6.2 — cascade + preserve re-analyses."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 3)

        # Create re-analyses (standalone FraktalAnalysis rows)
        analysis = FraktalAnalysis.objects.create(
            project=project,
            model="granulated_2012",
            npix=500.0,
            dpo=25.0,
            original_image=_make_png(),
            original_filename="reanalyzed.png",
            original_content_type="image/png",
        )
        client = _authed_client(user)

        resp = client.delete(_batch_delete_url(project.id, batch.id))
        assert resp.status_code == 204
        assert not FraktalBatch.objects.filter(id=batch.id).exists()
        assert FraktalBatchImage.objects.filter(batch_id=batch.id).count() == 0
        # Re-analysis is independent — must survive
        assert FraktalAnalysis.objects.filter(id=analysis.id).exists()

    def test_delete_cross_project_returns_404(self) -> None:
        """Scenario 6.3 — non-owner."""
        owner = _make_user()
        other = _make_user()
        project_a = _make_project(owner)
        project_b = _make_project(other)
        batch = _make_batch(project_a, owner)
        client = _authed_client(other)

        resp = client.delete(_batch_delete_url(project_b.id, batch.id))
        assert resp.status_code == 404
        # Batch still exists
        assert FraktalBatch.objects.filter(id=batch.id).exists()

    def test_delete_nonexistent_returns_404(self) -> None:
        user = _make_user()
        project = _make_project(user)
        client = _authed_client(user)

        resp = client.delete(_batch_delete_url(project.id, uuid.uuid4()))
        assert resp.status_code == 404


# ===========================================================================
# T4.6 — Batch CSV endpoint
# ===========================================================================


@pytest.mark.django_db
class TestBatchCsvEndpoint:
    """R4 csv-export-locale: batch CSV."""

    def test_batch_csv_returns_text_csv(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 3)
        client = _authed_client(user)

        resp = client.get(_batch_csv_url(project.id, batch.id))
        assert resp.status_code == 200
        assert "text/csv" in resp["Content-Type"]

    def test_batch_csv_has_header_data_and_summary(self) -> None:
        """Scenario 4.1 — complete batch CSV structure."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 3)
        client = _authed_client(user)

        resp = client.get(_batch_csv_url(project.id, batch.id))
        assert resp.status_code == 200
        content = resp.content.decode("utf-8")
        lines = content.strip().split("\n")
        # header + 3 data rows + blank + summary = 6 lines minimum
        assert len(lines) >= 6
        # First line is the header
        assert "index" in lines[0].lower()
        # Last line starts with SUMMARY
        assert lines[-1].startswith("SUMMARY")

    def test_batch_csv_es_ar_locale(self) -> None:
        """CSV with comma decimal + semicolon delimiter (es-AR)."""
        user = _make_user(
            csv_decimal_separator=",",
            csv_column_delimiter=";",
        )
        project = _make_project(user)
        batch = _make_batch(project, user)
        # All-success, single image
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="test.png",
            fractal_dimension=1.75,
            prefactor=1.5,
            r_squared=0.99,
            n_particles_counted=42,
            dpo_used=25.0,
            error="",
            image_png=_make_png(),
        )
        batch.n_images = 1
        batch.n_successful = 1
        batch.mean_df = 1.75
        batch.save()
        client = _authed_client(user)

        resp = client.get(_batch_csv_url(project.id, batch.id))
        assert resp.status_code == 200
        content = resp.content.decode("utf-8")
        # Semicolons as delimiter
        assert ";" in content
        # Data row has comma decimals for Df=1.75 → "1,75"
        data_line = content.strip().split("\n")[1]  # first data row
        assert "1,75" in data_line

    def test_batch_csv_en_us_locale(self) -> None:
        """CSV with period decimal + comma delimiter (en-US)."""
        user = _make_user(
            csv_decimal_separator=".",
            csv_column_delimiter=",",
        )
        project = _make_project(user)
        batch = _make_batch(project, user)
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="test.png",
            fractal_dimension=1.75,
            prefactor=1.5,
            r_squared=0.99,
            n_particles_counted=42,
            dpo_used=25.0,
            error="",
            image_png=_make_png(),
        )
        batch.n_images = 1
        batch.n_successful = 1
        batch.mean_df = 1.75
        batch.save()
        client = _authed_client(user)

        resp = client.get(_batch_csv_url(project.id, batch.id))
        assert resp.status_code == 200
        content = resp.content.decode("utf-8")
        data_line = content.strip().split("\n")[1]
        # Period decimal for Df=1.75
        assert "1.75" in data_line

    def test_batch_csv_all_failed_summary_stats_empty(self) -> None:
        """All-failed batch → summary stats are empty."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="bad.png",
            fractal_dimension=None,
            dpo_used=25.0,
            error="Analyzer failed",
            image_png=_make_png(),
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=1,
            filename="bad2.png",
            fractal_dimension=None,
            dpo_used=25.0,
            error="Analyzer failed",
            image_png=_make_png(),
        )
        batch.n_images = 2
        batch.n_successful = 0
        batch.save()
        client = _authed_client(user)

        resp = client.get(_batch_csv_url(project.id, batch.id))
        assert resp.status_code == 200
        content = resp.content.decode("utf-8")
        lines = content.strip().split("\n")
        summary_line = lines[-1]
        assert summary_line.startswith("SUMMARY")

    def test_batch_csv_cross_project_returns_404(self) -> None:
        owner = _make_user()
        other = _make_user()
        project_a = _make_project(owner)
        project_b = _make_project(other)
        batch = _make_batch(project_a, owner)
        _add_images(batch, 1)
        client = _authed_client(other)

        resp = client.get(_batch_csv_url(project_b.id, batch.id))
        assert resp.status_code == 404


# ===========================================================================
# T4.7 — Single-image CSV endpoint
# ===========================================================================


@pytest.mark.django_db
class TestSingleImageCsvEndpoint:
    """R3 csv-export-locale: single FraktalAnalysis CSV."""

    def test_single_csv_returns_text_csv(self) -> None:
        user = _make_user()
        project = _make_project(user)
        analysis = FraktalAnalysis.objects.create(
            project=project,
            model="granulated_2012",
            npix=500.0,
            dpo=25.0,
            original_image=_make_png(),
            original_filename="test.png",
            original_content_type="image/png",
        )
        client = _authed_client(user)

        resp = client.get(_single_csv_url(project.id, analysis.id))
        assert resp.status_code == 200
        assert "text/csv" in resp["Content-Type"]

    def test_single_csv_has_header_and_one_data_row(self) -> None:
        user = _make_user()
        project = _make_project(user)
        analysis = FraktalAnalysis.objects.create(
            project=project,
            model="granulated_2012",
            npix=500.0,
            dpo=25.0,
            original_image=_make_png(),
            original_filename="test.png",
            original_content_type="image/png",
            results={
                "df": 1.75,
                "kf": 1.5,
                "r_squared": 0.99,
                "n_particles": 42,
                "rg": 100.0,
                "ap": 50.0,
                "volume": 1e6,
                "mass": 1e-12,
                "surface_area": 5e4,
            },
        )
        client = _authed_client(user)

        resp = client.get(_single_csv_url(project.id, analysis.id))
        content = resp.content.decode("utf-8")
        lines = [l for l in content.strip().split("\n") if l.strip()]
        assert len(lines) == 2  # header + 1 data row

    def test_single_csv_cross_project_returns_404(self) -> None:
        owner = _make_user()
        other = _make_user()
        project_a = _make_project(owner)
        project_b = _make_project(other)
        analysis = FraktalAnalysis.objects.create(
            project=project_a,
            model="granulated_2012",
            npix=500.0,
            dpo=25.0,
            original_image=_make_png(),
            original_filename="test.png",
            original_content_type="image/png",
        )
        client = _authed_client(other)

        resp = client.get(_single_csv_url(project_b.id, analysis.id))
        assert resp.status_code == 404


# ===========================================================================
# Batch list endpoint (hotfix: dashboard gap)
# ===========================================================================


def _batch_list_url(project_id) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/batches/"


@pytest.mark.django_db
class TestBatchListEndpoint:
    """GET /api/v1/projects/{pk}/fraktal/batches/ — paginated batch list."""

    def test_list_returns_batches_sorted_by_created_at_desc(self) -> None:
        """Two batches → returned newest first."""
        user = _make_user()
        project = _make_project(user)
        b1 = _make_batch(project, user)
        _add_images(b1, 2)
        b2 = _make_batch(project, user)
        _add_images(b2, 3)
        client = _authed_client(user)

        resp = client.get(_batch_list_url(project.id))
        assert resp.status_code == 200
        data = resp.json()
        assert "results" in data
        assert "count" in data
        assert data["count"] == 2
        assert len(data["results"]) == 2
        # Newest first
        assert data["results"][0]["id"] == str(b2.id)
        assert data["results"][1]["id"] == str(b1.id)

    def test_list_empty_project_returns_empty(self) -> None:
        """No batches → count=0, results=[]."""
        user = _make_user()
        project = _make_project(user)
        client = _authed_client(user)

        resp = client.get(_batch_list_url(project.id))
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 0
        assert data["results"] == []

    def test_list_cross_project_returns_empty(self) -> None:
        """User queries own project that has no batches,
        other user's batches are invisible (403 cross-project)."""
        owner = _make_user()
        other = _make_user()
        project_a = _make_project(owner)
        project_b = _make_project(other)
        batch = _make_batch(project_a, owner)
        _add_images(batch, 2)
        client = _authed_client(other)

        # Other user queries their OWN project → batch from project_a is invisible
        resp = client.get(_batch_list_url(project_b.id))
        assert resp.status_code == 200
        assert resp.json()["count"] == 0

    def test_list_unauthenticated_rejected(self) -> None:
        client = APIClient()
        resp = client.get(_batch_list_url(uuid.uuid4()))
        assert resp.status_code in (401, 403)

    def test_list_item_shape(self) -> None:
        """Each item has expected fields (no images array)."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 5)
        client = _authed_client(user)

        resp = client.get(_batch_list_url(project.id))
        assert resp.status_code == 200
        item = resp.json()["results"][0]
        # Required fields
        assert "id" in item
        assert "status" in item
        assert "created_at" in item
        assert "n_images" in item
        assert "mean_df" in item
        assert "algorithm" in item
        assert "dpo_used" in item
        # Must NOT include per-image array (that's in detail endpoint)
        assert "images" not in item

    def test_list_only_own_project_visible(self) -> None:
        """Batches from other projects do not leak."""
        user = _make_user()
        project_a = _make_project(user)
        project_b = _make_project(user)
        _make_batch(project_a, user)
        b2 = _make_batch(project_b, user)
        _add_images(b2, 1)
        client = _authed_client(user)

        resp = client.get(_batch_list_url(project_b.id))
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 1
        assert data["results"][0]["id"] == str(b2.id)

    def test_batch_with_zero_successful_has_status_completed(self) -> None:
        """Hotfix: batch with n_successful=0 must return status='completed',
        never 'empty'. The lifecycle status is orthogonal to data quality."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        # Simulate all-failed batch: n_images=2, n_successful=0
        batch.n_images = 2
        batch.n_successful = 0
        batch.save()
        client = _authed_client(user)

        resp = client.get(_batch_list_url(project.id))
        assert resp.status_code == 200
        item = resp.json()["results"][0]
        assert item["status"] == "completed"

    def test_batch_status_always_in_canonical_set(self) -> None:
        """Every batch status returned by batch_list must belong to the
        canonical set: completed, running, queued, failed, cancelled."""
        canonical = {"completed", "running", "queued", "failed", "cancelled"}
        user = _make_user()
        project = _make_project(user)
        # Batch with successful images
        b1 = _make_batch(project, user)
        _add_images(b1, 3)
        # Batch with zero successful images (default n_successful=0)
        b2 = _make_batch(project, user)
        b2.n_images = 5
        b2.n_successful = 0
        b2.save()
        client = _authed_client(user)

        resp = client.get(_batch_list_url(project.id))
        assert resp.status_code == 200
        for item in resp.json()["results"]:
            assert item["status"] in canonical, (
                f"status '{item['status']}' not in canonical set {canonical}"
            )
