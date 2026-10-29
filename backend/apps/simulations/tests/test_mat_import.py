"""Tests for the MATLAB ``.mat`` importer and the ``.dat`` rejection.

These tests lock in T8–T11 of the ``import-aggregate`` change:

- T8: :func:`parse_mat_geometry` extracts an ``(N, 4)`` geometry from a
  ``clusters`` or ``part`` variable, rejects v7.3 (HDF5) files, rejects
  multi-agglomerate files (``NofPart`` length > 1), and rejects wrong
  array shapes.
- T9: the upload view routes ``.mat`` files through the shared post-parse
  pipeline — the v2 import-contract stamps land exactly the same as for
  CSV (``primary_particle_diameter_nm``, ``source``, ``original_format``,
  ``import_metadata``, etc.).
- T10: the view rejects ``.dat`` uploads with the exact spec R7 message
  BEFORE any parsing happens.
- T11: this file.

All uploads go through the real DRF viewset using ``APIClient`` so the
contract is verified at the HTTP boundary — same pattern as
``test_csv_import_v2_contract.py``.
"""

from __future__ import annotations

import base64
import uuid
from io import BytesIO
from unittest.mock import patch

import numpy as np
import pytest
import scipy.io
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation
from apps.simulations.services.mat_parser import (
    MatParseError,
    parse_mat_geometry,
)


# --- Fixture helpers ---------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"mat-import-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(owner: User) -> Project:
    return Project.objects.create(name="MAT Import Test", owner=owner)


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _create_url(project: Project) -> str:
    return reverse("project-simulations-list", kwargs={"project_pk": project.id})


def _mat_bytes(variables: dict[str, np.ndarray]) -> bytes:
    """Serialize a dict of variables into a v7 ``.mat`` byte blob.

    ``scipy.io.savemat`` emits v5 (pre-v7) by default, which loadmat handles
    identically to v7 — both are "non-HDF5" from our perspective.
    """
    buf = BytesIO()
    scipy.io.savemat(buf, variables, format="5")
    return buf.getvalue()


def _post_mat_import(
    client: APIClient,
    project: Project,
    mat_payload: bytes,
    *,
    original_filename: str = "agg.mat",
    extra_parameters: dict | None = None,
):
    """POST a ``.mat`` import via the upload endpoint."""
    payload_b64 = base64.b64encode(mat_payload).decode("ascii")
    body = {
        "algorithm": "imported",
        "parameters": extra_parameters or {},
        "seed": 42,
        "csv_data": payload_b64,  # field name is a historical misnomer
        "original_filename": original_filename,
    }
    return client.post(_create_url(project), body, format="json")


def _post_raw_upload(
    client: APIClient,
    project: Project,
    *,
    raw_bytes: bytes,
    original_filename: str,
):
    """POST arbitrary bytes at the upload endpoint (for .dat rejection)."""
    body = {
        "algorithm": "imported",
        "parameters": {},
        "seed": 1,
        "csv_data": base64.b64encode(raw_bytes).decode("ascii"),
        "original_filename": original_filename,
    }
    return client.post(_create_url(project), body, format="json")


# --- Parser-level unit tests (no HTTP) --------------------------------------
#
# These exercise :func:`parse_mat_geometry` directly so the test output
# points at parser bugs rather than view wiring. Full end-to-end routing is
# covered by the HTTP tests further down.


def test_parser_clusters_happy_path() -> None:
    """``clusters`` (N, 4) matrix → extracted cleanly with metadata."""
    geometry = np.column_stack(
        [
            np.linspace(0, 9, 10),  # x
            np.zeros(10),  # y
            np.zeros(10),  # z
            np.full(10, 1.5),  # radius
        ]
    )
    payload = _mat_bytes({"clusters": geometry})

    arr, meta = parse_mat_geometry(payload)

    assert arr.shape == (10, 4)
    assert arr.dtype == np.float64
    assert meta == {
        "source": "matlab",
        "original_variable": "clusters",
        "n_particles": 10,
    }


def test_parser_part_with_nofpart_single() -> None:
    """``part`` with ``NofPart=[N]`` → treated as single agglomerate."""
    geometry = np.column_stack([np.arange(8.0), np.zeros(8), np.zeros(8), np.ones(8)])
    payload = _mat_bytes({"part": geometry, "NofPart": np.array([8])})

    arr, meta = parse_mat_geometry(payload)

    assert arr.shape == (8, 4)
    assert meta["original_variable"] == "part"


def test_parser_clusters_wins_over_part() -> None:
    """When both variables exist, ``clusters`` is chosen (spec R6)."""
    clusters = np.column_stack([np.arange(5.0), np.zeros(5), np.zeros(5), np.ones(5)])
    part = np.column_stack([np.arange(20.0), np.zeros(20), np.zeros(20), np.ones(20)])
    payload = _mat_bytes({"clusters": clusters, "part": part})

    arr, meta = parse_mat_geometry(payload)

    # ``clusters`` has 5 rows; ``part`` has 20. The result must be from
    # clusters, not part.
    assert arr.shape == (5, 4)
    assert meta["original_variable"] == "clusters"
    assert meta["n_particles"] == 5


def test_parser_multi_agglomerate_rejected() -> None:
    """``part`` + ``NofPart`` with length > 1 → MatParseError."""
    part = np.column_stack([np.arange(20.0), np.zeros(20), np.zeros(20), np.ones(20)])
    payload = _mat_bytes({"part": part, "NofPart": np.array([10, 10])})

    with pytest.raises(MatParseError, match="Multi-agglomerate"):
        parse_mat_geometry(payload)


def test_parser_wrong_shape_rejected() -> None:
    """``clusters`` with shape (N, 3) (missing radius col) → MatParseError."""
    bad = np.column_stack([np.arange(10.0), np.zeros(10), np.zeros(10)])  # (10, 3)
    payload = _mat_bytes({"clusters": bad})

    with pytest.raises(MatParseError, match="shape"):
        parse_mat_geometry(payload)


def test_parser_negative_radius_rejected() -> None:
    """Any non-positive radius in column 3 → MatParseError."""
    geometry = np.column_stack(
        [np.arange(5.0), np.zeros(5), np.zeros(5), [1.0, 1.0, -0.5, 1.0, 1.0]]
    )
    payload = _mat_bytes({"clusters": geometry})

    with pytest.raises(MatParseError, match="non-positive"):
        parse_mat_geometry(payload)


def test_parser_missing_variable_rejected() -> None:
    """Neither ``clusters`` nor ``part`` present → MatParseError."""
    payload = _mat_bytes({"some_other_name": np.ones((5, 4))})

    with pytest.raises(MatParseError, match="No geometry variable"):
        parse_mat_geometry(payload)


def test_parser_v73_hdf5_rejected_with_message() -> None:
    """v7.3 files raise ``NotImplementedError`` in scipy → MatParseError.

    We can't easily construct a real v7.3 file inline (it needs h5py), so we
    patch ``scipy.io.loadmat`` at the parser's import site to raise the
    exception scipy raises for HDF5 input.
    """
    import apps.simulations.services.mat_parser as mat_parser_module

    # Any bytes work here; the patched loadmat never inspects them.
    with patch.object(
        mat_parser_module.scipy.io,
        "loadmat",
        side_effect=NotImplementedError("v7.3 files are not supported"),
    ):
        with pytest.raises(MatParseError) as exc_info:
            parse_mat_geometry(b"\x00\x00fake")

    msg = str(exc_info.value)
    assert "v7.3" in msg or "HDF5" in msg, (
        f"v7.3 rejection message must mention v7.3 or HDF5; got: {msg!r}"
    )


# --- HTTP / end-to-end tests ------------------------------------------------


@pytest.mark.django_db
def test_mat_clusters_happy_path_http() -> None:
    """POST a ``.mat`` with ``clusters`` → 201 + all v2 import stamps."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    radii = np.array([1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 1.1, 1.3, 1.5, 1.7])
    geometry = np.column_stack([np.arange(10.0), np.zeros(10), np.zeros(10), radii])
    payload = _mat_bytes({"clusters": geometry})

    response = _post_mat_import(
        client, project, payload, original_filename="my_agg.mat"
    )

    assert response.status_code == 201, response.content
    sim = Simulation.objects.get(id=response.data["id"])

    # Every v2 import-contract stamp lands, with .mat-specific values.
    assert sim.parameters["source"] == "mat_import"
    assert sim.parameters["original_format"] == "mat"
    assert sim.parameters["original_filename"] == "my_agg.mat"
    assert sim.parameters["import_metadata"] == {
        "source": "matlab",
        "original_variable": "clusters",
        "n_particles": 10,
    }
    # Diameter = 2 * mean(radius). Computed from the radii above.
    assert sim.parameters["primary_particle_diameter_nm"] == pytest.approx(
        2.0 * float(np.mean(radii))
    )
    # Schema version still stamped by the serializer.
    assert sim.parameters["parameters_schema_version"] == "v2"


@pytest.mark.django_db
def test_mat_part_with_nofpart_single_http() -> None:
    """``part`` + ``NofPart=[N]`` happy path via the HTTP endpoint."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    geometry = np.column_stack(
        [np.arange(6.0), np.zeros(6), np.zeros(6), np.full(6, 2.5)]
    )
    payload = _mat_bytes({"part": geometry, "NofPart": np.array([6])})

    response = _post_mat_import(client, project, payload)

    assert response.status_code == 201, response.content
    sim = Simulation.objects.get(id=response.data["id"])
    assert sim.parameters["import_metadata"]["original_variable"] == "part"
    assert sim.parameters["n_particles"] == 6


@pytest.mark.django_db
def test_mat_clusters_wins_over_part_http() -> None:
    """End-to-end: both variables present → ``clusters`` is used."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    # Different row counts make the winner unambiguous.
    clusters = np.column_stack([np.arange(3.0), np.zeros(3), np.zeros(3), np.ones(3)])
    part = np.column_stack([np.arange(17.0), np.zeros(17), np.zeros(17), np.ones(17)])
    payload = _mat_bytes({"clusters": clusters, "part": part})

    response = _post_mat_import(client, project, payload)

    assert response.status_code == 201, response.content
    sim = Simulation.objects.get(id=response.data["id"])
    # Must be clusters (3 particles), not part (17).
    assert sim.parameters["import_metadata"]["original_variable"] == "clusters"
    assert sim.parameters["n_particles"] == 3


@pytest.mark.django_db
def test_mat_multi_agglomerate_rejected_http() -> None:
    """``part`` + multi-element ``NofPart`` → 400 with clear message."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    part = np.column_stack([np.arange(20.0), np.zeros(20), np.zeros(20), np.ones(20)])
    payload = _mat_bytes({"part": part, "NofPart": np.array([10, 10])})

    response = _post_mat_import(client, project, payload)

    assert response.status_code == 400, response.content
    # The error message lands in csv_data (parser errors channel through
    # the payload field by convention — same as CSVParseError).
    assert "Multi-agglomerate" in str(response.content)


@pytest.mark.django_db
def test_mat_wrong_shape_rejected_http() -> None:
    """``clusters`` with shape (N, 3) → 400 with shape error."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    bad = np.column_stack(
        [np.arange(10.0), np.zeros(10), np.zeros(10)]
    )  # (10, 3) — missing radius column
    payload = _mat_bytes({"clusters": bad})

    response = _post_mat_import(client, project, payload)

    assert response.status_code == 400, response.content
    assert b"shape" in response.content


@pytest.mark.django_db
def test_mat_v73_hdf5_rejected_http() -> None:
    """Patched-loadmat HDF5 rejection surfaces as 400 with v7.3 hint."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    import apps.simulations.services.mat_parser as mat_parser_module

    # The payload bytes don't matter — loadmat is patched to raise before
    # seeing them. We still need a valid base64 blob with the right size
    # for the serializer to accept it.
    fake_payload = b"fake mat bytes for patched test"

    with patch.object(
        mat_parser_module.scipy.io,
        "loadmat",
        side_effect=NotImplementedError("v7.3 files are not supported"),
    ):
        response = _post_mat_import(
            client, project, fake_payload, original_filename="v73.mat"
        )

    assert response.status_code == 400, response.content
    body = response.content.decode("utf-8")
    assert "v7.3" in body or "HDF5" in body, (
        f"Response must mention v7.3 or HDF5; got: {body!r}"
    )


# --- .dat rejection (T10 / spec R7) -----------------------------------------


@pytest.mark.django_db
def test_dat_extension_rejected() -> None:
    """``.dat`` extension → 400 with the EXACT spec R7 message.

    The error message is a verbatim copy of the spec scenario — we assert
    the key phrase so a paraphrase regression is caught. Rejection must
    happen BEFORE any parser runs, so the payload bytes can be garbage.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    # Garbage bytes — the view must reject before parsing.
    response = _post_raw_upload(
        client,
        project,
        raw_bytes=b"not a real .dat file, just bytes",
        original_filename="surface.dat",
    )

    assert response.status_code == 400, response.content
    body = response.content.decode("utf-8")
    # Exact phrases from spec R7 scenario — if any of these fail, the
    # message has drifted from the spec.
    assert "tessellated surface" in body
    assert ".dat format" in body
    assert "(x, y, z, radius)" in body


@pytest.mark.django_db
def test_dat_rejection_runs_before_parse() -> None:
    """A ``.dat`` upload must NOT trigger the CSV or MAT parser.

    Using garbage base64 that would fail BOTH parsers — if either parser
    ran, we'd get a parser-specific error message instead of the spec R7
    wording.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    # Not valid UTF-8 (would fail CSV path), not valid .mat (would fail
    # mat parser). The fact that we still get the .dat message proves the
    # reject-before-parse order.
    response = _post_raw_upload(
        client,
        project,
        raw_bytes=b"\x00\x01\x02\x03\xff\xfe",
        original_filename="my_agglomerate.dat",
    )

    assert response.status_code == 400, response.content
    assert "tessellated surface points" in response.content.decode("utf-8")
