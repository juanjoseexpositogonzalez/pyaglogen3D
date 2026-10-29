"""Tests for Phase 2 — batch distributions: rg_nm persistence + aggregate stats.

Covers:
- T2.1: rg_nm persistence on FraktalBatchImage
- T2.2: batch_detail_view returns rg_nm per image
- T2.3: aggregate stats (kf, rg, npo) in batch detail response
- T2.4: failed images excluded from stats
- T2.5: backward compat — legacy mean_df / std_df fields preserved

Spec: fraktal-batch-persistence-delta.md (R2, R3, R8 deltas).
"""

from __future__ import annotations

import io
import uuid

import numpy as np
import pytest
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"dist-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name=f"proj-dist-{uuid.uuid4()}", owner=user)


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


def _batch_detail_url(project_id, batch_id) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/"


def _image_detail_url(project_id, batch_id, index: int) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/images/{index}/"


# ===========================================================================
# T2.1 — rg_nm persistence
# ===========================================================================


@pytest.mark.django_db
class TestRgNmPersistence:
    """T2.1: rg_nm field on FraktalBatchImage and persist_batch_results."""

    def test_persist_stores_rg_nm_for_successful_images(self) -> None:
        """After persist_batch_results, DB rows have rg_nm populated."""
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        image_results = [
            {
                "index": 0,
                "filename": "img_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": 1.78,
                "prefactor": 1.4,
                "r_squared": 0.99,
                "n_particles_counted": 320,
                "error": None,
                "rg_nm": 152.3,
            },
            {
                "index": 1,
                "filename": "img_001.png",
                "azimuth": 10.0,
                "elevation": 0.0,
                "fractal_dimension": 1.82,
                "prefactor": 1.5,
                "r_squared": 0.98,
                "n_particles_counted": 290,
                "error": None,
                "rg_nm": 145.7,
            },
        ]
        png_list = [_make_png() for _ in range(2)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        img0 = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img0.rg_nm == pytest.approx(152.3)

        img1 = FraktalBatchImage.objects.get(batch=batch, index=1)
        assert img1.rg_nm == pytest.approx(145.7)

    def test_persist_stores_null_rg_nm_for_failed_images(self) -> None:
        """Failed images have rg_nm = NULL."""
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        image_results = [
            {
                "index": 0,
                "filename": "img_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": None,
                "prefactor": None,
                "r_squared": None,
                "n_particles_counted": None,
                "error": "Analyzer failed",
                "rg_nm": None,
            },
        ]
        png_list = [_make_png()]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        img0 = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img0.rg_nm is None

    def test_legacy_rows_without_rg_nm_default_null(self) -> None:
        """Rows created without rg_nm field should have NULL (pre-migration compat)."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        img = FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="legacy.png",
            dpo_used=25.0,
            image_png=_make_png(),
        )

        img.refresh_from_db()
        assert img.rg_nm is None


# ===========================================================================
# T2.2 — batch_detail_view returns rg_nm per image
# ===========================================================================


def _add_images_with_rg(
    batch: FraktalBatch,
    data: list[dict],
) -> list[FraktalBatchImage]:
    """Add image rows with rg_nm to a batch. Each dict in data has keys:
    fractal_dimension, prefactor, n_particles_counted, rg_nm, error.
    """
    imgs = []
    for i, d in enumerate(data):
        imgs.append(
            FraktalBatchImage.objects.create(
                batch=batch,
                index=i,
                filename=f"img_{i:03d}.png",
                azimuth=float(i * 10),
                elevation=0.0,
                fractal_dimension=d.get("fractal_dimension"),
                prefactor=d.get("prefactor"),
                r_squared=d.get("r_squared", 0.99),
                n_particles_counted=d.get("n_particles_counted"),
                rg_nm=d.get("rg_nm"),
                dpo_used=25.0,
                error=d.get("error", ""),
                image_png=_make_png(),
            )
        )
    n_successful = sum(1 for d in data if d.get("fractal_dimension") is not None)
    batch.n_images = len(data)
    batch.n_successful = n_successful
    dfs = [
        d["fractal_dimension"] for d in data if d.get("fractal_dimension") is not None
    ]
    if dfs:
        arr = np.array(dfs)
        batch.mean_df = float(arr.mean())
        batch.std_df = float(arr.std(ddof=0))
        batch.median_df = float(np.median(arr))
        batch.min_df = float(arr.min())
        batch.max_df = float(arr.max())
    batch.save()
    return imgs


@pytest.mark.django_db
class TestBatchDetailRgNm:
    """T2.2: batch_detail_view returns rg_nm per image."""

    def test_batch_detail_includes_rg_nm_per_image(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images_with_rg(
            batch,
            [
                {
                    "fractal_dimension": 1.78,
                    "prefactor": 1.4,
                    "n_particles_counted": 320,
                    "rg_nm": 152.3,
                },
                {
                    "fractal_dimension": 1.82,
                    "prefactor": 1.5,
                    "n_particles_counted": 290,
                    "rg_nm": 145.7,
                },
            ],
        )
        client = _authed_client(user)

        resp = client.get(_batch_detail_url(project.id, batch.id))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["images"]) == 2
        assert data["images"][0]["rg_nm"] == pytest.approx(152.3)
        assert data["images"][1]["rg_nm"] == pytest.approx(145.7)

    def test_batch_detail_rg_nm_null_for_failed_image(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images_with_rg(
            batch,
            [
                {
                    "fractal_dimension": 1.78,
                    "prefactor": 1.4,
                    "n_particles_counted": 320,
                    "rg_nm": 152.3,
                },
                {
                    "fractal_dimension": None,
                    "prefactor": None,
                    "n_particles_counted": None,
                    "rg_nm": None,
                    "error": "Failed",
                },
            ],
        )
        client = _authed_client(user)

        resp = client.get(_batch_detail_url(project.id, batch.id))
        data = resp.json()
        assert data["images"][0]["rg_nm"] == pytest.approx(152.3)
        assert data["images"][1]["rg_nm"] is None

    def test_drill_down_includes_rg_nm(self) -> None:
        """R3 delta: drill-down image detail also has rg_nm."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images_with_rg(
            batch,
            [
                {
                    "fractal_dimension": 1.78,
                    "prefactor": 1.4,
                    "n_particles_counted": 320,
                    "rg_nm": 145.7,
                },
            ],
        )
        client = _authed_client(user)

        resp = client.get(_image_detail_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        data = resp.json()
        assert data["rg_nm"] == pytest.approx(145.7)


# ===========================================================================
# T2.3 — Aggregate stats per metric + T2.4 — Failed images excluded
# ===========================================================================


@pytest.mark.django_db
class TestComputeMetricStats:
    """T2.3 / T2.4: compute_metric_stats helper — unit tests."""

    def test_basic_stats_for_known_values(self) -> None:
        from apps.fractal_analysis.services.batch import compute_metric_stats

        images = [
            {
                "fractal_dimension": 1.7,
                "prefactor": 1.3,
                "n_particles_counted": 300,
                "rg_nm": 150.0,
                "error": None,
            },
            {
                "fractal_dimension": 1.8,
                "prefactor": 1.5,
                "n_particles_counted": 350,
                "rg_nm": 160.0,
                "error": None,
            },
            {
                "fractal_dimension": 1.9,
                "prefactor": 1.4,
                "n_particles_counted": 400,
                "rg_nm": 170.0,
                "error": None,
            },
        ]
        result = compute_metric_stats(images, "rg_nm")
        assert result is not None
        assert result["mean"] == pytest.approx(160.0)
        assert result["median"] == pytest.approx(160.0)
        assert result["min"] == pytest.approx(150.0)
        assert result["max"] == pytest.approx(170.0)
        expected_std = float(np.std([150.0, 160.0, 170.0], ddof=0))
        assert result["std"] == pytest.approx(expected_std)

    def test_excludes_failed_images(self) -> None:
        """T2.4: failed images (error or null metric) excluded from stats."""
        from apps.fractal_analysis.services.batch import compute_metric_stats

        images = [
            {
                "fractal_dimension": 1.7,
                "prefactor": 1.3,
                "n_particles_counted": 300,
                "rg_nm": 150.0,
                "error": None,
            },
            {
                "fractal_dimension": None,
                "prefactor": None,
                "n_particles_counted": None,
                "rg_nm": None,
                "error": "Failed",
            },
            {
                "fractal_dimension": 1.9,
                "prefactor": 1.4,
                "n_particles_counted": 400,
                "rg_nm": 170.0,
                "error": None,
            },
        ]
        result = compute_metric_stats(images, "rg_nm")
        assert result is not None
        # Only 150.0 and 170.0
        assert result["mean"] == pytest.approx(160.0)
        assert result["min"] == pytest.approx(150.0)
        assert result["max"] == pytest.approx(170.0)

    def test_all_null_returns_null_stats(self) -> None:
        from apps.fractal_analysis.services.batch import compute_metric_stats

        images = [
            {"fractal_dimension": None, "rg_nm": None, "error": "Failed"},
            {"fractal_dimension": None, "rg_nm": None, "error": "Failed"},
        ]
        result = compute_metric_stats(images, "rg_nm")
        assert result is not None
        assert result["mean"] is None
        assert result["std"] is None
        assert result["median"] is None
        assert result["min"] is None
        assert result["max"] is None

    def test_single_value(self) -> None:
        from apps.fractal_analysis.services.batch import compute_metric_stats

        images = [
            {"fractal_dimension": 1.7, "rg_nm": 150.0, "error": None},
        ]
        result = compute_metric_stats(images, "rg_nm")
        assert result["mean"] == pytest.approx(150.0)
        assert result["std"] == pytest.approx(0.0)
        assert result["median"] == pytest.approx(150.0)

    def test_kf_metric(self) -> None:
        """Stats work for prefactor (kf)."""
        from apps.fractal_analysis.services.batch import compute_metric_stats

        images = [
            {"prefactor": 1.3, "error": None},
            {"prefactor": 1.5, "error": None},
        ]
        result = compute_metric_stats(images, "prefactor")
        assert result["mean"] == pytest.approx(1.4)

    def test_npo_metric(self) -> None:
        """Stats work for n_particles_counted (npo)."""
        from apps.fractal_analysis.services.batch import compute_metric_stats

        images = [
            {"n_particles_counted": 300, "error": None},
            {"n_particles_counted": 400, "error": None},
        ]
        result = compute_metric_stats(images, "n_particles_counted")
        assert result["mean"] == pytest.approx(350.0)


@pytest.mark.django_db
class TestBatchDetailAggregateStats:
    """T2.3: batch_detail_view includes stats.{kf,rg,npo} block."""

    def test_stats_block_has_kf_rg_npo(self) -> None:
        """Scenario 8.1: full stats for all four metrics."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images_with_rg(
            batch,
            [
                {
                    "fractal_dimension": 1.78,
                    "prefactor": 1.4,
                    "n_particles_counted": 320,
                    "rg_nm": 152.3,
                },
                {
                    "fractal_dimension": 1.82,
                    "prefactor": 1.5,
                    "n_particles_counted": 290,
                    "rg_nm": 145.7,
                },
                {
                    "fractal_dimension": 1.75,
                    "prefactor": 1.3,
                    "n_particles_counted": 350,
                    "rg_nm": 160.0,
                },
            ],
        )
        client = _authed_client(user)

        resp = client.get(_batch_detail_url(project.id, batch.id))
        assert resp.status_code == 200
        stats = resp.json()["stats"]

        # kf stats
        assert "kf" in stats
        assert stats["kf"]["mean"] == pytest.approx(np.mean([1.4, 1.5, 1.3]))
        assert stats["kf"]["min"] == pytest.approx(1.3)
        assert stats["kf"]["max"] == pytest.approx(1.5)

        # rg stats
        assert "rg" in stats
        assert stats["rg"]["mean"] == pytest.approx(np.mean([152.3, 145.7, 160.0]))
        assert stats["rg"]["min"] == pytest.approx(145.7)
        assert stats["rg"]["max"] == pytest.approx(160.0)

        # npo stats
        assert "npo" in stats
        assert stats["npo"]["mean"] == pytest.approx(np.mean([320, 290, 350]))

    def test_stats_failed_images_excluded(self) -> None:
        """Scenario 8.3: partial failure — per-metric null handling."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images_with_rg(
            batch,
            [
                {
                    "fractal_dimension": 1.78,
                    "prefactor": 1.4,
                    "n_particles_counted": 320,
                    "rg_nm": 152.3,
                },
                {
                    "fractal_dimension": None,
                    "prefactor": None,
                    "n_particles_counted": None,
                    "rg_nm": None,
                    "error": "Failed",
                },
                {
                    "fractal_dimension": 1.75,
                    "prefactor": 1.3,
                    "n_particles_counted": 350,
                    "rg_nm": 160.0,
                },
            ],
        )
        client = _authed_client(user)

        resp = client.get(_batch_detail_url(project.id, batch.id))
        stats = resp.json()["stats"]

        # rg: computed only over 2 successful values
        assert stats["rg"]["mean"] == pytest.approx(np.mean([152.3, 160.0]))
        assert stats["rg"]["min"] == pytest.approx(152.3)
        assert stats["rg"]["max"] == pytest.approx(160.0)

    def test_all_failed_stats_null(self) -> None:
        """Scenario 8.2: all images failed → stats are null."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images_with_rg(
            batch,
            [
                {
                    "fractal_dimension": None,
                    "prefactor": None,
                    "n_particles_counted": None,
                    "rg_nm": None,
                    "error": "Failed",
                },
                {
                    "fractal_dimension": None,
                    "prefactor": None,
                    "n_particles_counted": None,
                    "rg_nm": None,
                    "error": "Failed",
                },
            ],
        )
        client = _authed_client(user)

        resp = client.get(_batch_detail_url(project.id, batch.id))
        stats = resp.json()["stats"]

        for metric in ("kf", "rg", "npo"):
            assert stats[metric]["mean"] is None
            assert stats[metric]["std"] is None
            assert stats[metric]["median"] is None
            assert stats[metric]["min"] is None
            assert stats[metric]["max"] is None

    def test_backward_compat_legacy_df_fields_preserved(self) -> None:
        """Scenario 8.4: legacy mean_df, std_df fields still present."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images_with_rg(
            batch,
            [
                {
                    "fractal_dimension": 1.78,
                    "prefactor": 1.4,
                    "n_particles_counted": 320,
                    "rg_nm": 152.3,
                },
                {
                    "fractal_dimension": 1.82,
                    "prefactor": 1.5,
                    "n_particles_counted": 290,
                    "rg_nm": 145.7,
                },
            ],
        )
        client = _authed_client(user)

        resp = client.get(_batch_detail_url(project.id, batch.id))
        stats = resp.json()["stats"]

        # Legacy fields must be present and correct
        assert "mean_df" in stats
        assert "std_df" in stats
        assert "median_df" in stats
        assert "min_df" in stats
        assert "max_df" in stats
        assert "n_images" in stats
        assert "n_successful" in stats
        assert stats["mean_df"] == pytest.approx(np.mean([1.78, 1.82]))
        assert stats["n_successful"] == 2


@pytest.mark.django_db
class TestSerializeBatchFromDb:
    """_serialize_batch_from_db also includes aggregate stats + rg_nm."""

    def test_serialize_includes_rg_nm_and_aggregate_stats(self) -> None:
        from apps.fractal_analysis.views import _serialize_batch_from_db

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images_with_rg(
            batch,
            [
                {
                    "fractal_dimension": 1.78,
                    "prefactor": 1.4,
                    "n_particles_counted": 320,
                    "rg_nm": 152.3,
                },
                {
                    "fractal_dimension": 1.82,
                    "prefactor": 1.5,
                    "n_particles_counted": 290,
                    "rg_nm": 145.7,
                },
            ],
        )

        payload = _serialize_batch_from_db(str(batch.id))
        assert payload is not None

        # rg_nm per image
        assert payload["images"][0]["rg_nm"] == pytest.approx(152.3)
        assert payload["images"][1]["rg_nm"] == pytest.approx(145.7)

        # aggregate stats
        stats = payload["stats"]
        assert "kf" in stats
        assert stats["kf"]["mean"] == pytest.approx(np.mean([1.4, 1.5]))
        assert "rg" in stats
        assert stats["rg"]["mean"] == pytest.approx(np.mean([152.3, 145.7]))
        assert "npo" in stats

        # legacy fields preserved
        assert "mean_df" in stats
        assert stats["mean_df"] == pytest.approx(np.mean([1.78, 1.82]))


@pytest.mark.django_db
class TestBuildBatchResponse:
    """_build_batch_response includes aggregate stats from engine output."""

    def test_build_response_includes_aggregate_stats(self) -> None:
        from apps.fractal_analysis.views import _build_batch_response

        rust_result = {
            "results": [
                {
                    "fractal_dimension": 1.78,
                    "prefactor": 1.4,
                    "r_squared": 0.99,
                    "n_particles_counted": 320,
                    "rg_nm": 152.3,
                    "error": None,
                },
                {
                    "fractal_dimension": 1.82,
                    "prefactor": 1.5,
                    "r_squared": 0.98,
                    "n_particles_counted": 290,
                    "rg_nm": 145.7,
                    "error": None,
                },
            ],
            "dpo_used": 25.0,
        }
        filenames = ["img_000.png", "img_001.png"]

        payload = _build_batch_response(
            rust_result, filenames, None, None, 500.0, "metadata"
        )

        stats = payload["stats"]
        assert "kf" in stats
        assert stats["kf"]["mean"] == pytest.approx(np.mean([1.4, 1.5]))
        assert "rg" in stats
        assert stats["rg"]["mean"] == pytest.approx(np.mean([152.3, 145.7]))
        assert "npo" in stats
        assert stats["npo"]["mean"] == pytest.approx(np.mean([320, 290]))
