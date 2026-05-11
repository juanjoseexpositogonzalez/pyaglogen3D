"""Tests for build_batch_projections_zip Celery task (Phase 2, T2.7–T2.11).

Uses mocked render to avoid aglogen_core dependency. Validates:
- ZIP structure (sim_{uuid}/... + manifest.json)
- Per-sim failure isolation
- Progress meta updates
- Result dict shape (download_filename, etc.)
"""

from __future__ import annotations

import json
import os
import uuid
import zipfile
from datetime import date
from io import BytesIO
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from apps.simulations.tasks import build_batch_projections_zip


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_study_id() -> str:
    return str(uuid.uuid4())


def _make_sim_ids(n: int) -> list[str]:
    return [str(uuid.uuid4()) for _ in range(n)]


class _FakeSelf:
    """Mimics Celery bound-task self with update_state tracking."""

    def __init__(self) -> None:
        self.state_updates: list[dict] = []

    def update_state(self, state: str, meta: dict) -> None:
        self.state_updates.append({"state": state, "meta": meta})


# ---------------------------------------------------------------------------
# T2.8 — ZIP structure
# ---------------------------------------------------------------------------


class TestBuildBatchProjectionsZipStructure:
    def test_zip_contains_sim_folders_and_manifest(self, tmp_path: Path) -> None:
        """2 sims, each with 2 directions → ZIP has sim_UUID/ dirs + manifest.json."""
        study_id = _make_study_id()
        sim_ids = _make_sim_ids(2)

        fake_self = _FakeSelf()

        # Mock render_or_reuse_projections to create fake PNGs
        def mock_render(simulation, mode, config, output_dir, img_format="png"):
            from apps.simulations.services.projection import create_projection_filename

            base_name = f"sim_{str(simulation.id)[:8]}"
            paths = []
            for az, el in [(0, 0), (30, 30)]:
                fname = create_projection_filename(base_name, az, el, img_format)
                p = output_dir / fname
                p.write_bytes(b"fake-png")
                paths.append(p)
            return paths

        # Mock the Simulation model
        def mock_get_sim(**kwargs):
            sim_id = str(kwargs.get("id", ""))
            sim = MagicMock()
            sim.id = uuid.UUID(sim_id)
            sim.name = f"Sim {sim_id[:8]}"
            sim.geometry = b"fake"
            sim.parameters = {}
            return sim

        _RENDER_PATCH = "apps.simulations.services.projection.render_or_reuse_projections"
        _SIM_PATCH = "apps.simulations.models.Simulation"

        with patch(
            _RENDER_PATCH,
            side_effect=mock_render,
        ), patch(
            _SIM_PATCH,
        ) as MockSimModel, patch(
            "apps.simulations.tasks._batch_storage_dir",
            return_value=str(tmp_path),
        ):
            MockSimModel.objects.get = mock_get_sim

            result = build_batch_projections_zip(
                fake_self,
                study_id=study_id,
                simulation_ids=sim_ids,
                mode="grid",
                config={"az_step": 30, "el_step": 30},
            )

        # Verify result shape
        assert "zip_path" in result
        assert "download_filename" in result
        assert "total_sims_processed" in result
        assert result["successful_sims"] == 2

        # Verify ZIP structure
        zip_path = result["zip_path"]
        assert os.path.exists(zip_path)

        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            # Should have manifest.json at root
            assert "manifest.json" in names

            # Should have sim_UUID/ dirs
            sim_dirs = {n.split("/")[0] for n in names if "/" in n}
            assert len(sim_dirs) == 2

            # Parse manifest
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["study_id"] == study_id
            assert len(manifest["simulations"]) == 2


# ---------------------------------------------------------------------------
# T2.9 — Per-sim failure isolation
# ---------------------------------------------------------------------------


class TestBatchTaskPerSimFailure:
    def test_one_sim_fails_others_succeed(self, tmp_path: Path) -> None:
        """Sim 2 of 3 fails → result has failed_sims, other 2 in ZIP."""
        study_id = _make_study_id()
        sim_ids = _make_sim_ids(3)
        fake_self = _FakeSelf()

        call_count = 0

        def mock_render(simulation, mode, config, output_dir, img_format="png"):
            nonlocal call_count
            call_count += 1
            if str(simulation.id) == sim_ids[1]:
                raise RuntimeError("Sim render failed")
            from apps.simulations.services.projection import create_projection_filename

            base_name = f"sim_{str(simulation.id)[:8]}"
            paths = []
            for az, el in [(0, 0)]:
                fname = create_projection_filename(base_name, az, el, img_format)
                p = output_dir / fname
                p.write_bytes(b"fake-png")
                paths.append(p)
            return paths

        def mock_get_sim(**kwargs):
            sim_id = str(kwargs.get("id", ""))
            sim = MagicMock()
            sim.id = uuid.UUID(sim_id)
            sim.name = f"Sim {sim_id[:8]}"
            sim.geometry = b"fake"
            sim.parameters = {}
            return sim

        with patch(
            "apps.simulations.services.projection.render_or_reuse_projections",
            side_effect=mock_render,
        ), patch(
            "apps.simulations.models.Simulation",
        ) as MockSimModel, patch(
            "apps.simulations.tasks._batch_storage_dir",
            return_value=str(tmp_path),
        ):
            MockSimModel.objects.get = mock_get_sim

            result = build_batch_projections_zip(
                fake_self,
                study_id=study_id,
                simulation_ids=sim_ids,
                mode="grid",
                config={"az_step": 90, "el_step": 90},
            )

        assert result["successful_sims"] == 2
        assert len(result["failed_sims"]) == 1
        assert result["failed_sims"][0]["sim_id"] == sim_ids[1]
        assert result["total_sims_processed"] == 3


# ---------------------------------------------------------------------------
# T2.10 — Progress meta updates
# ---------------------------------------------------------------------------


class TestBatchTaskProgressMeta:
    def test_progress_updated_per_sim(self, tmp_path: Path) -> None:
        """update_state called after each sim with current/total/current_sim_id."""
        study_id = _make_study_id()
        sim_ids = _make_sim_ids(3)
        fake_self = _FakeSelf()

        def mock_render(simulation, mode, config, output_dir, img_format="png"):
            from apps.simulations.services.projection import create_projection_filename

            base_name = f"sim_{str(simulation.id)[:8]}"
            fname = create_projection_filename(base_name, 0, 0, img_format)
            p = output_dir / fname
            p.write_bytes(b"fake-png")
            return [p]

        def mock_get_sim(**kwargs):
            sim_id = str(kwargs.get("id", ""))
            sim = MagicMock()
            sim.id = uuid.UUID(sim_id)
            sim.name = f"Sim {sim_id[:8]}"
            sim.geometry = b"fake"
            sim.parameters = {}
            return sim

        with patch(
            "apps.simulations.services.projection.render_or_reuse_projections",
            side_effect=mock_render,
        ), patch(
            "apps.simulations.models.Simulation",
        ) as MockSimModel, patch(
            "apps.simulations.tasks._batch_storage_dir",
            return_value=str(tmp_path),
        ):
            MockSimModel.objects.get = mock_get_sim

            build_batch_projections_zip(
                fake_self,
                study_id=study_id,
                simulation_ids=sim_ids,
                mode="fibonacci",
                config={"n": 5},
            )

        # Should have 3 PROGRESS updates (one per sim)
        progress_updates = [u for u in fake_self.state_updates if u["state"] == "PROGRESS"]
        assert len(progress_updates) == 3
        assert progress_updates[0]["meta"]["current"] == 1
        assert progress_updates[0]["meta"]["total"] == 3
        assert "current_sim_id" in progress_updates[0]["meta"]
        assert progress_updates[2]["meta"]["current"] == 3


# ---------------------------------------------------------------------------
# T2.11 — download_filename in result
# ---------------------------------------------------------------------------


class TestBatchTaskDownloadFilename:
    def test_result_includes_download_filename(self, tmp_path: Path) -> None:
        study_id = _make_study_id()
        sim_ids = _make_sim_ids(1)
        fake_self = _FakeSelf()

        def mock_render(simulation, mode, config, output_dir, img_format="png"):
            from apps.simulations.services.projection import create_projection_filename

            base_name = f"sim_{str(simulation.id)[:8]}"
            fname = create_projection_filename(base_name, 0, 0, img_format)
            p = output_dir / fname
            p.write_bytes(b"fake-png")
            return [p]

        def mock_get_sim(**kwargs):
            sim_id = str(kwargs.get("id", ""))
            sim = MagicMock()
            sim.id = uuid.UUID(sim_id)
            sim.name = f"Sim {sim_id[:8]}"
            sim.geometry = b"fake"
            sim.parameters = {}
            return sim

        with patch(
            "apps.simulations.services.projection.render_or_reuse_projections",
            side_effect=mock_render,
        ), patch(
            "apps.simulations.models.Simulation",
        ) as MockSimModel, patch(
            "apps.simulations.tasks._batch_storage_dir",
            return_value=str(tmp_path),
        ):
            MockSimModel.objects.get = mock_get_sim

            result = build_batch_projections_zip(
                fake_self,
                study_id=study_id,
                simulation_ids=sim_ids,
                mode="grid",
                config={"az_step": 30, "el_step": 30},
            )

        today = date.today().isoformat()
        expected_prefix = f"study_{study_id}_projections_{today}"
        assert result["download_filename"].startswith(expected_prefix)
        assert result["download_filename"].endswith(".zip")
