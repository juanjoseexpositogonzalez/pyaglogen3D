"""Integration tests for CSV export locale + ``radius_nm`` column (T15, T16, T18).

Both single-sim and batch export endpoints honor the authenticated user's
CSV preferences (``csv_decimal_separator``, ``csv_column_delimiter``) and
emit a new ``radius_nm`` column that is unit-scaled via the v1/v2 shim
(``diameter / 2`` = scale factor applied to the engine's dimensionless
radius). These tests cover:

- US locale default (``.`` + ``,``) → matches verify-rg baseline.
- European locale (``,`` + ``;``) → commas in numbers, semicolons between.
- Mixed locale (``.`` + ``;``) → dots in numbers, semicolons between.
- ``radius_nm`` column present in single-sim export (per-row scaled value).
- ``radius_nm`` present in batch export with per-sim scaling (mixed v1/v2).
- Legacy v1 simulation (``primary_particle_radius_nm`` only) exports
  correctly via the params shim.
"""

from __future__ import annotations

import csv
import io
import uuid

import numpy as np
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation


# --- Helpers (mirror test_csv_export_units to keep fixtures local) ----------


def _geometry_bytes(radius: float = 1.0) -> bytes:
    """3-particle chain on the x-axis; deterministic for every test."""
    coords = np.array(
        [
            [0.0, 0.0, 0.0, radius],
            [2.0 * radius, 0.0, 0.0, radius],
            [4.0 * radius, 0.0, 0.0, radius],
        ],
        dtype=np.float64,
    )
    buf = io.BytesIO()
    np.save(buf, coords)
    return buf.getvalue()


def _metrics(rg_engine: float = 0.5) -> dict:
    return {
        "radius_of_gyration": rg_engine,
        "fractal_dimension": 1.8,
        "fractal_dimension_std": 0.05,
        "prefactor": 1.0,
        "porosity": 0.5,
        "coordination": {"mean": 2.0, "std": 0.1},
        "anisotropy": 1.0,
        "asphericity": 0.0,
        "acylindricity": 0.0,
        "principal_moments": [1.0, 1.0, 1.0],
    }


def _make_user(
    *,
    csv_decimal_separator: str = ".",
    csv_column_delimiter: str = ",",
) -> User:
    """Create a user with explicit CSV locale prefs for the test.

    The default matches the migration default (``.`` + ``,``) so tests that
    don't care about locale stay simple.
    """
    user = User.objects.create_user(
        email=f"csv-locale-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )
    user.csv_decimal_separator = csv_decimal_separator
    user.csv_column_delimiter = csv_column_delimiter
    user.save(update_fields=["csv_decimal_separator", "csv_column_delimiter"])
    return user


def _make_project(owner: User) -> Project:
    return Project.objects.create(name="CSV Export Locale Project", owner=owner)


def _make_sim(
    project: Project,
    parameters: dict,
    *,
    rg_engine: float = 0.5,
    radius: float = 1.0,
    name: str = "sim",
    seed: int = 42,
    is_batch: bool = False,
) -> Simulation:
    return Simulation.objects.create(
        project=project,
        name=name,
        algorithm="dla",
        parameters=parameters,
        seed=seed,
        status="completed",
        geometry=_geometry_bytes(radius=radius),
        metrics=_metrics(rg_engine),
        is_batch=is_batch,
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _parse_csv_bytes(body: bytes, delimiter: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(body.decode("utf-8")), delimiter=delimiter))


def _find_row_starts_with(rows: list[list[str]], prefix: str) -> list[str]:
    for row in rows:
        if row and row[0].startswith(prefix):
            return row
    raise AssertionError(
        f"Row starting with {prefix!r} not found; saw: "
        + repr([r[0] if r else "" for r in rows])
    )


# --- T18.1 US single-sim export ---------------------------------------------


@pytest.mark.django_db
def test_export_default_locale_us() -> None:
    """User with ``.`` / ``,`` → US-format single-sim CSV.

    Locks the non-regression: the default user prefs (and anonymous/no-prefs
    callers) produce the same bytes verify-rg shipped.
    """
    user = _make_user()  # defaults to ".", ","
    project = _make_project(user)
    sim = _make_sim(
        project,
        parameters={
            "n_particles": 3,
            "primary_particle_diameter_nm": 40.0,
            "parameters_schema_version": "v2",
        },
    )

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    assert response.status_code == 200, response.content

    # Comma is the delimiter, dot is the decimal. The Rg row stamps nm
    # which must be unaffected.
    rows = _parse_csv_bytes(response.content, delimiter=",")
    rg_row = _find_row_starts_with(rows, "Radius of Gyration")
    assert rg_row[2] == "nm"
    # Rg_nm = 0.5 * 20 = 10.0 under a "." decimal.
    assert "." in rg_row[1]
    assert float(rg_row[1]) == pytest.approx(10.0)


# --- T18.2 EU single-sim export ---------------------------------------------


@pytest.mark.django_db
def test_export_european_locale() -> None:
    """User with ``,`` / ``;`` → EU-format single-sim CSV.

    Numeric cells carry ``,`` decimals, columns are split by ``;``.
    """
    user = _make_user(csv_decimal_separator=",", csv_column_delimiter=";")
    project = _make_project(user)
    sim = _make_sim(
        project,
        parameters={
            "n_particles": 3,
            "primary_particle_diameter_nm": 40.0,
            "parameters_schema_version": "v2",
        },
    )

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    assert response.status_code == 200, response.content

    text = response.content.decode("utf-8")
    # Semicolon is the delimiter — it must appear in the output.
    assert ";" in text, f"expected ';' delimiter in EU export; got {text!r}"

    # Parse with the EU delimiter and verify the Rg cell uses a ","
    # decimal. Rg_nm = 0.5 * 20 = 10.0 → "10,0000"
    rows = _parse_csv_bytes(response.content, delimiter=";")
    rg_row = _find_row_starts_with(rows, "Radius of Gyration")
    assert "," in rg_row[1]
    # Convert back to float by swapping , for . for the assertion only.
    assert float(rg_row[1].replace(",", ".")) == pytest.approx(10.0)
    assert rg_row[2] == "nm"


# --- T18.3 Mixed locale: ``.`` decimal + ``;`` delimiter ---------------------


@pytest.mark.django_db
def test_export_mixed_locale() -> None:
    """User with ``.`` / ``;`` → dot decimals, semicolon columns.

    This covers the "ambiguous heritage" case some European labs use
    (English numbers but local spreadsheet delimiter).
    """
    user = _make_user(csv_decimal_separator=".", csv_column_delimiter=";")
    project = _make_project(user)
    sim = _make_sim(
        project,
        parameters={
            "n_particles": 3,
            "primary_particle_diameter_nm": 40.0,
            "parameters_schema_version": "v2",
        },
    )

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    assert response.status_code == 200, response.content

    text = response.content.decode("utf-8")
    assert ";" in text

    rows = _parse_csv_bytes(response.content, delimiter=";")
    rg_row = _find_row_starts_with(rows, "Radius of Gyration")
    # Dot decimal preserved.
    assert "." in rg_row[1]
    assert float(rg_row[1]) == pytest.approx(10.0)


# --- T18.4 Single-sim ``radius_nm`` column ----------------------------------


@pytest.mark.django_db
def test_export_single_sim_includes_radius_nm_column() -> None:
    """New ``radius_nm`` column is present and carries per-particle values.

    radius_nm[i] = radius_engine[i] * scale_factor_nm where
    scale_factor_nm = diameter_nm / 2 (via the v2 shim). For a uniform
    r_engine = 1.0 chain with dpo = 40, every particle row has
    radius_nm = 1.0 * 20 = 20.
    """
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(
        project,
        parameters={
            "n_particles": 3,
            "primary_particle_diameter_nm": 40.0,
            "parameters_schema_version": "v2",
        },
        radius=1.0,
    )

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    assert response.status_code == 200, response.content

    rows = _parse_csv_bytes(response.content, delimiter=",")
    # Find particle data header row — it follows the "# PARTICLE DATA" line.
    particle_header_index = None
    for i, row in enumerate(rows):
        if row and row[0] == "Particle #":
            particle_header_index = i
            break
    assert particle_header_index is not None, "particle data header not found"
    header = rows[particle_header_index]
    assert "radius_nm" in header, f"radius_nm column missing: {header}"
    radius_nm_col = header.index("radius_nm")

    # Validate the first data row — should be 20.0 nm.
    data_row = rows[particle_header_index + 1]
    assert float(data_row[radius_nm_col]) == pytest.approx(20.0)


# --- T18.5 Batch ``radius_nm`` with mixed dpo --------------------------------


@pytest.mark.django_db
def test_export_batch_includes_radius_nm_per_row() -> None:
    """Batch export carries ``radius_nm`` per row with per-sim scaling.

    Row 1: v1 sim, radius_nm=10 → dpo=20 → scale=10 → radius_nm column = 10.0.
    Row 2: v2 sim, dpo=50 → scale=25 → radius_nm column = 25.0.
    """
    user = _make_user()
    project = _make_project(user)
    v1_sim = _make_sim(
        project,
        parameters={"n_particles": 3, "primary_particle_radius_nm": 10.0},
        name="v1",
        seed=1,
        is_batch=True,
    )
    v2_sim = _make_sim(
        project,
        parameters={
            "n_particles": 3,
            "primary_particle_diameter_nm": 50.0,
            "parameters_schema_version": "v2",
        },
        name="v2",
        seed=2,
        is_batch=True,
    )
    study = ParametricStudy.objects.create(
        project=project,
        name="Mixed study",
        base_algorithm="dla",
        base_parameters={"n_particles": 3},
        parameter_grid={},
        status="completed",
    )
    study.simulations.add(v1_sim, v2_sim)

    url = reverse(
        "project-studies-export",
        kwargs={"project_pk": project.id, "pk": study.id},
    )
    response = _authed_client(user).get(url)
    assert response.status_code == 200, response.content

    rows = _parse_csv_bytes(response.content, delimiter=",")
    assert len(rows) >= 3, f"expected header + 2 rows, got {rows!r}"
    header, *data = rows
    assert "radius_nm" in header, f"header missing radius_nm: {header}"
    rnm_col = header.index("radius_nm")
    id_col = header.index("Simulation ID")
    by_id = {r[id_col]: r for r in data}

    # v1 shim: radius_nm=10 → dpo=20 → scale=10.
    assert float(by_id[str(v1_sim.id)][rnm_col]) == pytest.approx(10.0)
    # v2: dpo=50 → scale=25.
    assert float(by_id[str(v2_sim.id)][rnm_col]) == pytest.approx(25.0)


# --- T18.6 Legacy v1 simulation shim for radius_nm --------------------------


@pytest.mark.django_db
def test_export_v1_legacy_simulation_shim_applies_for_radius_nm() -> None:
    """Legacy v1 sim (only ``primary_particle_radius_nm``) exports correctly.

    The params shim resolves the missing diameter to 2 * radius_nm, so
    radius_nm column values equal ``radius_engine * radius_nm`` which is
    exactly what a consumer of the legacy contract expects.
    """
    user = _make_user()
    project = _make_project(user)
    sim = _make_sim(
        project,
        parameters={
            "n_particles": 3,
            # ONLY the v1 legacy key — no v2 diameter stamp, no version stamp.
            "primary_particle_radius_nm": 25.0,
        },
        radius=1.0,
    )

    url = reverse(
        "project-simulations-export",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )
    response = _authed_client(user).get(url)
    assert response.status_code == 200, response.content

    rows = _parse_csv_bytes(response.content, delimiter=",")
    particle_header_index = None
    for i, row in enumerate(rows):
        if row and row[0] == "Particle #":
            particle_header_index = i
            break
    assert particle_header_index is not None
    header = rows[particle_header_index]
    rnm_col = header.index("radius_nm")

    # v1 shim: radius=25 → dpo=50 → scale=25. radius_engine=1.0 →
    # radius_nm = 1.0 * 25 = 25.0.
    data_row = rows[particle_header_index + 1]
    assert float(data_row[rnm_col]) == pytest.approx(25.0)
