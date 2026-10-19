"""Fix round 2 (fresh-pass JD-A-001): the aggregate recompute and
batch.save must live INSIDE the same transaction.atomic as the row
updates — a failure between them must roll back rows AND aggregates
together (no torn state: per-image values with stale aggregates)."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from apps.fractal_analysis.tests.test_reanalyze_failed import (
    _fake_engine_result,
    _make_batch,
    _make_project,
    _make_row,
    _make_user,
)


def _torn_state_setup() -> Any:
    user = _make_user()
    project = _make_project(user)
    batch = _make_batch(project, user)
    for i in range(3):
        _make_row(batch, i, quality="failed")
    return batch


class TestAtomicRollback:
    @pytest.mark.django_db
    def test_batch_save_failure_rolls_back_rows_and_aggregates(self) -> None:
        """Patching FraktalBatch.save to raise inside the re-analysis must
        roll back the per-row updates AND the aggregate recompute together
        (fresh-pass JD-A-001: the atomic block used to close before the
        aggregate recompute, leaving rows with stale aggregates)."""
        batch = _torn_state_setup()
        pre_save_batch_state = {
            "mean_df": batch.mean_df,
            "n_successful": batch.n_successful,
        }

        with (
            patch(
                "aglogen_core.analyze_fraktal_batch_per_image_scale",
                return_value=_fake_engine_result(3),
            ),
            patch(
                "apps.fractal_analysis.models.FraktalBatch.save",
                side_effect=RuntimeError("db exploded mid-aggregate"),
            ),
            pytest.raises(RuntimeError, match="db exploded"),
        ):
            from apps.fractal_analysis.services.batch import (
                reanalyze_failed_images,
            )

            reanalyze_failed_images(batch)

        # Rows: refreshed from the DB — still failed, still NULL analysis.
        for i in range(3):
            row = batch.images.get(index=i)
            row.refresh_from_db()
            assert row.quality == "failed"
            assert row.fractal_dimension is None
            assert row.error == "Bisection failed"

        # Aggregates: unchanged (no torn state with fresh rows) — the batch
        # was created with n_images=0 (direct row creates never touch
        # batch aggregates; only persist_batch_results does).
        batch.refresh_from_db()
        assert batch.mean_df == pre_save_batch_state["mean_df"]
        assert batch.n_successful == pre_save_batch_state["n_successful"]
        assert batch.n_images == 0

    @pytest.mark.django_db
    def test_happy_path_still_persists_everything(self) -> None:
        """The atomic rewrite preserves the success path: rows updated,
        aggregates recomputed, no exception."""
        batch = _torn_state_setup()

        with (
            patch(
                "aglogen_core.analyze_fraktal_batch_per_image_scale",
                return_value=_fake_engine_result(3),
            ),
        ):
            from apps.fractal_analysis.services.batch import (
                reanalyze_failed_images,
            )

            outcome = reanalyze_failed_images(batch)

        assert outcome["reanalyzed"] == 3
        assert outcome["still_failed"] == 0
        batch.refresh_from_db()
        assert batch.n_successful == 3
        assert batch.mean_df is not None
        for i in range(3):
            row = batch.images.get(index=i)
            assert row.quality == "converged"
            assert row.fractal_dimension is not None
