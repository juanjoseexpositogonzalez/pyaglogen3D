"""Contract tests for R13 in-place bulk re-analysis of failed images
(change fraktal-batch-extensions) + the persistence delta R2 scenarios
2.11 / 2.12.

Covers:
- R13.1 — >30 failed → ``202 {job_id, status: "queued"}``; on completion
  the SAME batch holds updated rows (same pks, PNG bytes hash-equal),
  ``n_images`` unchanged, aggregates recomputed over the FULL set with
  canonical populations, failed set shrinks.
- R13.2 — 12 failed → sync ``200`` with the updated summary payload
  (including ``study_comparison``); 0 failed → ``400`` with
  ``code: "no_failed_images"``; authenticated non-shared user → ``403``.
- Subset-exclusivity — the failed subset is NEVER passed to
  ``persist_batch_results``.
- Calibration — persisted per-image ``pixels_per_100nm`` wins; NULL rows
  fall back to the batch scale; ``calibration_source`` unchanged.
- Scenario 2.11/2.12 — per-image scale population at FIRST analysis.
"""

from __future__ import annotations

import io
import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage
from apps.fractal_analysis.services.batch import persist_batch_results
from apps.fractal_analysis.tasks import reanalyze_failed_batch_task
from apps.projects.models import Project

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _make_user(prefix: str = "r13") -> User:
    user: User = User.objects.create_user(  # pyright: ignore[reportAttributeAccessIssue]
        email=f"{prefix}-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )
    return user


def _make_project(user: User) -> Project:
    return Project.objects.create(name="test-r13", owner=user)


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_png(size: int = 32, value: int = 128) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (size, size), value).save(buf, format="PNG")
    return buf.getvalue()


def _make_batch(project: Project, user: User, **overrides: Any) -> FraktalBatch:
    defaults = dict(
        project=project,
        created_by=user,
        algorithm="granulated_2012",
        calibration_source="metadata",
        pixels_per_100nm=3.8,
        dpo_used=25.0,
    )
    defaults.update(overrides)
    return FraktalBatch.objects.create(**defaults)


def _make_row(
    batch: FraktalBatch,
    index: int,
    quality: str = "failed",
    *,
    ppn: float | None = None,
    png: bytes | None = None,
    scientific: bytes | None = None,
    variant: str = "presentation",
    fractal_dimension: float | None = None,
) -> FraktalBatchImage:
    return FraktalBatchImage.objects.create(
        batch=batch,
        index=index,
        filename=f"proj_{index:03d}.png",
        azimuth=10.0 * index,
        elevation=0.0,
        fractal_dimension=fractal_dimension,
        prefactor=1.5 if fractal_dimension is not None else None,
        n_particles_counted=42 if fractal_dimension is not None else None,
        dpo_used=batch.dpo_used,
        error="" if fractal_dimension is not None else "Bisection failed",
        image_png=png if png is not None else _make_png(),
        png_scientific_bytes=scientific,
        analysis_input_variant=variant,
        quality=quality,
        pixels_per_100nm=ppn,
    )


def _fake_engine_result(
    n: int,
    *,
    n_still_failed: int = 0,
    start_df: float = 1.75,
) -> dict[str, Any]:
    """Synthetic ``analyze_fraktal_batch_per_image_scale`` payload."""
    results = []
    for i in range(n):
        if i >= n - n_still_failed:
            results.append(
                {
                    "index": i,
                    "fractal_dimension": None,
                    "prefactor": None,
                    "r_squared": None,
                    "n_particles_counted": None,
                    "dpo_used": 25.0,
                    "rg_nm": None,
                    "error": "Bisection failed",
                    "bisection_iterations": None,
                    "bisection_residual": None,
                    "failure_reason": "kf_negative",
                    "df_estimate": None,
                    "quality": "failed",
                }
            )
        else:
            results.append(
                {
                    "index": i,
                    "fractal_dimension": round(start_df + 0.01 * i, 4),
                    "prefactor": 1.5,
                    "r_squared": 0.99,
                    "n_particles_counted": 40,
                    "dpo_used": 25.0,
                    "rg_nm": 150.0,
                    "error": None,
                    "bisection_iterations": 10,
                    "bisection_residual": 0.03,
                    "failure_reason": "none",
                    "df_estimate": None,
                    "quality": "converged",
                }
            )
    return {
        "results": results,
        "dpo_used": 25.0,
        "autocalibrate_source": "manual",
        "autocalibrate_image_index": None,
    }


def _reanalyze_url(project: Project, batch: FraktalBatch) -> str:
    return reverse(
        "project-fraktal-batch-reanalyze-failed",
        args=[str(project.id), str(batch.id)],
    )


# ---------------------------------------------------------------------------
# R13.2 — sync / empty / permission
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReanalyzeFailedBoundaries:
    def test_sync_12_failed_returns_200_with_updated_summary(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i in range(12):
            _make_row(batch, i, quality="failed")
        # Pre-existing successful rows so the recompute spans the FULL set.
        _make_row(batch, 12, quality="converged", fractal_dimension=1.80)
        _make_row(batch, 13, quality="converged", fractal_dimension=1.82)

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(12),
        ):
            resp = _authed_client(user).post(_reanalyze_url(project, batch))

        assert resp.status_code == 200, resp.content  # pyright: ignore[reportAttributeAccessIssue]
        payload = resp.json()  # pyright: ignore[reportAttributeAccessIssue]
        # Updated batch summary payload — additive study_comparison included.
        assert "study_comparison" in payload
        assert payload["stats"]["n_images"] == 14
        # 12 re-analyzed (converged per mock) + 2 pre-existing = 14.
        assert payload["stats"]["n_successful"] == 14
        assert payload["stats"]["n_failed"] == 0
        # mean_df recomputed over the FULL set (12 fresh + 2 old).
        import numpy as np

        expected_values = [1.75 + 0.01 * i for i in range(12)] + [1.80, 1.82]
        assert payload["stats"]["mean_df"] == pytest.approx(
            float(np.mean(expected_values))
        )

    def test_zero_failed_returns_400_no_failed_images(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _make_row(batch, 0, quality="converged", fractal_dimension=1.8)

        resp = _authed_client(user).post(_reanalyze_url(project, batch))

        assert resp.status_code == 400
        body = resp.json()
        assert body["code"] == "no_failed_images"
        assert "detail" in body

    def test_non_shared_authenticated_user_gets_403(self) -> None:
        owner = _make_user("r13-owner")
        outsider = _make_user("r13-out")
        project = _make_project(owner)
        batch = _make_batch(project, owner)
        _make_row(batch, 0, quality="failed")

        resp = _authed_client(outsider).post(_reanalyze_url(project, batch))

        assert resp.status_code == 403

    def test_owner_gets_access(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _make_row(batch, 0, quality="failed")

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(1),
        ):
            resp = _authed_client(user).post(_reanalyze_url(project, batch))

        assert resp.status_code == 200

    def test_cross_project_batch_returns_404(self) -> None:
        owner = _make_user()
        other = _make_user()
        project = _make_project(owner)
        other_project = _make_project(other)
        batch = _make_batch(project, owner)
        _make_row(batch, 0, quality="failed")

        # outsider is owner of other_project → passes permission, but the
        # batch lives in another project → 404 (no existence leak).
        resp = _authed_client(other).post(_reanalyze_url(other_project, batch))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# R13.1 — async boundary + in-place guarantees
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReanalyzeFailedAsync:
    def test_45_failed_returns_202_canonical_shape(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i in range(45):
            _make_row(batch, i, quality="failed")

        with patch.object(
            reanalyze_failed_batch_task, "delay", return_value=MagicMock(id="job-42")
        ) as mock_delay:
            resp = _authed_client(user).post(_reanalyze_url(project, batch))

        assert resp.status_code == 202
        assert resp.json() == {"job_id": "job-42", "status": "queued"}
        mock_delay.assert_called_once_with(str(batch.id))

    def test_task_reports_batch_id_for_status_view(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i in range(45):
            _make_row(batch, i, quality="failed")

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(45),
        ):
            result = reanalyze_failed_batch_task(str(batch.id))  # pyright: ignore[reportCallIssue]

        # fraktal_status_view surfaces result["batch_id"] on SUCCESS.
        assert result["batch_id"] == str(batch.id)

    def test_in_place_update_preserves_pks_and_png_hash(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        rows = []
        pngs = []
        for i in range(45):
            png = _make_png(value=100 + i)
            row = _make_row(batch, i, quality="failed", png=png)
            rows.append(row)
            pngs.append(png)
        pks_before = [r.pk for r in rows]

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(45, n_still_failed=3),
        ):
            summary = reanalyze_failed_images(batch)

        assert summary["reanalyzed"] == 45
        assert summary["still_failed"] == 3
        batch.refresh_from_db()
        rows_after = list(batch.images.order_by("index"))
        # SAME pks — in-place UPDATE, not delete/reinsert.
        assert [r.pk for r in rows_after] == pks_before
        # PNG bytes hash-equal (no re-rasterization).
        for before, after in zip(pngs, rows_after, strict=True):
            assert bytes(after.image_png) == before
        # Aggregates over the FULL set: n_images unchanged.
        assert batch.n_images == 45
        assert batch.n_successful == 42
        # Failed set shrinks to still-failing images.
        assert batch.images.filter(quality="failed").count() == 3
        # calibration_source untouched.
        assert batch.calibration_source == "metadata"

    def test_still_failed_rows_carry_engine_error(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _make_row(batch, 0, quality="failed")

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(1, n_still_failed=1),
        ):
            reanalyze_failed_images(batch)

        row = batch.images.get(index=0)
        assert row.quality == "failed"
        assert row.error == "Bisection failed"
        assert row.failure_reason == "kf_negative"


# ---------------------------------------------------------------------------
# Subset-exclusivity + calibration
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReanalyzeFailedContractPins:
    def test_subset_never_passed_to_persist_batch_results(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i in range(5):
            _make_row(batch, i, quality="failed")
        _make_row(batch, 5, quality="converged", fractal_dimension=1.80)

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with (
            patch(
                "aglogen_core.analyze_fraktal_batch_per_image_scale",
                return_value=_fake_engine_result(5),
            ),
            patch(
                "apps.fractal_analysis.services.batch.persist_batch_results"
            ) as mock_persist,
        ):
            reanalyze_failed_images(batch)

        mock_persist.assert_not_called()
        batch.refresh_from_db()
        # n_images stayed FULL-SET, not the subset length.
        assert batch.n_images == 6
        assert batch.n_successful == 6

    def test_persisted_scale_wins_null_falls_back_to_batch(self) -> None:
        user = _make_user()
        project = _make_project(user)
        # batch broadcast 3.8; row A persisted 4.2, row B NULL.
        batch = _make_batch(project, user, pixels_per_100nm=3.8)
        _make_row(batch, 0, quality="failed", ppn=4.2)
        _make_row(batch, 1, quality="failed", ppn=None)

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(2),
        ) as mock_engine:
            reanalyze_failed_images(batch)

        scales_arg = mock_engine.call_args.args[1]
        assert scales_arg == [4.2, 3.8]
        batch.refresh_from_db()
        assert batch.calibration_source == "metadata"  # unchanged

    def test_scientific_variant_reuses_scientific_png(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        sci = _make_png(value=0)
        _make_row(
            batch,
            0,
            quality="failed",
            scientific=sci,
            variant="scientific",
        )

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(1),
        ):
            reanalyze_failed_images(batch)

        row = batch.images.get(index=0)
        assert row.analysis_input_variant == "scientific"
        assert row.png_scientific_bytes is not None
        assert bytes(row.png_scientific_bytes) == sci

    def test_autocalibrate_off_and_dpo_from_batch(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user, dpo_used=33.0)
        _make_row(batch, 0, quality="failed")

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        result = _fake_engine_result(1)
        # A real engine reports dpo_used = dpo_hint (autocalibrate OFF).
        result["dpo_used"] = 33.0
        result["results"][0]["dpo_used"] = 33.0
        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=result,
        ) as mock_engine:
            reanalyze_failed_images(batch)

        # Positional contract: (images, scales, autocalibrate_dpo=False,
        # dpo_hint=batch.dpo_used, algorithm=batch.algorithm)
        args = mock_engine.call_args.args
        assert args[2] is False
        assert args[3] == 33.0
        assert args[4] == "granulated_2012"
        row = batch.images.get(index=0)
        assert row.dpo_used == 33.0

    def test_read_derived_quartiles_not_written(self) -> None:
        """The recompute touches EXACTLY the 7 persisted columns."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i in range(2):
            _make_row(batch, i, quality="failed")

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(2),
        ):
            reanalyze_failed_images(batch)

        batch.refresh_from_db()
        persisted_fields = {
            f.name for f in FraktalBatch._meta.get_fields() if hasattr(f, "column")
        }
        assert "q1_df" not in persisted_fields
        assert "q3_df" not in persisted_fields
        assert "mean_df_inclusive" not in persisted_fields


# ---------------------------------------------------------------------------
# Persistence delta R2 — scenarios 2.11 / 2.12 (first-analysis writer)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestFirstAnalysisPixelsPer100nmWriter:
    def test_scenario_2_12_mixed_population(self) -> None:
        """Direction i carries 4.2; direction j falls back to batch 3.8."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user, pixels_per_100nm=3.8)

        image_results = [
            {
                "index": 0,
                "filename": "proj_000.png",
                "fractal_dimension": 1.8,
                "error": None,
                "quality": "converged",
            },
            {
                "index": 1,
                "filename": "proj_001.png",
                "fractal_dimension": 1.82,
                "error": None,
                "quality": "converged",
            },
        ]
        # Resolved output of extract_per_image_scales: per-direction value
        # for i, top-level broadcast fallback for j.
        persist_batch_results(
            batch,
            image_results,
            [b"png0", b"png1"],
            dpo_used=25.0,
            pixels_per_100nm_list=[4.2, 3.8],
        )

        row_i = FraktalBatchImage.objects.get(batch=batch, index=0)
        row_j = FraktalBatchImage.objects.get(batch=batch, index=1)
        assert row_i.pixels_per_100nm == pytest.approx(4.2)
        assert row_j.pixels_per_100nm == pytest.approx(3.8)

    def test_scenario_2_11_persisted_value_feeds_reanalysis(self) -> None:
        """A row with a persisted scale is re-analyzed AT that scale."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user, pixels_per_100nm=3.8)
        _make_row(batch, 0, quality="failed", ppn=4.2)

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(1),
        ) as mock_engine:
            reanalyze_failed_images(batch)

        assert mock_engine.call_args.args[1] == [4.2]

    def test_legacy_zip_all_rows_get_batch_broadcast(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user, pixels_per_100nm=500.0)

        image_results = [
            {
                "index": i,
                "filename": f"proj_{i:03d}.png",
                "fractal_dimension": 1.8,
                "error": None,
                "quality": "converged",
            }
            for i in range(2)
        ]
        persist_batch_results(
            batch,
            image_results,
            [b"png0", b"png1"],
            dpo_used=25.0,
            # per_image_scales=None for a fully legacy ZIP
        )

        for i in range(2):
            row = FraktalBatchImage.objects.get(batch=batch, index=i)
            assert row.pixels_per_100nm == pytest.approx(500.0)

    def test_no_backfill_for_pre_migration_rows(self) -> None:
        """Pre-migration rows keep NULL; re-analysis falls back to the batch
        scale AT ANALYSIS TIME ONLY (engine arg) and does NOT persist the
        fallback into the row (fix round F10 — no backfill)."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user, pixels_per_100nm=3.8)
        _make_row(batch, 0, quality="failed", ppn=None)

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(1),
        ) as mock_engine:
            reanalyze_failed_images(batch)

        # The batch fallback IS what the engine ran at...
        assert mock_engine.call_args.args[1] == [3.8]
        # ...but the fallback is NOT persisted: the row stays NULL.
        row = batch.images.get(index=0)
        assert row.pixels_per_100nm is None

    def test_persisted_scale_refreshed_null_untouched(self) -> None:
        """Fix round F10: rows with a persisted scale keep their provenance;
        NULL rows stay NULL after re-analysis (same batch)."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user, pixels_per_100nm=3.8)
        _make_row(batch, 0, quality="failed", ppn=4.2)
        _make_row(batch, 1, quality="failed", ppn=None)

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(2),
        ) as mock_engine:
            reanalyze_failed_images(batch)

        assert mock_engine.call_args.args[1] == [4.2, 3.8]
        row_a = batch.images.get(index=0)
        row_b = batch.images.get(index=1)
        assert row_a.pixels_per_100nm == pytest.approx(4.2)
        assert row_b.pixels_per_100nm is None

    def test_engine_receives_input_variants_from_rows(self) -> None:
        """Fix round F1: the re-analysis call MUST forward each row's
        ``analysis_input_variant`` — the binding otherwise defaults every
        image to Presentation, which re-clips scientific (0/255) inputs and
        deterministically re-fails the row with wrong provenance."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _make_row(
            batch,
            0,
            quality="failed",
            scientific=_make_png(value=0),
            variant="scientific",
        )
        _make_row(batch, 1, quality="failed", variant="presentation")

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(2),
        ) as mock_engine:
            reanalyze_failed_images(batch)

        kwargs = mock_engine.call_args.kwargs
        assert kwargs["input_variants"] == ["scientific", "presentation"]
        # Rows keep their recorded variant (no silent downgrade).
        assert batch.images.get(index=0).analysis_input_variant == "scientific"
        assert batch.images.get(index=1).analysis_input_variant == "presentation"

    def test_row_updates_run_inside_transaction_atomic(self) -> None:
        """Fix round F5: the row-update loop + aggregate recompute are
        wrapped in ``transaction.atomic`` (no torn state)."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _make_row(batch, 0, quality="failed")

        from django.db import transaction as db_transaction

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        with (
            patch(
                "aglogen_core.analyze_fraktal_batch_per_image_scale",
                return_value=_fake_engine_result(1),
            ),
            patch(
                "django.db.transaction.atomic",
                wraps=db_transaction.atomic,
            ) as mock_atomic,
        ):
            reanalyze_failed_images(batch)

        mock_atomic.assert_called()

    def test_progress_callback_called_per_image(self) -> None:
        """Fix round F6: the optional progress callback fires once per
        re-analyzed row with (done, total)."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i in range(3):
            _make_row(batch, i, quality="failed")

        from apps.fractal_analysis.services.batch import reanalyze_failed_images

        ticks: list[tuple[int, int]] = []
        with patch(
            "aglogen_core.analyze_fraktal_batch_per_image_scale",
            return_value=_fake_engine_result(3),
        ):
            reanalyze_failed_images(
                batch, progress_callback=lambda done, total: ticks.append((done, total))
            )

        assert ticks == [(1, 3), (2, 3), (3, 3)]

    def test_task_reports_progress_via_update_state(self) -> None:
        """Fix round F6: the async wrapper emits a PROGRESS tick per image
        through ``update_state`` (meta carries progress/current/total and
        the ``reanalyzing`` stage)."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i in range(3):
            _make_row(batch, i, quality="failed")

        with (
            patch(
                "aglogen_core.analyze_fraktal_batch_per_image_scale",
                return_value=_fake_engine_result(3),
            ),
            patch.object(reanalyze_failed_batch_task, "update_state") as mock_update,
        ):
            # Simulate a queued Celery job context (request.id set) without a
            # real broker: eager apply() with an explicit task_id gives the
            # bound task a real request context.
            try:
                reanalyze_failed_batch_task.apply(  # pyright: ignore[reportCallIssue, reportAttributeAccessIssue]
                    args=[str(batch.id)], task_id="job-progress-1"
                )
            finally:
                pass

        assert mock_update.call_count == 3
        meta = mock_update.call_args.kwargs["meta"]
        assert meta["progress"] == pytest.approx(1.0)
        assert meta["current"] == 3
        assert meta["total"] == 3
        assert meta["stage"] == "reanalyzing"
        state = mock_update.call_args.kwargs["state"]
        assert state == "PROGRESS"

    def test_task_missing_batch_raises_clear_error(self) -> None:
        """Fix round F8: a batch deleted before the queued job runs must
        fail with a clear message, not a raw DoesNotExist traceback."""
        missing_id = str(uuid.uuid4())

        with pytest.raises(ValueError, match="not found"):
            reanalyze_failed_batch_task(missing_id)  # pyright: ignore[reportCallIssue]
