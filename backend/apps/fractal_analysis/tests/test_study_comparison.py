"""Contract tests for the ``study_comparison`` block (R12, change
fraktal-batch-extensions).

Covers:
- R12.1 — block present: converged → ``fractal_dimension``, approximate →
  ``df_estimate`` (canonical R7 population), breakdown counters, and
  TRIPLE-BUILDER equality (``_build_batch_response``,
  ``_serialize_batch_from_db``, inline ``batch_detail_view``).
- R12.2 — null branch (D3): no sim, deleted sim row, missing metric,
  ``0.0`` sentinel, zero contributors.
- Pre-existing summary keys unchanged (additive block only).

Rust engine calls are mocked where needed; the helper itself is exercised
purely through its primitives.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage
from apps.fractal_analysis.services.batch import _build_study_comparison
from apps.fractal_analysis.views import _build_batch_response, _serialize_batch_from_db
from apps.projects.models import Project
from apps.simulations.models import Simulation

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    user: User = User.objects.create_user(  # pyright: ignore[reportAttributeAccessIssue]
        email=f"study-cmp-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )
    return user


def _make_project(user: User) -> Project:
    return Project.objects.create(name="test-study-cmp", owner=user)


def _make_sim(project: Project, metrics: dict[str, Any] | None = None) -> Simulation:
    sim_metrics: dict[str, Any] = (
        metrics if metrics is not None else {"fractal_dimension": 2.42, "kf": 0.001}
    )
    return Simulation.objects.create(
        project=project,
        algorithm="tunable",
        parameters={"n_particles": 500, "target_df": 2.30},
        seed=42,
        metrics=sim_metrics,
    )


def _make_batch(project: Project, sim_id: uuid.UUID | None) -> FraktalBatch:
    return FraktalBatch.objects.create(
        project=project,
        algorithm="granulated_2012",
        calibration_source="metadata",
        pixels_per_100nm=500.0,
        dpo_used=25.0,
        sim_id=sim_id,
    )


def _image_rows() -> list[dict[str, Any]]:
    """26 converged + 4 approximate + 2 failed rows (R12.1 shape)."""
    rows: list[dict[str, Any]] = []
    for i in range(26):
        rows.append(
            {
                "index": i,
                "filename": f"proj_{i:03d}.png",
                "azimuth": float(i * 10),
                "elevation": 0.0,
                "fractal_dimension": round(1.70 + 0.01 * i, 4),
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "rg_nm": 150.0,
                "error": None,
                "quality": "converged",
                "bisection_iterations": 12,
                "bisection_residual": 0.04,
                "failure_reason": "none",
                "df_estimate": None,
            }
        )
    for i in range(4):
        rows.append(
            {
                "index": 26 + i,
                "filename": f"proj_{26 + i:03d}.png",
                "azimuth": float((26 + i) * 10),
                "elevation": 0.0,
                "fractal_dimension": None,
                "prefactor": 1.5,
                "r_squared": 0.98,
                "n_particles_counted": 40,
                "rg_nm": 148.0,
                "error": None,
                "quality": "approximate",
                "bisection_iterations": 30,
                "bisection_residual": 0.5,
                "failure_reason": "iteration_limit",
                "df_estimate": round(2.00 + 0.1 * i, 4),
            }
        )
    for i in range(2):
        rows.append(
            {
                "index": 30 + i,
                "filename": f"proj_{30 + i:03d}.png",
                "azimuth": float((30 + i) * 10),
                "elevation": 0.0,
                "fractal_dimension": None,
                "prefactor": None,
                "r_squared": None,
                "n_particles_counted": None,
                "rg_nm": None,
                "error": "Bisection failed",
                "quality": "failed",
                "bisection_iterations": None,
                "bisection_residual": None,
                "failure_reason": "kf_negative",
                "df_estimate": None,
            }
        )
    return rows


def _persist_rows(batch: FraktalBatch, rows: list[dict]) -> None:
    for row in rows:
        FraktalBatchImage.objects.create(
            batch=batch,
            index=row["index"],
            filename=row["filename"],
            azimuth=row["azimuth"],
            elevation=row["elevation"],
            fractal_dimension=row["fractal_dimension"],
            prefactor=row["prefactor"],
            r_squared=row["r_squared"],
            n_particles_counted=row["n_particles_counted"],
            rg_nm=row["rg_nm"],
            dpo_used=25.0,
            error=row["error"] or "",
            image_png=b"\x89PNG-fake",
            analysis_input_variant="presentation",
            bisection_iterations=row["bisection_iterations"],
            bisection_residual=row["bisection_residual"],
            failure_reason=row["failure_reason"],
            df_estimate=row["df_estimate"],
            quality=row["quality"],
        )


def _fake_rust_result(
    rows: list[dict[str, Any]], dpo_used: float = 25.0
) -> dict[str, Any]:
    return {
        "results": [
            {
                "index": r["index"],
                "fractal_dimension": r["fractal_dimension"],
                "prefactor": r["prefactor"],
                "r_squared": r["r_squared"],
                "n_particles_counted": r["n_particles_counted"],
                "rg_nm": r["rg_nm"],
                "dpo_used": dpo_used,
                "error": r["error"],
                "quality": r["quality"],
                "bisection_iterations": r["bisection_iterations"],
                "bisection_residual": r["bisection_residual"],
                "failure_reason": r["failure_reason"],
                "df_estimate": r["df_estimate"],
            }
            for r in rows
        ],
        "dpo_used": dpo_used,
        "autocalibrate_source": "manual",
        "autocalibrate_image_index": None,
    }


# ---------------------------------------------------------------------------
# Pure helper — R12.1 population
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestStudyComparisonPopulation:
    def test_block_present_canonical_r7_population(self) -> None:
        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project)
        rows = _image_rows()

        block = _build_study_comparison(sim.id, rows)

        assert block is not None
        assert block["sim_id"] == str(sim.id)
        assert block["images_with_df"] == 30
        assert block["images_without_df"] == 2
        assert block["image_df"]["n"] == 30
        assert block["image_df"]["n_converged"] == 26
        assert block["image_df"]["n_approximate"] == 4

        # Canonical R7 population: converged → fractal_dimension,
        # approximate → df_estimate (approximate rows carry fractal_dimension
        # = None, so df_estimate MUST be the contributing value).
        values = [r["fractal_dimension"] for r in rows[:26]] + [
            r["df_estimate"] for r in rows[26:30]
        ]
        arr = np.array(values, dtype=np.float64)
        assert block["image_df"]["mean"] == pytest.approx(float(np.mean(arr)))
        assert block["image_df"]["median"] == pytest.approx(float(np.median(arr)))
        assert block["image_df"]["min"] == pytest.approx(float(np.min(arr)))
        assert block["image_df"]["max"] == pytest.approx(float(np.max(arr)))

        # sim_df + target from sim.parameters.
        assert block["sim_df"]["value"] == 2.42
        assert block["sim_df"]["target_df"] == 2.30

        # Per-image deltas + mean.
        expected_deltas = [v - 2.42 for v in values]
        assert block["deltas"] == pytest.approx(expected_deltas)
        assert block["mean_delta"] == pytest.approx(float(np.mean(expected_deltas)))

        assert block["show_sorensen_note"] is True

    def test_target_df_null_when_absent(self) -> None:
        user = _make_user()
        project = _make_project(user)
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable",
            parameters={"n_particles": 500},
            seed=1,
            metrics={"fractal_dimension": 2.42},
        )

        block = _build_study_comparison(sim.id, _image_rows())

        assert block is not None
        assert block["sim_df"]["target_df"] is None

    def test_no_sorensen_collision_with_r11_string_key(self) -> None:
        # R1 M5: ``show_sorensen_note`` is a boolean; the R11 string key
        # (``sorensen_note``) must NOT appear inside the block.
        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project)

        block = _build_study_comparison(sim.id, _image_rows())

        assert block is not None
        assert "sorensen_note" not in block
        assert isinstance(block["show_sorensen_note"], bool)


# ---------------------------------------------------------------------------
# Pure helper — R12.2 null branch (D3)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestStudyComparisonNullBranch:
    def test_no_sim_id_returns_none(self) -> None:
        assert _build_study_comparison(None, _image_rows()) is None

    def test_deleted_sim_row_returns_none(self) -> None:
        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project)
        missing_id = uuid.uuid4()
        assert missing_id != sim.id

        # The linked sim was deleted — the UUID no longer resolves.
        assert _build_study_comparison(missing_id, _image_rows()) is None

    def test_missing_metric_returns_none(self) -> None:
        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project, metrics={"kf": 0.001})

        assert _build_study_comparison(sim.id, _image_rows()) is None

    def test_zero_sentinel_counts_as_missing(self) -> None:
        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project, metrics={"fractal_dimension": 0.0})

        assert _build_study_comparison(sim.id, _image_rows()) is None

    def test_zero_contributors_returns_none(self) -> None:
        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project)
        rows = _image_rows()
        failed_only = [r for r in rows if r["quality"] == "failed"]

        assert _build_study_comparison(sim.id, failed_only) is None


# ---------------------------------------------------------------------------
# Triple-builder equality (R12.1)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestTripleBuilderEquality:
    def test_all_three_builders_emit_identical_blocks(self) -> None:
        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project)
        batch = _make_batch(project, sim.id)
        rows = _image_rows()
        _persist_rows(batch, rows)

        # Builder 1: in-memory (sync/task path) — runs BEFORE the batch row.
        b1 = _build_batch_response(
            _fake_rust_result(rows),
            [r["filename"] for r in rows],
            None,
            sim.id,
            500.0,
            "metadata",
        )
        # Builder 2: DB read path.
        b2 = _serialize_batch_from_db(str(batch.id))
        # Builder 3: inline detail view.
        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.get(f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/")
        assert resp.status_code == 200, resp.content  # pyright: ignore[reportAttributeAccessIssue]
        b3 = resp.json()  # pyright: ignore[reportAttributeAccessIssue]

        assert b1["study_comparison"] is not None
        assert b2 is not None and b2["study_comparison"] is not None
        assert b3["study_comparison"] is not None
        assert b1["study_comparison"] == b2["study_comparison"]
        assert b2["study_comparison"] == b3["study_comparison"]

        # R12.2-null symmetry: all three builders agree on the null branch too
        # (batch with a linked sim whose metric carries the 0.0 sentinel).
        sim0 = _make_sim(project, metrics={"fractal_dimension": 0.0})
        batch0 = _make_batch(project, sim0.id)
        _persist_rows(batch0, rows)
        b1_0 = _build_batch_response(
            _fake_rust_result(rows),
            [r["filename"] for r in rows],
            None,
            sim0.id,
            500.0,
            "metadata",
        )
        b2_0 = _serialize_batch_from_db(str(batch0.id))
        b3_0 = client.get(
            f"/api/v1/projects/{project.id}/fraktal/batches/{batch0.id}/"
        ).json()  # pyright: ignore[reportAttributeAccessIssue]
        assert b1_0["study_comparison"] is None
        assert b2_0 is not None and b2_0["study_comparison"] is None
        assert b3_0["study_comparison"] is None

    def test_pre_existing_summary_keys_unchanged(self) -> None:
        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project)
        batch = _make_batch(project, sim.id)
        rows = _image_rows()
        _persist_rows(batch, rows)

        payload = _serialize_batch_from_db(str(batch.id))

        assert payload is not None
        assert set(payload["study_comparison"].keys()) == {
            "sim_id",
            "images_with_df",
            "images_without_df",
            "image_df",
            "sim_df",
            "mean_delta",
            "deltas",
            "show_sorensen_note",
        }
        # Additive only: every pre-existing top-level key is still present.
        assert {
            "batch_id",
            "images",
            "stats",
            "histogram",
            "comparison",
            "calibration",
        } <= set(payload.keys())

    def test_builder3_image_rows_carry_quality_and_df_estimate(self) -> None:
        """The inline builder's images_data must carry the population fields."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project)
        batch = _make_batch(project, sim.id)
        rows = _image_rows()
        _persist_rows(batch, rows)

        client = APIClient()
        client.force_authenticate(user=user)
        payload = client.get(
            f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"
        ).json()  # pyright: ignore[reportAttributeAccessIssue]

        first = payload["images"][0]
        assert first["quality"] == "converged"
        approximate = payload["images"][26]
        assert approximate["quality"] == "approximate"
        assert approximate["df_estimate"] == pytest.approx(2.00)


class TestBuilder1NullBlockNoDb:
    """Builder 1 runs before the batch row exists — no DB writes needed."""

    def test_builder1_block_null_without_sim(self) -> None:
        b1 = _build_batch_response(
            _fake_rust_result(_image_rows()),
            [r["filename"] for r in _image_rows()],
            None,
            None,
            500.0,
            "metadata",
        )
        assert b1["study_comparison"] is None

    def test_builder1_needs_no_batch_row(self) -> None:
        with patch(
            "apps.fractal_analysis.views._build_study_comparison",
            wraps=_build_study_comparison,
        ) as spy:
            _build_batch_response(
                _fake_rust_result(_image_rows()),
                [r["filename"] for r in _image_rows()],
                None,
                None,
                500.0,
                "metadata",
            )
        assert spy.call_count == 1


# ---------------------------------------------------------------------------
# Judgment-day fix round — F2/F3/F4 builder parity
# ---------------------------------------------------------------------------


def _rows_with_error_approximate() -> list[dict[str, Any]]:
    """2 converged + 1 APPROXIMATE row that also carries an engine error.

    This is the judge A case (F3): the engine returns quality="approximate"
    WITH an error string (e.g. NpoTooSmall + df_estimate). Persistence
    forces quality="failed" (PYA-13 T3.3 safety net); builder 1 must derive
    the same value or the three builders diverge on ``study_comparison``.
    """
    rows = _image_rows()[:2]  # two converged rows keep the block non-null
    rows.append(
        {
            "index": 2,
            "filename": "proj_002.png",
            "azimuth": 20.0,
            "elevation": 0.0,
            "fractal_dimension": None,
            "prefactor": 1.5,
            "r_squared": 0.98,
            "n_particles_counted": 40,
            "rg_nm": 148.0,
            "error": "NpoTooSmall",
            "quality": "approximate",
            "bisection_iterations": 30,
            "bisection_residual": 0.5,
            "failure_reason": "iteration_limit",
            "df_estimate": 2.05,
        }
    )
    return rows


@pytest.mark.django_db
class TestFixRoundBuilderParity:
    def test_triple_builder_equality_with_error_approximate_row(self) -> None:
        """F3: builder 1 derives quality = 'failed' if error else engine
        quality, so all three builders emit IDENTICAL study_comparison for
        error-carrying rows (previously builder 1 said 'approximate' while
        persistence forced 'failed')."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project)
        batch = _make_batch(project, sim.id)
        rows = _rows_with_error_approximate()
        # Persist AS persist_batch_results would: the error forces 'failed'.
        FraktalBatchImage.objects.create(
            batch=batch,
            index=rows[0]["index"],
            filename=rows[0]["filename"],
            dpo_used=25.0,
            image_png=b"\x89PNG-fake",
            quality="converged",
            fractal_dimension=rows[0]["fractal_dimension"],
            prefactor=rows[0]["prefactor"],
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=rows[1]["index"],
            filename=rows[1]["filename"],
            dpo_used=25.0,
            image_png=b"\x89PNG-fake",
            quality="converged",
            fractal_dimension=rows[1]["fractal_dimension"],
            prefactor=rows[1]["prefactor"],
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=2,
            filename="proj_002.png",
            dpo_used=25.0,
            image_png=b"\x89PNG-fake",
            error="NpoTooSmall",
            quality="failed",  # what persist_batch_results writes
            df_estimate=2.05,
        )

        # Builder 1 gets the RAW engine result (quality='approximate' + error).
        b1 = _build_batch_response(
            _fake_rust_result(rows),
            [r["filename"] for r in rows],
            None,
            sim.id,
            500.0,
            "metadata",
        )
        b2 = _serialize_batch_from_db(str(batch.id))
        client = APIClient()
        client.force_authenticate(user=user)
        b3 = client.get(
            f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"
        ).json()  # pyright: ignore[reportAttributeAccessIssue]

        # Builder 1 derived 'failed' for the error row (like persistence).
        assert b1["images"][2]["quality"] == "failed"
        # The error row contributes to NEITHER population in any builder,
        # so the study_comparison blocks are identical.
        assert b1["study_comparison"] is not None
        assert b2 is not None and b2["study_comparison"] is not None
        assert b1["study_comparison"] == b2["study_comparison"]
        assert b2["study_comparison"] == b3["study_comparison"]
        # The error-carrying row is excluded from image_df.
        assert b1["study_comparison"]["image_df"]["n"] == 2

    def test_builder1_stats_carry_n_failed(self) -> None:
        """F4: builder 1 (sync/async live payload) emits stats.n_failed so
        the frontend bulk re-analyze button is visible without a reload."""
        b1 = _build_batch_response(
            _fake_rust_result(_rows_with_error_approximate()),
            [r["filename"] for r in _rows_with_error_approximate()],
            None,
            None,
            500.0,
            "metadata",
        )
        assert b1["stats"]["n_failed"] == 1

    def test_db_serializer_stats_carry_quartiles_matching_builder1(
        self,
    ) -> None:
        """F2: _serialize_batch_from_db emits q1_df/q3_df computed with the
        SAME population + np.percentile(arr, 25/75) formula as builder 1's
        compute_batch_statistics, so the frontend Q1/Q3 cards do not flip
        to '-' on a DB-shaped payload."""
        from apps.fractal_analysis.services.batch import (  # noqa: PLC0415
            compute_batch_statistics,
        )

        user = _make_user()
        project = _make_project(user)
        sim = _make_sim(project)
        batch = _make_batch(project, sim.id)
        rows = _image_rows()
        _persist_rows(batch, rows)

        b2 = _serialize_batch_from_db(str(batch.id))
        assert b2 is not None
        b1 = _build_batch_response(
            _fake_rust_result(rows),
            [r["filename"] for r in rows],
            None,
            sim.id,
            500.0,
            "metadata",
        )

        # Exact parity with the shared helper for the same rows.
        expected = compute_batch_statistics(b2["images"])
        assert b2["stats"]["q1_df"] is not None
        assert b2["stats"]["q1_df"] == pytest.approx(expected["q1_df"])
        assert b2["stats"]["q3_df"] is not None
        assert b2["stats"]["q3_df"] == pytest.approx(expected["q3_df"])
        # And identical to builder 1's payload for the same rows.
        assert b2["stats"]["q1_df"] == pytest.approx(b1["stats"]["q1_df"])
        assert b2["stats"]["q3_df"] == pytest.approx(b1["stats"]["q3_df"])
