"""Pixel-accuracy regression tests for projection scale metadata.

These tests verify that the `pixels_per_100nm` value stamped in metadata.json
is computed from the 2D projected bounding box (correct) rather than the 3D
axis-aligned bounding box (incorrect — PYA-8 bug).

The core property under test:
    For an anisotropic aggregate, per-direction scale VARIES across
    viewing directions. The 3D AABB gives a constant (wrong) value.

Secondary property (end-to-end):
    metadata.pixels_per_100nm must predict the actual rendered pixel scale.
"""

from __future__ import annotations

import io
import json
import zipfile

import numpy as np
import pytest
from PIL import Image

from apps.simulations.services.projection import render_projection_dual_png
from apps.simulations.services.projections import build_metadata_json
from apps.simulations.services.params import get_scale_factor_nm


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _build_elongated_aggregate() -> tuple[np.ndarray, np.ndarray, float]:
    """Build an elongated (anisotropic) aggregate: 10 primaries in a line.

    Particles placed along the X axis at x=0,2,4,...,18, all at y=z=0.
    Radius = 1.0 each.

    3D AABB: X span = 18 + 2*1 = 20, Y span = 0 + 2*1 = 2, Z span = 2
    → max 3D extent = 20 (X axis dominates)

    Projection convention: az=0, el=0 looks along the +X axis.
    At (az=0, el=0): all particles overlap → 2D bbox max = 2
    At (az=90, el=0): particles spread in projected space → 2D bbox max = 20

    The BUG direction is (az=0, el=0): 3D AABB uses 20, correct 2D is 2.
    """
    n = 10
    positions = np.zeros((n, 3), dtype=np.float64)
    positions[:, 0] = np.arange(n) * 2.0  # x = 0, 2, 4, ..., 18
    radii = np.ones(n, dtype=np.float64)
    dpo_nm = 50.0
    return positions, radii, dpo_nm


def _compute_scale_2d_bbox(
    positions: np.ndarray,
    radii: np.ndarray,
    azimuth: float,
    elevation: float,
    img_size: int,
    scale_factor_nm: float,
) -> float:
    """Compute pixels_per_100nm from 2D bbox (the CORRECT method)."""
    _, _, bbox_w, bbox_h = render_projection_dual_png(
        positions=positions,
        radii=radii,
        azimuth=azimuth,
        elevation=elevation,
        img_size=img_size,
    )
    span_engine = max(bbox_w, bbox_h) * 1.04
    span_nm = span_engine * scale_factor_nm
    if span_nm > 0:
        return 100.0 * float(img_size) / span_nm
    return 0.0


def _compute_scale_3d_aabb(
    positions: np.ndarray,
    radii: np.ndarray,
    img_size: int,
    scale_factor_nm: float,
) -> float:
    """Compute pixels_per_100nm from 3D AABB (the WRONG method — the bug)."""
    max_extent_engine = float(
        max(
            positions[:, 0].max() - positions[:, 0].min(),
            positions[:, 1].max() - positions[:, 1].min(),
            positions[:, 2].max() - positions[:, 2].min(),
        )
        + 2.0 * float(np.max(radii))
    )
    span_engine = max_extent_engine * 1.04
    span_nm = span_engine * scale_factor_nm
    if span_nm > 0:
        return 100.0 * float(img_size) / span_nm
    return 0.0


# ---------------------------------------------------------------------------
# Unit tests — prove the 3D vs 2D discrepancy EXISTS
# ---------------------------------------------------------------------------


class TestScaleDiscrepancy:
    """Demonstrate the 3D-AABB vs 2D-bbox scale discrepancy."""

    IMG_SIZE = 512

    def test_elongated_head_on_view_2d_much_larger_than_3d(self) -> None:
        """At az=0 (head-on), 2D-bbox scale >> 3D-AABB scale.

        This is the fundamental bug: _stamp_scale_metadata uses 3D AABB
        giving a LOWER pixels_per_100nm than the actual rendered scale.
        """
        positions, radii, dpo_nm = _build_elongated_aggregate()
        scale_factor_nm = dpo_nm / 2.0

        scale_2d = _compute_scale_2d_bbox(
            positions, radii, 0.0, 0.0, self.IMG_SIZE, scale_factor_nm
        )
        scale_3d = _compute_scale_3d_aabb(
            positions, radii, self.IMG_SIZE, scale_factor_nm
        )

        # 2D bbox for head-on view: max = 2 → scale ≈ 984.6
        # 3D AABB: max = 20 → scale ≈ 98.5
        # Ratio: ~10x
        assert scale_2d > scale_3d * 5.0, (
            f"2D scale ({scale_2d:.1f}) should be >> 3D scale ({scale_3d:.1f}) "
            f"for elongated head-on view"
        )

    def test_per_direction_scales_vary_for_anisotropic_aggregate(self) -> None:
        """Different viewing directions produce DIFFERENT 2D-bbox scales.

        This is impossible with 3D AABB (which gives one constant value).
        """
        positions, radii, dpo_nm = _build_elongated_aggregate()
        scale_factor_nm = dpo_nm / 2.0

        # Head-on (small 2D bbox → high scale)
        scale_head_on = _compute_scale_2d_bbox(
            positions, radii, 0.0, 0.0, self.IMG_SIZE, scale_factor_nm
        )
        # Side view (large 2D bbox → low scale, similar to 3D AABB)
        scale_side = _compute_scale_2d_bbox(
            positions, radii, 90.0, 0.0, self.IMG_SIZE, scale_factor_nm
        )

        # These should differ dramatically (10x for this aggregate)
        assert scale_head_on > scale_side * 5.0, (
            f"Head-on scale ({scale_head_on:.1f}) should be >> side scale "
            f"({scale_side:.1f}) for elongated aggregate"
        )

    def test_stamp_scale_metadata_returns_3d_aabb_value(self) -> None:
        """_stamp_scale_metadata uses 3D AABB — returns constant regardless
        of direction. This proves the bug exists in the current code.
        """
        from apps.simulations.views import _stamp_scale_metadata

        positions, radii, dpo_nm = _build_elongated_aggregate()
        scale_factor_nm = dpo_nm / 2.0

        sim_mock = type(
            "S", (), {"parameters": {"primary_particle_diameter_nm": dpo_nm}}
        )()
        params: dict = {}
        _stamp_scale_metadata(params, sim_mock, positions, radii, self.IMG_SIZE)
        stamped_scale = params["pixels_per_100nm"]

        # The stamped scale uses 3D AABB (max extent = 20)
        expected_3d = _compute_scale_3d_aabb(
            positions, radii, self.IMG_SIZE, scale_factor_nm
        )
        assert stamped_scale == pytest.approx(expected_3d, rel=1e-6), (
            f"_stamp_scale_metadata should use 3D AABB ({expected_3d:.1f}), "
            f"but got {stamped_scale:.1f}"
        )

        # For the head-on view, the correct 2D scale is much higher
        correct_head_on = _compute_scale_2d_bbox(
            positions, radii, 0.0, 0.0, self.IMG_SIZE, scale_factor_nm
        )
        assert correct_head_on > stamped_scale * 5.0, (
            f"Correct 2D scale ({correct_head_on:.1f}) should be >> "
            f"stamped 3D scale ({stamped_scale:.1f})"
        )


# ---------------------------------------------------------------------------
# Integration tests — Django endpoints
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestLegacyModePixelAccuracy:
    """Verify legacy mode uses 2D-bbox scale (after fix).

    Before fix: legacy uses 3D AABB → for elongated head-on view,
    pixels_per_100nm is ~10x too low.
    After fix: legacy uses 2D bbox per direction → correct.
    """

    def test_legacy_export_scale_not_3d_aabb(self) -> None:
        """Legacy export must NOT use 3D AABB for pixels_per_100nm.

        For an elongated aggregate viewed head-on, if the stamped
        pixels_per_100nm equals the 3D AABB value, the bug is still there.
        """
        import uuid
        from apps.accounts.models import User
        from apps.projects.models import Project
        from apps.simulations.models import Simulation, SimulationStatus
        from rest_framework.test import APIClient
        from django.urls import reverse

        positions, radii_1d, dpo_nm = _build_elongated_aggregate()
        radii_col = radii_1d.reshape(-1, 1)
        geometry = np.hstack([positions, radii_col])
        buf = io.BytesIO()
        np.save(buf, geometry)

        user = User.objects.create_user(
            email=f"pixel-acc-{uuid.uuid4()}@example.com",
            password="irrelevant",
        )
        project = Project.objects.create(name="Pixel Accuracy Test", owner=user)
        sim = Simulation.objects.create(
            project=project,
            algorithm="cca",
            parameters={
                "n_particles": len(positions),
                "primary_particle_diameter_nm": dpo_nm,
                "parameters_schema_version": "v2",
            },
            seed=42,
            status=SimulationStatus.COMPLETED,
            geometry=buf.getvalue(),
            metrics={"radius_of_gyration": 1.0},
        )

        client = APIClient()
        client.force_authenticate(user=user)
        url = reverse(
            "project-simulations-projection-batch",
            kwargs={"project_pk": project.id, "pk": sim.id},
        )

        # Legacy export at az=0 (head-on view looking along X-axis).
        # All particles overlap → correct 2D bbox is tiny (max=2),
        # but 3D AABB is 20.
        response = client.post(
            url,
            {
                "azimuth_start": 0.0,
                "azimuth_end": 0.0,
                "azimuth_step": 30.0,
                "elevation_start": 0.0,
                "elevation_end": 0.0,
                "elevation_step": 30.0,
            },
            format="json",
        )

        assert response.status_code == 200, response.content

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))

        stamped_scale = meta["parameters"].get("pixels_per_100nm")
        assert stamped_scale is not None, "pixels_per_100nm missing from metadata"

        # The WRONG (3D AABB) value for this aggregate + default 50nm dpo:
        # max_extent = 20, span = 20*1.04 = 20.8, span_nm = 20.8*25 = 520
        # We don't know the exact img_size used by legacy (bbox_inches='tight')
        # so we use a ratio test instead.
        # If using 3D AABB, scale ≈ 100 * img_size / 520
        # If using 2D bbox (az=0), scale ≈ 100 * img_size / (2*1.04*25)
        # = 100 * img_size / 52
        # Ratio: correct/wrong = 520/52 = 10x

        # The stamped scale should be MUCH higher than the 3D AABB prediction.
        # With 3D AABB and typical legacy PNG sizes (~600-800px), scale would be
        # around 100-150. With 2D bbox, scale should be ~1000-1500.
        # Simpler: just verify it's > 5x what 3D AABB would give.
        scale_factor_nm = dpo_nm / 2.0
        wrong_3d_scale = _compute_scale_3d_aabb(
            positions,
            radii_1d,
            512,
            scale_factor_nm,  # use 512 as reference
        )
        # Legacy renders at a measured img_size, but scale should be PROPORTIONALLY
        # much higher than 3D AABB regardless of img_size.
        # The test: stamped_scale * (3D_span/2D_span) comparison
        # For this aggregate: 3D max extent = 20, 2D max (az=0) = 2, ratio = 10
        # So stamped_scale should be >= wrong_3d_scale * 5 (allowing for margin)
        # if the fix is applied. Before fix: stamped_scale ≈ wrong_3d_scale.
        # We test that stamped_scale > 3 * wrong_3d_scale (conservative).
        # Actually, since legacy PNG has different img_size, let's just check
        # that the stamped value is NOT consistent with 3D AABB.
        # 3D AABB scale formula: 100 * img / (20 * 1.04 * 25) = 100 * img / 520
        # 2D bbox scale (az=0): 100 * img / (2 * 1.04 * 25) = 100 * img / 52
        # Regardless of img_size, the ratio is always 10.

        # Extract the legacy img_size from the PNG to compute what 3D AABB WOULD give
        png_names = [
            n
            for n in zipfile.ZipFile(io.BytesIO(response.content)).namelist()
            if n.endswith(".png")
        ]
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf2:
            png_bytes = zf2.read(png_names[0])
        legacy_img = Image.open(io.BytesIO(png_bytes))
        legacy_img_size = min(legacy_img.size)

        # What 3D AABB would give for this img_size
        wrong_scale_for_this_img = _compute_scale_3d_aabb(
            positions, radii_1d, legacy_img_size, scale_factor_nm
        )

        # After fix: stamped_scale should be much higher (≈10x)
        assert stamped_scale > wrong_scale_for_this_img * 3.0, (
            f"Legacy stamped scale ({stamped_scale:.1f}) is still using 3D AABB! "
            f"Expected >> {wrong_scale_for_this_img:.1f} (3D AABB for img={legacy_img_size}). "
            f"For 2D bbox at az=0, it should be ~{wrong_scale_for_this_img * 10:.1f}."
        )


@pytest.mark.django_db
class TestSyncGridPixelAccuracy:
    """Verify sync grid mode (N≤200) has per-direction scale from 2D bbox."""

    def test_sync_grid_has_per_direction_scale(self) -> None:
        """Sync grid export must have per-direction pixels_per_100nm fields.

        After the fix, sync grid exports match the async path:
        each direction entry has its own pixels_per_100nm.
        """
        import uuid
        from apps.accounts.models import User
        from apps.projects.models import Project
        from apps.simulations.models import Simulation, SimulationStatus
        from rest_framework.test import APIClient
        from django.urls import reverse

        positions, radii_1d, dpo_nm = _build_elongated_aggregate()
        radii_col = radii_1d.reshape(-1, 1)
        geometry = np.hstack([positions, radii_col])
        buf = io.BytesIO()
        np.save(buf, geometry)

        user = User.objects.create_user(
            email=f"sync-grid-{uuid.uuid4()}@example.com",
            password="irrelevant",
        )
        project = Project.objects.create(name="Sync Grid Accuracy Test", owner=user)
        sim = Simulation.objects.create(
            project=project,
            algorithm="cca",
            parameters={
                "n_particles": len(positions),
                "primary_particle_diameter_nm": dpo_nm,
                "parameters_schema_version": "v2",
            },
            seed=42,
            status=SimulationStatus.COMPLETED,
            geometry=buf.getvalue(),
            metrics={"radius_of_gyration": 1.0},
        )

        client = APIClient()
        client.force_authenticate(user=user)
        url = reverse(
            "project-simulations-projection-batch",
            kwargs={"project_pk": project.id, "pk": sim.id},
        )

        # Sync fibonacci: 10 directions (well under 200 threshold)
        # Fibonacci gives well-distributed directions that will produce
        # varying 2D bboxes for the elongated aggregate.
        response = client.post(
            url,
            {"mode": "fibonacci", "n": 10, "img_size": 512},
            format="json",
        )

        assert response.status_code == 200, response.content

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))

        # After the fix: each direction has per-direction scale
        for d_entry in meta["directions"]:
            assert "pixels_per_100nm" in d_entry, (
                f"Direction {d_entry['index']} missing per-direction "
                f"pixels_per_100nm — sync path not using 2D bbox"
            )

        # Global scale = max of per-direction scales
        per_dir_scales = [d["pixels_per_100nm"] for d in meta["directions"]]
        global_scale = meta["parameters"]["pixels_per_100nm"]
        assert global_scale == pytest.approx(max(per_dir_scales), rel=1e-6), (
            f"Global scale ({global_scale}) should equal max per-direction "
            f"({max(per_dir_scales)})"
        )

        # For the elongated aggregate, different directions MUST have
        # significantly different scales
        assert max(per_dir_scales) > min(per_dir_scales) * 1.5, (
            f"Elongated aggregate should have varying per-direction scales. "
            f"Min={min(per_dir_scales):.1f}, Max={max(per_dir_scales):.1f}. "
            f"If they're nearly equal, 3D AABB is still being used."
        )

    def test_sync_grid_has_scientific_pngs(self) -> None:
        """Sync grid export must include scientific PNGs (dual render).

        After the fix, sync grid mode uses render_projection_dual_png
        and includes .scientific.png files in the ZIP.
        """
        import uuid
        from apps.accounts.models import User
        from apps.projects.models import Project
        from apps.simulations.models import Simulation, SimulationStatus
        from rest_framework.test import APIClient
        from django.urls import reverse

        positions, radii_1d, dpo_nm = _build_elongated_aggregate()
        radii_col = radii_1d.reshape(-1, 1)
        geometry = np.hstack([positions, radii_col])
        buf = io.BytesIO()
        np.save(buf, geometry)

        user = User.objects.create_user(
            email=f"sync-sci-{uuid.uuid4()}@example.com",
            password="irrelevant",
        )
        project = Project.objects.create(name="Sync Sci Test", owner=user)
        sim = Simulation.objects.create(
            project=project,
            algorithm="cca",
            parameters={
                "n_particles": len(positions),
                "primary_particle_diameter_nm": dpo_nm,
                "parameters_schema_version": "v2",
            },
            seed=42,
            status=SimulationStatus.COMPLETED,
            geometry=buf.getvalue(),
            metrics={"radius_of_gyration": 1.0},
        )

        client = APIClient()
        client.force_authenticate(user=user)
        url = reverse(
            "project-simulations-projection-batch",
            kwargs={"project_pk": project.id, "pk": sim.id},
        )

        response = client.post(
            url,
            {"mode": "fibonacci", "n": 4, "img_size": 256},
            format="json",
        )

        assert response.status_code == 200, response.content

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            names = zf.namelist()
            scientific_pngs = [n for n in names if ".scientific.png" in n]

        assert len(scientific_pngs) > 0, (
            f"Sync mode should include scientific PNGs after fix. ZIP contains: {names}"
        )
