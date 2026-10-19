"""Fix round 2 (fresh-pass JD-A-002): builder 3 — the batch_detail_view
page-load path — must carry q1_df/q3_df with the same np.percentile(arr,
25/75) population as builders 1/2, otherwise the Q1/Q3 stat cards flip to
"—" on EVERY reload after a sync re-analysis."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest

from apps.accounts.models import User
from apps.fractal_analysis.tests.test_reanalyze_failed import (
    _authed_client,
    _make_batch,
    _make_project,
    _make_row,
    _make_user,
)
from apps.fractal_analysis.views import _serialize_batch_from_db


def _detail_url(project: Any, batch: Any) -> str:
    return f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"


def _contributing_values() -> list[float]:
    return [1.80, 1.82, 1.71]


class TestBuilder3Quartiles:
    @pytest.mark.django_db
    def test_batch_detail_view_carries_q1_q3(self) -> None:
        """GET .../batches/<pk>/ emits stats.q1_df/q3_df matching
        np.percentile(arr, 25/75) over the contributing values — the same
        population builders 1/2 use (fresh-pass JD-A-002)."""
        user: User = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i, df in enumerate(_contributing_values()):
            _make_row(batch, i, quality="converged", fractal_dimension=df)
        client = _authed_client(user)

        resp: Any = client.get(_detail_url(project, batch))
        assert resp.status_code == 200, resp.content
        payload: dict[str, Any] = resp.json()

        stats: dict[str, Any] = payload["stats"]
        arr = np.array(_contributing_values())
        assert stats["q1_df"] is not None, "q1_df must not be '—' on page load"
        assert stats["q3_df"] is not None, "q3_df must not be '—' on page load"
        assert math.isclose(
            float(stats["q1_df"]),
            float(np.percentile(arr, 25)),
            rel_tol=1e-9,
        )
        assert math.isclose(
            float(stats["q3_df"]),
            float(np.percentile(arr, 75)),
            rel_tol=1e-9,
        )

    @pytest.mark.django_db
    def test_builder2_and_builder3_quartile_parity(self) -> None:
        """The two DB builders emit IDENTICAL q1_df/q3_df for the same batch
        state — no flapping between the sync re-analysis response and the
        next page load."""
        user: User = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i, df in enumerate(_contributing_values()):
            _make_row(batch, i, quality="converged", fractal_dimension=df)
        client = _authed_client(user)

        b2 = _serialize_batch_from_db(str(batch.id))
        resp: Any = client.get(_detail_url(project, batch))
        b3: dict[str, Any] = resp.json()

        assert b2 is not None
        assert b2["stats"]["q1_df"] == b3["stats"]["q1_df"]
        assert b2["stats"]["q3_df"] == b3["stats"]["q3_df"]
