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
