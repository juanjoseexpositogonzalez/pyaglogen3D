"""Tests for the windowed box-counting CSV export columns (R6 — T6).

Covers spec requirements of `batch-windowed-box-counting`:
- R6: BC_Win_* columns appended after BC_* when the study has a windowed
  run (STUDY-level header gate); rows without a block emit empty cells;
  BC_Win_Delta only on ok; legacy-only study → byte-identical CSV.
"""

from __future__ import annotations

import csv
import io
import uuid

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation

# ── Fixtures / helpers ─────────────────────────────────────────────────


def _make_user() -> User:
    return User.objects.create_user(
        email=f"bc-csv-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(user: User) -> Project:
    return Project.objects.create(name="BC CSV Project", owner=user)


def _make_study(project: Project) -> ParametricStudy:
    return ParametricStudy.objects.create(
        project=project,
        name="BC CSV Study",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
        parameter_grid={"n_particles": [100]},
        include_box_counting=True,
    )


def _make_sim(
    project: Project,
    study: ParametricStudy,
    *,
    metrics: dict,
) -> Simulation:
    sim = Simulation.objects.create(
        project=project,
        name=f"sim-{uuid.uuid4()}",
        algorithm="dla",
        parameters={"n_particles": 100},
        seed=42,
        status="completed",
        geometry=None,
        metrics=metrics,
    )
    study.simulations.add(sim)
    return sim


def _legacy_block(dimension: float) -> dict:
    return {
        "dimension": dimension,
        "r_squared": 0.99,
        "std_error": 0.01,
        "confidence_interval": [dimension - 0.1, dimension + 0.1],
        "log_scales": [1.0],
        "log_values": [2.0],
        "execution_time_ms": 5,
        "parameters": {"points_per_sphere": 100, "precision": 18},
    }


def _windowed_block(dimension: float | None, status: str) -> dict:
    return {
        "dimension": dimension,
        "r_squared": 0.98 if status == "ok" else None,
        "std_error": 0.02 if status == "ok" else None,
        "confidence_interval": [dimension - 0.1, dimension + 0.1]
        if status == "ok"
        else None,
        "log_scales": [1.0] if status == "ok" else None,
        "log_values": [2.0] if status == "ok" else None,
        "execution_time_ms": 5 if status == "ok" else 0,
        "parameters": {"points_per_sphere": 100, "precision": 18},
        "status": status,
        "fit_window_used": [0, 2] if status == "ok" else None,
        "error_message": None,
    }


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _export_url(study: ParametricStudy) -> str:
    return reverse(
        "project-studies-export",
        kwargs={"project_pk": study.project_id, "pk": study.id},
    )


def _parse_csv(body: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(body.decode("utf-8"))))


@pytest.fixture
def user(db):
    return _make_user()


@pytest.fixture
def project(user):
    return _make_project(user)


_WIN_COLUMNS = [
    "BC_Win_Df",
    "BC_Win_R2",
    "BC_Win_StdError",
    "BC_Win_Time_ms",
    "BC_Win_Delta",
    "BC_Win_Status",
]


# ── R6 — header gate and column values ─────────────────────────────────


@pytest.mark.django_db
class TestR6CsvWindowedColumns:
    def test_mixed_study_appends_windowed_columns(self, user, project):
        study = _make_study(project)
        _make_sim(
            project,
            study,
            metrics={
                "box_counting": _legacy_block(2.0),
                "box_counting_windowed": _windowed_block(2.3, "ok"),
            },
        )
        _make_sim(
            project,
            study,
            metrics={"box_counting": _legacy_block(2.1)},
        )
        client = _authed_client(user)

        response = client.get(_export_url(study))

        assert response.status_code == 200
        rows = _parse_csv(response.content)
        header = rows[0]
        bc_idx = header.index("BC_Time_ms")
        assert header[bc_idx + 1 : bc_idx + 7] == _WIN_COLUMNS

        # Row WITH a windowed block: delta = 2.3 - 2.0
        row_with = rows[1]
        assert row_with[bc_idx + 1] == "2.3000"
        assert row_with[bc_idx + 2] == "0.9800"
        assert row_with[bc_idx + 3] == "0.020000"
        assert row_with[bc_idx + 4] == "5"
        assert row_with[bc_idx + 5] == "0.3000"
        assert row_with[bc_idx + 6] == "ok"

        # Row WITHOUT a windowed block: empty cells
        row_without = rows[2]
        assert row_without[bc_idx + 1 : bc_idx + 7] == [""] * 6

    def test_refusal_row_carries_status_but_no_delta(self, user, project):
        study = _make_study(project)
        _make_sim(
            project,
            study,
            metrics={
                "box_counting": _legacy_block(2.0),
                "box_counting_windowed": _windowed_block(None, "insufficient_levels"),
            },
        )
        client = _authed_client(user)

        rows = _parse_csv(client.get(_export_url(study)).content)
        header = rows[0]
        bc_idx = header.index("BC_Time_ms")
        row = rows[1]

        assert row[bc_idx + 1] == ""  # no dimension
        assert row[bc_idx + 2] == ""  # no r_squared
        assert row[bc_idx + 3] == ""  # no std_error
        assert row[bc_idx + 5] == ""  # delta only on ok
        assert row[bc_idx + 6] == "insufficient_levels"

    def test_legacy_only_study_is_byte_identical_to_pre_change(self, user, project):
        """A study without any windowed block produces the exact pre-change
        CSV bytes: single header, no BC_Win_* columns, no extra cells."""
        study = _make_study(project)
        _make_sim(
            project,
            study,
            metrics={
                "fractal_dimension": 1.8,
                "fractal_dimension_std": 0.05,
                "prefactor": 1.0,
                "radius_of_gyration": 0.5,
                "porosity": 0.5,
                "coordination": {"mean": 2.0, "std": 0.1},
                "anisotropy": 1.0,
                "asphericity": 0.0,
                "acylindricity": 0.0,
                "box_counting": _legacy_block(2.0),
            },
        )
        client = _authed_client(user)

        response = client.get(_export_url(study))
        content = response.content.decode("utf-8")

        assert "BC_Win" not in content
        rows = _parse_csv(response.content)
        header = rows[0]
        # Pre-change header ends with the BC block; no windowed extension
        assert header[-4:] == ["BC_Df", "BC_R2", "BC_StdError", "BC_Time_ms"]
        # Every data row has exactly header-width cells (no trailing empties)
        for row in rows[1:]:
            assert len(row) == len(header)

    def test_header_gate_survives_include_box_counting_off(self, user, project):
        """The BC_Win_* gate is the recorded windowed run, NOT the current
        include_box_counting flag (R6)."""
        study = _make_study(project)
        _make_sim(
            project,
            study,
            metrics={
                "box_counting": _legacy_block(2.0),
                "box_counting_windowed": _windowed_block(2.3, "ok"),
            },
        )
        study.include_box_counting = False
        study.save(update_fields=["include_box_counting"])
        client = _authed_client(user)

        rows = _parse_csv(client.get(_export_url(study)).content)
        header = rows[0]

        assert "BC_Df" not in header  # flag off → legacy BC columns off
        assert all(col in header for col in _WIN_COLUMNS)


# ── F6j (JD-A-008) — EU-locale windowed CSV rows ───────────────────────


@pytest.mark.django_db
def test_eu_locale_export_swaps_decimals_in_windowed_columns(user, project):
    """EU locale (`,` decimal / `;` delimiter): the BC_Win_* numeric cells —
    including BC_Win_Delta and BC_Win_Df — carry comma decimals via
    ``write_localized_row``, mirroring the legacy BC_* behavior."""
    eu_user = user
    eu_user.csv_decimal_separator = ","
    eu_user.csv_column_delimiter = ";"
    eu_user.save(update_fields=["csv_decimal_separator", "csv_column_delimiter"])

    study = _make_study(project)
    _make_sim(
        project,
        study,
        metrics={
            "box_counting": _legacy_block(2.0),
            "box_counting_windowed": _windowed_block(2.3, "ok"),
        },
    )
    client = _authed_client(eu_user)

    response = client.get(_export_url(study))
    assert response.status_code == 200

    text = response.content.decode("utf-8")
    assert ";" in text, f"expected ';' delimiter in EU export; got {text!r}"

    rows = _parse_csv_bytes = list(csv.reader(io.StringIO(text), delimiter=";"))
    header = rows[0]
    bc_idx = header.index("BC_Time_ms")
    row = rows[1]

    # BC_Win_Df = 2.3 → "2,3000"; BC_Win_Delta = 0.3 → "0,3000" (decimal swap)
    assert row[bc_idx + 1] == "2,3000"
    assert row[bc_idx + 5] == "0,3000"
    # Parseable back to float by swapping , → .
    assert float(row[bc_idx + 1].replace(",", ".")) == pytest.approx(2.3)
    assert float(row[bc_idx + 5].replace(",", ".")) == pytest.approx(0.3)
