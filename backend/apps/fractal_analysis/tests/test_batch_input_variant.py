"""Tests for analysis_input_variant plumbing — T3.3/T3.4/T3.5/T3.6.

Covers:
- Task detects scientific PNG and passes input_variants to engine
- persist_batch_results stores analysis_input_variant per image
- Mixed batch: per-image variant correctly tracked
- Drill-down response includes analysis_input_variant field
"""

from __future__ import annotations

import base64
import io
import json
import uuid
import zipfile
from unittest.mock import patch

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
        email=f"var-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name=f"proj-{uuid.uuid4()}", owner=user)


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


def _make_png(size: int = 32, color: int = 128) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (size, size), color).save(buf, format="PNG")
    return buf.getvalue()


def _make_scientific_png(size: int = 32) -> bytes:
    arr = np.zeros((size, size), dtype=np.uint8)
    arr[: size // 2, :] = 255
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()


def _fake_rust_result(n: int, dpo_used: float = 25.0) -> dict:
    return {
        "results": [
            {
                "index": i,
                "fractal_dimension": 1.70 + 0.01 * i,
                "prefactor": 1.5,
                "r_squared": None,
                "n_particles_counted": 42,
                "dpo_used": dpo_used,
                "error": None,
            }
            for i in range(n)
        ],
        "dpo_used": dpo_used,
        "autocalibrate_source": "manual",
        "autocalibrate_image_index": None,
    }


def _image_detail_url(project_id, batch_id, index: int) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/images/{index}/"


# ---------------------------------------------------------------------------
# T3.4 — persist_batch_results stores analysis_input_variant
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestPersistAnalysisInputVariant:
    """persist_batch_results must set analysis_input_variant per image."""

    def test_scientific_variant_persisted_when_scientific_png_present(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        pres = _make_png()
        sci = _make_scientific_png()

        image_results = [
            {
                "index": 0,
                "filename": "proj_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": 1.75,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "error": None,
            }
        ]

        persist_batch_results(
            batch,
            image_results,
            [pres],
            dpo_used=25.0,
            scientific_png_list=[sci],
            input_variants=["scientific"],
        )

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img.analysis_input_variant == "scientific"

    def test_presentation_variant_persisted_for_legacy(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        pres = _make_png()

        image_results = [
            {
                "index": 0,
                "filename": "proj_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": 1.75,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "error": None,
            }
        ]

        persist_batch_results(
            batch,
            image_results,
            [pres],
            dpo_used=25.0,
            input_variants=["presentation"],
        )

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img.analysis_input_variant == "presentation"

    def test_mixed_variants_persisted_correctly(self) -> None:
        """Mixed batch: first image scientific, second presentation."""
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        pres = _make_png()
        sci = _make_scientific_png()

        image_results = [
            {
                "index": 0,
                "filename": "proj_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": 1.75,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "error": None,
            },
            {
                "index": 1,
                "filename": "proj_001.png",
                "azimuth": 10.0,
                "elevation": 0.0,
                "fractal_dimension": 1.80,
                "prefactor": 1.6,
                "r_squared": 0.98,
                "n_particles_counted": 38,
                "error": None,
            },
        ]

        persist_batch_results(
            batch,
            image_results,
            [pres, pres],
            dpo_used=25.0,
            scientific_png_list=[sci, None],
            input_variants=["scientific", "presentation"],
        )

        img0 = FraktalBatchImage.objects.get(batch=batch, index=0)
        img1 = FraktalBatchImage.objects.get(batch=batch, index=1)
        assert img0.analysis_input_variant == "scientific"
        assert img1.analysis_input_variant == "presentation"

    def test_default_variant_when_no_input_variants_arg(self) -> None:
        """Backwards compat: no input_variants arg → all 'presentation'."""
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        image_results = [
            {
                "index": 0,
                "filename": "proj_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": 1.75,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "error": None,
            }
        ]

        persist_batch_results(
            batch,
            image_results,
            [_make_png()],
            dpo_used=25.0,
        )

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img.analysis_input_variant == "presentation"


# ---------------------------------------------------------------------------
# T3.3 — Task detects scientific PNG and passes input_variants to engine
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestTaskDetectsScientificPng:
    """analyze_fraktal_batch_task: detect scientific PNGs, pass input_variants."""

    @patch("aglogen_core.analyze_fraktal_batch_per_image_scale")
    @patch("aglogen_core.version", return_value="0.1.0-test")
    def test_task_passes_input_variants_scientific(
        self, mock_version, mock_engine
    ) -> None:
        """When scientific PNG present, engine receives input_variants=['scientific']."""
        mock_engine.return_value = _fake_rust_result(1)
        user = _make_user()
        project = _make_project(user)

        pres_png = _make_png()
        sci_png = _make_scientific_png()

        img = Image.open(io.BytesIO(pres_png)).convert("L")
        img_array = np.array(img, dtype=np.uint8)

        b64 = [base64.b64encode(img_array.tobytes()).decode()]
        shapes = [list(img_array.shape)]

        from apps.fractal_analysis.tasks import analyze_fraktal_batch_task

        result = analyze_fraktal_batch_task(
            images_npy_b64=b64,
            image_shapes=shapes,
            filenames=["proj_000.png"],
            metadata=None,
            pixels_per_100nm=500.0,
            autocalibrate_dpo=False,
            dpo_hint=25.0,
            algorithm="granulated_2012",
            sim_id=None,
            calibration_source="metadata",
            project_id=str(project.id),
            user_id=str(user.id),
            per_image_scales=[500.0],
            scientific_png_b64=[base64.b64encode(sci_png).decode()],
        )

        # Engine must have been called with input_variants=["scientific"]
        mock_engine.assert_called_once()
        call_kwargs = mock_engine.call_args
        # input_variants is a keyword arg
        assert "input_variants" in call_kwargs.kwargs or len(call_kwargs.args) >= 6
        if "input_variants" in (call_kwargs.kwargs or {}):
            assert call_kwargs.kwargs["input_variants"] == ["scientific"]
        else:
            # positional — 6th arg
            assert call_kwargs.args[5] == ["scientific"]

        # DB row must have analysis_input_variant = "scientific"
        batch = FraktalBatch.objects.get(id=result["batch_id"])
        img_row = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img_row.analysis_input_variant == "scientific"

    @patch("aglogen_core.analyze_fraktal_batch_per_image_scale")
    @patch("aglogen_core.version", return_value="0.1.0-test")
    def test_task_passes_input_variants_presentation_fallback(
        self, mock_version, mock_engine
    ) -> None:
        """When no scientific PNG, engine receives input_variants=['presentation']."""
        mock_engine.return_value = _fake_rust_result(1)
        user = _make_user()
        project = _make_project(user)

        pres_png = _make_png()
        img = Image.open(io.BytesIO(pres_png)).convert("L")
        img_array = np.array(img, dtype=np.uint8)

        b64 = [base64.b64encode(img_array.tobytes()).decode()]
        shapes = [list(img_array.shape)]

        from apps.fractal_analysis.tasks import analyze_fraktal_batch_task

        result = analyze_fraktal_batch_task(
            images_npy_b64=b64,
            image_shapes=shapes,
            filenames=["proj_000.png"],
            metadata=None,
            pixels_per_100nm=500.0,
            autocalibrate_dpo=False,
            dpo_hint=25.0,
            algorithm="granulated_2012",
            sim_id=None,
            calibration_source="metadata",
            project_id=str(project.id),
            user_id=str(user.id),
            per_image_scales=[500.0],
            scientific_png_b64=None,
        )

        # Engine must have been called with input_variants=["presentation"]
        mock_engine.assert_called_once()
        call_kwargs = mock_engine.call_args
        if "input_variants" in (call_kwargs.kwargs or {}):
            assert call_kwargs.kwargs["input_variants"] == ["presentation"]
        else:
            assert call_kwargs.args[5] == ["presentation"]

        # DB row must have analysis_input_variant = "presentation"
        batch = FraktalBatch.objects.get(id=result["batch_id"])
        img_row = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img_row.analysis_input_variant == "presentation"

    @patch("aglogen_core.analyze_fraktal_batch_per_image_scale")
    @patch("aglogen_core.version", return_value="0.1.0-test")
    def test_task_mixed_batch_per_image_variants(
        self, mock_version, mock_engine
    ) -> None:
        """Mixed batch: image 0 has scientific, image 1 does not."""
        mock_engine.return_value = _fake_rust_result(2)
        user = _make_user()
        project = _make_project(user)

        pres_png = _make_png()
        sci_png = _make_scientific_png()

        img = Image.open(io.BytesIO(pres_png)).convert("L")
        img_array = np.array(img, dtype=np.uint8)

        b64 = [
            base64.b64encode(img_array.tobytes()).decode(),
            base64.b64encode(img_array.tobytes()).decode(),
        ]
        shapes = [list(img_array.shape), list(img_array.shape)]

        from apps.fractal_analysis.tasks import analyze_fraktal_batch_task

        result = analyze_fraktal_batch_task(
            images_npy_b64=b64,
            image_shapes=shapes,
            filenames=["proj_000.png", "proj_001.png"],
            metadata=None,
            pixels_per_100nm=500.0,
            autocalibrate_dpo=False,
            dpo_hint=25.0,
            algorithm="granulated_2012",
            sim_id=None,
            calibration_source="metadata",
            project_id=str(project.id),
            user_id=str(user.id),
            per_image_scales=[500.0, 500.0],
            scientific_png_b64=[base64.b64encode(sci_png).decode(), None],
        )

        # Engine called with input_variants=["scientific", "presentation"]
        mock_engine.assert_called_once()
        call_kwargs = mock_engine.call_args
        if "input_variants" in (call_kwargs.kwargs or {}):
            assert call_kwargs.kwargs["input_variants"] == [
                "scientific",
                "presentation",
            ]
        else:
            assert call_kwargs.args[5] == ["scientific", "presentation"]

        # DB rows reflect per-image variant
        batch = FraktalBatch.objects.get(id=result["batch_id"])
        img0 = FraktalBatchImage.objects.get(batch=batch, index=0)
        img1 = FraktalBatchImage.objects.get(batch=batch, index=1)
        assert img0.analysis_input_variant == "scientific"
        assert img1.analysis_input_variant == "presentation"


# ---------------------------------------------------------------------------
# T3.5 — Drill-down response includes analysis_input_variant
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDrilldownAnalysisInputVariant:
    """R3 modified: drill-down detail includes analysis_input_variant."""

    def test_drilldown_includes_analysis_input_variant_scientific(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="proj_000.png",
            azimuth=0.0,
            elevation=0.0,
            fractal_dimension=1.75,
            prefactor=1.5,
            r_squared=0.99,
            n_particles_counted=42,
            dpo_used=25.0,
            image_png=_make_png(),
            png_scientific_bytes=_make_scientific_png(),
            analysis_input_variant="scientific",
        )
        batch.n_images = 1
        batch.n_successful = 1
        batch.save()

        client = _authed_client(user)
        resp = client.get(_image_detail_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        data = resp.json()
        assert "analysis_input_variant" in data
        assert data["analysis_input_variant"] == "scientific"

    def test_drilldown_includes_analysis_input_variant_presentation(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="proj_000.png",
            azimuth=0.0,
            elevation=0.0,
            fractal_dimension=1.75,
            prefactor=1.5,
            r_squared=0.99,
            n_particles_counted=42,
            dpo_used=25.0,
            image_png=_make_png(),
            analysis_input_variant="presentation",
        )
        batch.n_images = 1
        batch.n_successful = 1
        batch.save()

        client = _authed_client(user)
        resp = client.get(_image_detail_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        data = resp.json()
        assert "analysis_input_variant" in data
        assert data["analysis_input_variant"] == "presentation"

    def test_drilldown_mixed_batch_variant_matches_db(self) -> None:
        """Scenario 3.3: mixed batch — variant reflects per-image selection."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="proj_000.png",
            dpo_used=25.0,
            image_png=_make_png(),
            png_scientific_bytes=_make_scientific_png(),
            analysis_input_variant="scientific",
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=1,
            filename="proj_001.png",
            dpo_used=25.0,
            image_png=_make_png(),
            analysis_input_variant="presentation",
        )
        batch.n_images = 2
        batch.n_successful = 2
        batch.save()

        client = _authed_client(user)

        resp0 = client.get(_image_detail_url(project.id, batch.id, 0))
        assert resp0.json()["analysis_input_variant"] == "scientific"

        resp1 = client.get(_image_detail_url(project.id, batch.id, 1))
        assert resp1.json()["analysis_input_variant"] == "presentation"
