"""PYA-13 T3.7/T3.8 — Cross-cutting integration test for bisection diagnostics.

End-to-end: synthetic engine result → persist_batch_results → DB →
batch_image_detail_view → batch_detail_view → verify fields, counters,
mean_df_inclusive.
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
from apps.fractal_analysis.services.batch import persist_batch_results


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"pipeline-{uuid.uuid4()}@example.com", password="x"
    )


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name="test-pipeline", owner=user)


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
    """Simulate engine output with mixed quality states."""
    return [
        # 0: converged
        {
            "index": 0,
            "filename": "img_000.png",
            "azimuth": 0.0,
            "elevation": 0.0,
            "fractal_dimension": 1.82,
            "prefactor": 1.5,
            "r_squared": 0.99,
            "n_particles_counted": 42,
            "error": None,
            "quality": "converged",
            "bisection_iterations": 12,
            "bisection_residual": 0.04,
            "failure_reason": "none",
            "df_estimate": 1.82,
        },
        # 1: converged
        {
            "index": 1,
            "filename": "img_001.png",
            "azimuth": 10.0,
            "elevation": 0.0,
            "fractal_dimension": 1.78,
            "prefactor": 1.4,
            "r_squared": 0.98,
            "n_particles_counted": 38,
            "error": None,
            "quality": "converged",
            "bisection_iterations": 15,
            "bisection_residual": 0.02,
            "failure_reason": "none",
            "df_estimate": 1.78,
        },
        # 2: approximate
        {
            "index": 2,
            "filename": "img_002.png",
            "azimuth": 20.0,
            "elevation": 0.0,
            "fractal_dimension": None,
            "prefactor": None,
            "r_squared": None,
            "n_particles_counted": None,
            "error": None,
            "quality": "approximate",
            "bisection_iterations": 50,
            "bisection_residual": 0.5,
            "failure_reason": "iteration_limit",
            "df_estimate": 1.70,
        },
        # 3: excluded
        {
            "index": 3,
            "filename": "img_003.png",
            "azimuth": 30.0,
            "elevation": 0.0,
            "fractal_dimension": None,
            "prefactor": None,
            "r_squared": None,
            "n_particles_counted": None,
            "error": None,
            "quality": "excluded",
            "bisection_iterations": None,
            "bisection_residual": None,
            "failure_reason": "no_sign_change",
            "df_estimate": None,
        },
        # 4: engine says converged BUT error is set → override to failed
        {
            "index": 4,
            "filename": "blank.png",
            "azimuth": 40.0,
            "elevation": 0.0,
            "fractal_dimension": None,
            "prefactor": None,
            "r_squared": None,
            "n_particles_counted": None,
            "error": "No particles found",
            "quality": "converged",  # engine bug
            "bisection_iterations": None,
            "bisection_residual": None,
            "failure_reason": None,
            "df_estimate": None,
        },
    ]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestBisectionDiagnosticPipeline:
    """Cross-cutting: engine result → persist → detail view → batch stats."""

    def test_full_pipeline(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        results = _synthetic_engine_results()
        png_list = [_make_png() for _ in results]

        # 1. Persist
        persist_batch_results(batch, results, png_list, dpo_used=25.0)

        # 2. Verify DB rows
        imgs = FraktalBatchImage.objects.filter(batch=batch).order_by("index")
        assert imgs.count() == 5

        # converged
        assert imgs[0].quality == "converged"
        assert imgs[0].bisection_iterations == 12
        assert imgs[0].bisection_residual == pytest.approx(0.04)
        assert imgs[0].df_estimate == pytest.approx(1.82)

        # approximate
        assert imgs[2].quality == "approximate"
        assert imgs[2].failure_reason == "iteration_limit"
        assert imgs[2].df_estimate == pytest.approx(1.70)

        # excluded
        assert imgs[3].quality == "excluded"
        assert imgs[3].failure_reason == "no_sign_change"

        # CRITICAL: quality override for error image
        assert imgs[4].quality == "failed"
        assert imgs[4].error == "No particles found"

        # 3. Drill-down view returns new fields
        client = _authed_client(user)
        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/images/0/"
        resp = client.get(url)
        assert resp.status_code == 200
        data = resp.json()
        assert data["quality"] == "converged"
        assert data["bisection_iterations"] == 12
        assert data["bisection_residual"] == pytest.approx(0.04)
        assert data["failure_reason"] == "none"
        assert data["df_estimate"] == pytest.approx(1.82)

        # 4. Batch detail view has counters + mean_df_inclusive
        batch.n_images = 5
        batch.n_successful = 2
        batch.save(update_fields=["n_images", "n_successful"])

        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"
        resp = client.get(url)
        assert resp.status_code == 200
        stats = resp.json()["stats"]

        assert stats["n_converged"] == 2
        assert stats["n_approximate"] == 1
        assert stats["n_excluded"] == 1
        assert stats["n_failed"] == 1

        # mean_df: converged only (1.82, 1.78)
        assert stats["mean_df"] == pytest.approx(float(np.mean([1.82, 1.78])))
        # mean_df_inclusive: converged + approximate (1.82, 1.78, 1.70)
        assert stats["mean_df_inclusive"] == pytest.approx(
            float(np.mean([1.82, 1.78, 1.70]))
        )
        assert stats["mean_df"] != stats["mean_df_inclusive"]
