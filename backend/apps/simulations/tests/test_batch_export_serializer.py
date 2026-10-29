"""Tests for BatchProjectionExportRequestSerializer (Phase 2, T2.1–T2.6).

Validates all serializer validation paths per spec R1 + R2.
"""

from __future__ import annotations

import uuid

import pytest

from apps.simulations.serializers import BatchProjectionExportRequestSerializer


class TestBatchProjectionExportRequestSerializer:
    """Serializer validation tests — no DB required."""

    # T2.2 — empty simulation_ids
    def test_empty_simulation_ids_rejected(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={"simulation_ids": [], "mode": "grid", "config": {"az_step": 30, "el_step": 30}}
        )
        assert not s.is_valid()
        assert "simulation_ids" in s.errors

    # T2.3 — exceeds 50 sims
    def test_exceeds_50_sims_rejected(self) -> None:
        ids = [str(uuid.uuid4()) for _ in range(51)]
        s = BatchProjectionExportRequestSerializer(
            data={"simulation_ids": ids, "mode": "grid", "config": {"az_step": 30, "el_step": 30}}
        )
        assert not s.is_valid()
        assert "simulation_ids" in s.errors

    # T2.4 — invalid mode
    def test_invalid_mode_rejected(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={
                "simulation_ids": [str(uuid.uuid4())],
                "mode": "spherical",
                "config": {},
            }
        )
        assert not s.is_valid()
        assert "mode" in s.errors

    # T2.5 — mode-specific config validation
    def test_grid_mode_without_az_step_rejected(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={
                "simulation_ids": [str(uuid.uuid4())],
                "mode": "grid",
                "config": {"el_step": 30},
            }
        )
        assert not s.is_valid()

    def test_grid_mode_without_el_step_rejected(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={
                "simulation_ids": [str(uuid.uuid4())],
                "mode": "grid",
                "config": {"az_step": 30},
            }
        )
        assert not s.is_valid()

    def test_fibonacci_without_n_rejected(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={
                "simulation_ids": [str(uuid.uuid4())],
                "mode": "fibonacci",
                "config": {},
            }
        )
        assert not s.is_valid()

    def test_fibonacci_n_zero_rejected(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={
                "simulation_ids": [str(uuid.uuid4())],
                "mode": "fibonacci",
                "config": {"n": 0},
            }
        )
        assert not s.is_valid()

    def test_fibonacci_n_above_1000_rejected(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={
                "simulation_ids": [str(uuid.uuid4())],
                "mode": "fibonacci",
                "config": {"n": 1001},
            }
        )
        assert not s.is_valid()

    # T2.6 — extra config keys are ignored (valid request)
    def test_extra_config_keys_ignored(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={
                "simulation_ids": [str(uuid.uuid4())],
                "mode": "fibonacci",
                "config": {"n": 100, "unknown_key": "x"},
            }
        )
        assert s.is_valid(), s.errors

    # Happy paths
    def test_valid_grid_config_accepted(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={
                "simulation_ids": [str(uuid.uuid4()), str(uuid.uuid4())],
                "mode": "grid",
                "config": {"az_step": 30, "el_step": 30},
            }
        )
        assert s.is_valid(), s.errors

    def test_valid_fibonacci_config_accepted(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={
                "simulation_ids": [str(uuid.uuid4())],
                "mode": "fibonacci",
                "config": {"n": 50},
            }
        )
        assert s.is_valid(), s.errors

    def test_valid_legacy_config_accepted(self) -> None:
        s = BatchProjectionExportRequestSerializer(
            data={
                "simulation_ids": [str(uuid.uuid4())],
                "mode": "legacy",
                "config": {"az_step": 30, "el_step": 30},
            }
        )
        assert s.is_valid(), s.errors

    def test_exactly_50_sims_accepted(self) -> None:
        ids = [str(uuid.uuid4()) for _ in range(50)]
        s = BatchProjectionExportRequestSerializer(
            data={"simulation_ids": ids, "mode": "grid", "config": {"az_step": 30, "el_step": 30}}
        )
        assert s.is_valid(), s.errors
