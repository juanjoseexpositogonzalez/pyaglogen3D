"""Tests for the CSV-import v2 parameter contract (Phase 1 gate).

These tests lock in the correctness fixes from tasks T1–T4 of the
``import-aggregate`` change:

- T2: every CSV import stamps the five v2 import keys
  (``primary_particle_diameter_nm``, ``source``, ``original_filename``,
  ``original_format``, ``import_metadata``) BEFORE the model is saved, plus
  the ``parameters_schema_version = "v2"`` stamped by the serializer.
- T3: the parser runs exactly once per upload — the serializer no longer
  re-parses the CSV it has already validated.
- T4: ``compute_import_metrics`` no longer writes the Rg-law-fit fields
  (``sequential_df`` style); ``fractal_dimension`` / ``fractal_dimension_std``
  are ``None`` until T6 wires box-counting.

All requests go through the real DRF viewset using ``APIClient`` so the
contract is verified at the HTTP boundary, not only in unit calls.
"""

from __future__ import annotations

import base64
from unittest.mock import patch

import numpy as np
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation
from apps.simulations.services.params import (
    PARAM_KEY_DIAMETER,
    PARAM_KEY_SCHEMA_VERSION,
)


# --- Fixture helpers ---------------------------------------------------------


def _make_user() -> User:
    """Each test creates its own user to keep fixtures hermetic."""
    import uuid

    return User.objects.create_user(
        email=f"csv-import-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(owner: User) -> Project:
    return Project.objects.create(name="CSV Import Test", owner=owner)


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _csv_payload(rows: list[tuple[float, float, float, float]]) -> str:
    """Encode an (x, y, z, radius) ndarray as base64-utf8 CSV text.

    Base64 encoding matches what the frontend sends today.
    """
    header = "x,y,z,radius\n"
    body = "\n".join(f"{x},{y},{z},{r}" for x, y, z, r in rows)
    raw = (header + body).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def _create_url(project: Project) -> str:
    return reverse("project-simulations-list", kwargs={"project_pk": project.id})


def _post_import(
    client: APIClient,
    project: Project,
    rows: list[tuple[float, float, float, float]],
    *,
    original_filename: str = "agg.csv",
    extra_parameters: dict | None = None,
    csv_override: str | None = None,
):
    """POST a CSV import; returns the DRF response."""
    payload = {
        "algorithm": "imported",
        "parameters": extra_parameters or {},
        "seed": 42,
        "csv_data": csv_override if csv_override is not None else _csv_payload(rows),
        "original_filename": original_filename,
    }
    return client.post(_create_url(project), payload, format="json")


# --- T2: five import-contract stamps + v2 schema version ---------------------


@pytest.mark.django_db
def test_csv_import_stamps_diameter_from_mean_radius() -> None:
    """primary_particle_diameter_nm = 2 * mean(radius) when no metadata override.

    Uses N=10 spheres with radii in [10, 15] nm — mean radius is 12.5 nm, so
    the stamped diameter must be 25.0 nm. Locks R3 scenario "Implicit diameter
    from mean radius".
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    radii = [10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 10.5, 12.5, 13.5, 14.5]
    rows = [(float(i), 0.0, 0.0, r) for i, r in enumerate(radii)]
    expected_diameter = 2.0 * float(np.mean(radii))

    response = _post_import(client, project, rows)

    assert response.status_code == 201, response.content
    sim = Simulation.objects.get(id=response.data["id"])
    assert PARAM_KEY_DIAMETER in sim.parameters
    assert sim.parameters[PARAM_KEY_DIAMETER] == pytest.approx(expected_diameter)


@pytest.mark.django_db
def test_csv_import_stamps_schema_version_v2() -> None:
    """The serializer's existing v2 stamp still lands on CSV imports.

    T2 must NOT touch the serializer's ``parameters_schema_version`` write.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    rows = [(float(i), 0.0, 0.0, 1.0) for i in range(5)]
    response = _post_import(client, project, rows)

    assert response.status_code == 201, response.content
    sim = Simulation.objects.get(id=response.data["id"])
    assert sim.parameters[PARAM_KEY_SCHEMA_VERSION] == "v2"


@pytest.mark.django_db
def test_csv_import_stamps_source_filename_and_format() -> None:
    """Four metadata stamps land: source, original_filename, original_format, import_metadata.

    With T12 the ``import_metadata`` dict is populated by the CSV parser:
    at minimum ``unit`` defaults to ``"nm"`` and the locale sniffer stamps
    ``detected_decimal`` / ``detected_delimiter`` / ``locale_warning``.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    rows = [(float(i), 0.0, 0.0, 1.0) for i in range(3)]
    response = _post_import(client, project, rows, original_filename="my-aggregate.csv")

    assert response.status_code == 201, response.content
    sim = Simulation.objects.get(id=response.data["id"])
    assert sim.parameters["source"] == "csv_import"
    assert sim.parameters["original_filename"] == "my-aggregate.csv"
    assert sim.parameters["original_format"] == "csv"
    # T12+T13: metadata dict is populated (not empty) — contains defaults +
    # locale sniffer output.
    meta = sim.parameters["import_metadata"]
    assert meta["unit"] == "nm"
    assert meta["detected_delimiter"] == ","
    assert meta["detected_decimal"] == "."
    assert "locale_warning" in meta


# --- Content-validation rejections (400, not 500) ---------------------------


@pytest.mark.django_db
def test_csv_import_missing_radius_column_rejected() -> None:
    """CSV without a ``radius`` column must be rejected at the API boundary."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    # No 'radius' column.
    raw = b"x,y,z\n0,0,0\n1,1,1\n"
    payload = base64.b64encode(raw).decode("ascii")
    response = _post_import(client, project, rows=[], csv_override=payload)

    assert response.status_code == 400, response.content


@pytest.mark.django_db
def test_csv_import_negative_radius_rejected() -> None:
    """A negative radius must produce 400 (not 500)."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    rows = [(0.0, 0.0, 0.0, -1.0), (1.0, 0.0, 0.0, 1.0)]
    response = _post_import(client, project, rows)

    assert response.status_code == 400, response.content


@pytest.mark.django_db
def test_csv_import_invalid_base64_rejected() -> None:
    """Malformed base64 must yield 400, not bubble up as 500."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    # Characters outside the base64 alphabet.
    response = _post_import(client, project, rows=[], csv_override="not!valid!base64!")

    assert response.status_code == 400, response.content


# --- T3: single-parse guarantee ---------------------------------------------


@pytest.mark.django_db
def test_csv_import_parses_exactly_once() -> None:
    """``parse_csv_geometry`` is called EXACTLY once per upload.

    Before T3, the serializer validator re-parsed the CSV after the view
    had already parsed it to build the geometry — a wasted decode + tokenize
    pass on every import. The patch intercepts the parser and asserts
    ``call_count == 1``.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    rows = [(float(i), 0.0, 0.0, 1.0) for i in range(5)]

    import apps.simulations.views as views_module

    with patch.object(
        views_module,
        "parse_csv_geometry",
        wraps=views_module.parse_csv_geometry,
    ) as spy:
        response = _post_import(client, project, rows)

    assert response.status_code == 201, response.content
    assert spy.call_count == 1, (
        f"parse_csv_geometry should run exactly once per import; "
        f"got {spy.call_count} calls"
    )


# --- T4: sequential_df / Rg-law fit is gone ---------------------------------


@pytest.mark.django_db
def test_compute_import_metrics_no_sequential_df() -> None:
    """After import completes, ``metrics`` must not carry Rg-law-fit fields.

    Celery runs eagerly in tests (``CELERY_TASK_ALWAYS_EAGER = True``), so the
    metrics task fires inline during the POST. T4 removed the Rg-law fit
    entirely, so ``rg_evolution`` must also be absent from import metrics.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    rows = [(float(i), 0.0, 0.0, 1.0) for i in range(10)]
    response = _post_import(client, project, rows)

    assert response.status_code == 201, response.content
    sim = Simulation.objects.get(id=response.data["id"])
    sim.refresh_from_db()

    metrics = sim.metrics or {}
    # The Rg-law fit used to write these keys in the imported path:
    assert "sequential_df" not in metrics
    assert "sequential_kf" not in metrics
    # Removed by T4 because per-particle add order is not meaningful for imports.
    assert "rg_evolution" not in metrics
    # Fractal dimension is explicitly None until T6 wires box-counting.
    assert metrics.get("fractal_dimension") is None
    assert metrics.get("fractal_dimension_std") is None
    # Non-fractal metrics still land.
    assert isinstance(metrics.get("radius_of_gyration"), float)


# --- Additional defensive check --------------------------------------------


@pytest.mark.django_db
def test_csv_import_empty_body_rejected() -> None:
    """A CSV with only a header (no data rows) must be rejected cleanly."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    raw = b"x,y,z,radius\n"
    payload = base64.b64encode(raw).decode("ascii")
    response = _post_import(client, project, rows=[], csv_override=payload)

    assert response.status_code == 400, response.content


# --- Regression: MATLAB-exported CSV + frontend payload shape ---------------
#
# The user-reported 400 came from a MATLAB ``writematrix`` export on a
# Spanish Windows locale, submitted through ``ImportAggregateDialog.tsx``
# which nests ``original_filename`` and ``format`` inside ``parameters``.
# The two tests below lock both sides of the fix: the CSV content side
# (Latin-1 + Spanish headers + ; delimiter + , decimal) AND the payload
# shape side (fields inside ``parameters`` instead of at the top level).


@pytest.mark.django_db
def test_csv_import_matlab_spanish_latin1_http_success() -> None:
    """End-to-end: the user-reported file shape produces 201, not 400.

    Synthetic sanitized coordinates — not the user's real data — shaped
    exactly like a MATLAB ``writematrix`` export on a Spanish Windows
    locale: Latin-1 bytes, Spanish column labels with ``[nm]`` unit
    annotations, ``;`` delimiter, ``,`` decimals, extra ``Partícula`` and
    ``Aplastamiento`` columns that the parser must ignore.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    header = (
        "Partícula;Coordenada x [nm];Coordenada y [nm];"
        "Coordenada z [nm];Radio [nm];Aplastamiento\n"
    )
    rows = "\r\n".join(
        [
            "1;-10,50;-12,25;-5,75;12,5;1",
            "2;-20,00;-10,00;-25,00;12,5;1",
            "3;0,50;-8,00;10,00;12,5;1",
            "4;5,00;15,00;30,00;12,5;1",
            "5;-15,00;-10,00;-50,00;12,5;1",
            "6;-8,00;2,00;-70,00;12,5;1",
        ]
    )
    raw = (header + rows + "\r\n").encode("latin-1")
    payload = base64.b64encode(raw).decode("ascii")

    response = _post_import(
        client,
        project,
        rows=[],
        csv_override=payload,
        original_filename="Aglo001.csv",
    )

    assert response.status_code == 201, response.content
    sim = Simulation.objects.get(id=response.data["id"])
    # 6 synthetic particles all with radius 12.5 nm → diameter 25 nm.
    assert sim.parameters[PARAM_KEY_DIAMETER] == pytest.approx(25.0)
    # The parser stamped the locale info into import_metadata so the UI
    # can surface it.
    meta = sim.parameters["import_metadata"]
    assert meta["detected_encoding"] == "latin-1"
    assert meta["detected_delimiter"] == ";"
    assert meta["detected_decimal"] == ","


@pytest.mark.django_db
def test_csv_import_accepts_filename_and_format_inside_parameters() -> None:
    """The current frontend nests ``original_filename`` + ``format`` inside
    ``parameters``. The backend must read from either location — top level
    (legacy scripts / curl) or ``parameters.*`` (the real UI).

    This locks the payload-shape compat fix. The test sends the exact
    shape produced by ``ImportAggregateDialog.tsx``: a ``parameters`` dict
    carrying ``original_filename`` and ``format``, with ``csv_data`` and
    ``algorithm`` at the top level.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    rows = [(float(i), 0.0, 0.0, 1.0) for i in range(5)]
    payload_csv = _csv_payload(rows)
    payload = {
        "algorithm": "imported",
        "parameters": {
            "original_filename": "from-ui.csv",
            "format": "csv",
        },
        "seed": 42,
        "csv_data": payload_csv,
    }

    response = client.post(_create_url(project), payload, format="json")

    assert response.status_code == 201, response.content
    sim = Simulation.objects.get(id=response.data["id"])
    # The filename from ``parameters.original_filename`` landed on the
    # stamped simulation (not an empty string from the missing top-level).
    assert sim.parameters["original_filename"] == "from-ui.csv"
    assert sim.parameters["original_format"] == "csv"
