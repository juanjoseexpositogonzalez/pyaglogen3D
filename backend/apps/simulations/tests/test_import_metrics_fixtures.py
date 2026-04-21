"""Fixture tests for T6 box-counting on imported geometries.

These tests lock in the behavior added in T6 of the ``import-aggregate``
change: ``compute_import_metrics`` runs box-counting via
``aglogen_core.box_counting_agglomerate`` as the primary Df source for
imported geometries, with an N >= 50 threshold, graceful failure handling,
and a human-readable note when Df cannot be computed.

Each test builds a known geometry **inline** (the Rust limit-case fixtures
live in the engine crate and are not exposed to Python) and pushes it
through the full import pipeline using the same ``APIClient`` path the
existing ``test_csv_import_v2_contract.py`` suite uses.

Geometries:
    * Linear chain of N touching spheres along x (Df ≈ 1.0).
    * Hex-lattice plane at z = 0 (Df ≈ 2.0).
    * Dense 4x4x4 cubic lattice (Df ≈ 3.0).
    * Small-N chain (N < 50) to lock the threshold note.
    * Degenerate (all coincident) geometry to lock graceful failure.

Tolerances are loose on purpose: box-counting on finite samples only
converges to the topological dimension in the large-N limit. The
tolerances below were measured empirically against the current
``aglogen_core`` binding and include slack for minor parameter drift.
"""

from __future__ import annotations

import base64
import math
import uuid
from typing import Iterable

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation


# --- Fixture helpers ---------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"df-fixture-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(owner: User) -> Project:
    return Project.objects.create(name="Df fixture tests", owner=owner)


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _encode_csv(rows: Iterable[tuple[float, float, float, float]]) -> str:
    header = "x,y,z,radius\n"
    body = "\n".join(f"{x},{y},{z},{r}" for x, y, z, r in rows)
    raw = (header + body).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def _import_and_fetch(
    client: APIClient,
    project: Project,
    rows: list[tuple[float, float, float, float]],
    filename: str = "fixture.csv",
) -> Simulation:
    """POST a CSV import and return the refreshed Simulation row."""
    url = reverse("project-simulations-list", kwargs={"project_pk": project.id})
    payload = {
        "algorithm": "imported",
        "parameters": {},
        "seed": 42,
        "csv_data": _encode_csv(rows),
        "original_filename": filename,
    }
    response = client.post(url, payload, format="json")
    assert response.status_code == 201, response.content
    sim = Simulation.objects.get(id=response.data["id"])
    sim.refresh_from_db()
    return sim


# --- Geometry builders -------------------------------------------------------


def _linear_chain(
    n: int, radius: float = 1.0
) -> list[tuple[float, float, float, float]]:
    """N touching unit spheres along the x-axis.

    Spacing ``2*radius`` so the spheres barely touch — box-counting on this
    recovers Df ≈ 1.0 in the large-N limit.
    """
    return [(2.0 * radius * i, 0.0, 0.0, radius) for i in range(n)]


def _hex_plane(
    rows: int, cols: int, radius: float = 1.0
) -> list[tuple[float, float, float, float]]:
    """Hexagonal (2D) close-packing of unit spheres at z = 0.

    Row spacing = ``radius * sqrt(3)`` (dense 2D packing). Alternate rows
    offset by one radius. Covers a filled planar area → Df ≈ 2.0.
    """
    coords: list[tuple[float, float, float, float]] = []
    dx = 2.0 * radius
    dy = math.sqrt(3.0) * radius
    for j in range(rows):
        offset = radius if j % 2 == 1 else 0.0
        for i in range(cols):
            x = dx * i + offset
            y = dy * j
            coords.append((x, y, 0.0, radius))
    return coords


def _cubic_lattice(
    side: int, radius: float = 1.0
) -> list[tuple[float, float, float, float]]:
    """Dense ``side``³ simple-cubic lattice. Fills a solid cube → Df ≈ 3.0."""
    spacing = 2.0 * radius
    return [
        (spacing * i, spacing * j, spacing * k, radius)
        for i in range(side)
        for j in range(side)
        for k in range(side)
    ]


# --- T7 tests ----------------------------------------------------------------


@pytest.mark.django_db
def test_linear_chain_df_approx_1() -> None:
    """N=60 linear chain → Df close to 1.0 with a finite std.

    Tolerance 0.2 is loose enough to absorb finite-size drift (chain has
    only one direction with structure at scale > 2r) while still catching
    regressions that would push Df toward 2 or 3.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    sim = _import_and_fetch(client, project, _linear_chain(60))
    metrics = sim.metrics or {}

    df = metrics.get("fractal_dimension")
    df_std = metrics.get("fractal_dimension_std")
    assert df is not None, f"metrics={metrics!r}"
    assert df_std is not None
    assert abs(df - 1.0) < 0.2, f"Df={df} for linear chain (expected ~1.0)"


@pytest.mark.django_db
def test_planar_hex_df_approx_2() -> None:
    """Hex-packed 2D plane (5x10 = 50 spheres) → Df ≈ 2.0."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    rows = _hex_plane(rows=5, cols=10)
    assert len(rows) >= 50  # sanity: must clear the threshold

    sim = _import_and_fetch(client, project, rows)
    metrics = sim.metrics or {}

    df = metrics.get("fractal_dimension")
    assert df is not None, f"metrics={metrics!r}"
    # Tolerance widened to 0.35 after empirical measurement: box-counting
    # on a strictly planar arrangement of spheres sampled with
    # ``points_per_sphere=100`` (the default) bleeds into the z axis
    # slightly because each sphere paints a 3D shell, pushing Df a bit
    # above 2. Measured value ~2.28 at N=50; 0.35 leaves room for minor
    # drift without hiding real regressions (Df=1 or Df=3 still trip).
    assert abs(df - 2.0) < 0.35, f"Df={df} for planar hex (expected ~2.0)"


@pytest.mark.django_db
def test_dense_cube_df_approx_3() -> None:
    """4x4x4 = 64 sphere cubic lattice → Df ≈ 3.0."""
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    rows = _cubic_lattice(side=4)
    assert len(rows) == 64

    sim = _import_and_fetch(client, project, rows)
    metrics = sim.metrics or {}

    df = metrics.get("fractal_dimension")
    assert df is not None, f"metrics={metrics!r}"
    assert abs(df - 3.0) < 0.35, f"Df={df} for dense cube (expected ~3.0)"


@pytest.mark.django_db
def test_small_n_returns_none() -> None:
    """N < 50 → Df and Df-std are None with the spec-mandated note.

    Also guarantees non-fractal geometric metrics (Rg, porosity, coord)
    are STILL computed — threshold only guards the box-counting step.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    sim = _import_and_fetch(client, project, _linear_chain(20))
    metrics = sim.metrics or {}

    assert metrics.get("fractal_dimension") is None
    assert metrics.get("fractal_dimension_std") is None

    notes = metrics.get("notes") or {}
    assert "fractal_dimension" in notes
    assert "Insufficient particles" in notes["fractal_dimension"]

    # Other metrics must still land — the threshold must not gate them.
    assert isinstance(metrics.get("radius_of_gyration"), float)
    assert metrics["radius_of_gyration"] > 0.0
    assert isinstance(metrics.get("porosity"), float)
    coord = metrics.get("coordination") or {}
    assert isinstance(coord.get("mean"), (int, float))


@pytest.mark.django_db
def test_box_counting_failure_graceful() -> None:
    """All-coincident geometry must not raise.

    This is a pathological input that stresses the Morton box-counter
    (zero-extent bounding box). The contract is: the task survives, the
    simulation is created, Df may be None or a weird value, but the
    import NEVER crashes — an import-metrics failure must not poison
    the whole pipeline.
    """
    user = _make_user()
    project = _make_project(user)
    client = _authed_client(user)

    # 55 spheres all at the origin: clears N>=50, but zero spatial extent.
    rows = [(0.0, 0.0, 0.0, 1.0) for _ in range(55)]

    sim = _import_and_fetch(client, project, rows)
    metrics = sim.metrics or {}

    # The task didn't raise — that's the main contract. Df may be a
    # number, None, or NaN (we only require no crash and that the row
    # was created with *some* metrics dict).
    assert metrics is not None
    # Other geometric metrics should still be computable (Rg = 0 at origin
    # is a valid, finite value; we just require the key is present).
    assert "radius_of_gyration" in metrics
