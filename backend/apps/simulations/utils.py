"""Utility functions for simulations."""
import csv
import io
from datetime import datetime
from typing import Any

import numpy as np
from django.utils import timezone


# Algorithm display names
ALGORITHM_DISPLAY_NAMES = {
    "dla": "DLA",
    "cca": "CCA",
    "ballistic": "Ballistic",
    "ballistic_cc": "Ballistic CC",
    "tunable": "Tunable",
    "tunable_cc": "Tunable CC",
    "limiting": "Limiting Case",
    "imported": "Imported",
}

# FRAKTAL model display names
FRAKTAL_MODEL_DISPLAY_NAMES = {
    "granulated_2012": "Granulated 2012",
    "voxel_2018": "Voxel 2018",
}

# Theoretical extreme values by algorithm
THEORETICAL_EXTREMES: dict[str, dict[str, list[float]]] = {
    "dla": {
        "sticking_probability": [0.1, 1.0],
    },
    "cca": {
        "sticking_probability": [0.1, 1.0],
    },
    "ballistic": {
        "sticking_probability": [0.1, 1.0],
    },
    "ballistic_cc": {
        "sticking_probability": [0.1, 1.0],
    },
    "tunable": {
        "target_df": [1.0, 1.8, 2.5, 3.0],  # Chain, DLA-like, Ballistic, Compact
        "target_kf": [1.0, 1.3, 2.0],
    },
    "tunable_cc": {
        "target_df": [1.0, 1.8, 2.5, 3.0],
        "target_kf": [1.0, 1.3, 2.0],
    },
    "limiting": {
        "configuration_type": [
            # Df=1 (chain) configurations
            "lineal", "cruz2d", "asterisco", "cruz3d",
            # Df=2 (plane) configurations
            "plano", "dobleplano", "tripleplano",
            # Df=3 (sphere) configurations
            "cuboctaedro",
        ],
        "sintering_coeff": [0.5, 0.75, 0.9, 1.0],
        "packing": ["HC", "CS", "CCC"],
    },
}

# Sintering extreme coefficients
SINTERING_EXTREMES = {
    "coefficients": [0.5, 0.75, 0.9, 1.0],
}


def generate_simulation_name(
    algorithm: str,
    created_at: datetime | None = None,
    suffix: str = "",
) -> str:
    """Generate auto-name for simulation.

    Args:
        algorithm: Algorithm identifier (e.g., 'dla', 'tunable')
        created_at: Timestamp for the name (defaults to now)
        suffix: Optional suffix to append (e.g., '(grid: 1.5, 2.0)')

    Returns:
        Name like 'DLA Simulation - 2024-02-20 10:30' or with suffix
    """
    if created_at is None:
        created_at = timezone.now()

    algo_display = ALGORITHM_DISPLAY_NAMES.get(algorithm, algorithm.upper())
    timestamp = created_at.strftime("%Y-%m-%d %H:%M")
    name = f"{algo_display} Simulation - {timestamp}"

    if suffix:
        name = f"{name} {suffix}"

    return name


def generate_fraktal_name(
    model: str,
    created_at: datetime | None = None,
    suffix: str = "",
) -> str:
    """Generate auto-name for FRAKTAL analysis.

    Args:
        model: FRAKTAL model (e.g., 'granulated_2012', 'voxel_2018')
        created_at: Timestamp for the name (defaults to now)
        suffix: Optional suffix to append

    Returns:
        Name like 'FRAKTAL Voxel 2018 - 2024-02-20 10:30'
    """
    if created_at is None:
        created_at = timezone.now()

    model_display = FRAKTAL_MODEL_DISPLAY_NAMES.get(model, model.title())
    timestamp = created_at.strftime("%Y-%m-%d %H:%M")
    name = f"FRAKTAL {model_display} - {timestamp}"

    if suffix:
        name = f"{name} {suffix}"

    return name


def generate_limiting_cases(
    base_parameters: dict[str, Any],
    parameter_grid: dict[str, list[Any]],
    algorithm: str,
    limiting_config: dict[str, Any] | None = None,
) -> list[tuple[str, str, dict[str, Any]]]:
    """Generate limiting case parameter combinations.

    Generates both range boundary cases and theoretical extreme cases
    based on the algorithm and configuration.

    Args:
        base_parameters: Base params for all simulations
        parameter_grid: Regular parameter grid (to extract boundaries)
        algorithm: Simulation algorithm
        limiting_config: Optional config overriding defaults:
            - include_boundaries: bool (default True)
            - include_theoretical: bool (default True)
            - theoretical_extremes: dict overriding THEORETICAL_EXTREMES

    Returns:
        List of tuples: (case_type, description, parameters)
        Example: [('boundary_min', 'target_df=1.5', {...}), ...]
    """
    limiting_cases: list[tuple[str, str, dict[str, Any]]] = []
    config = limiting_config or {}

    # Track which parameter combinations we've already added to avoid duplicates
    seen_combinations: set[str] = set()

    def add_case(
        case_type: str, param_name: str, value: Any, params: dict[str, Any]
    ) -> None:
        """Add a case if not already seen."""
        combo_key = f"{param_name}={value}"
        if combo_key not in seen_combinations:
            seen_combinations.add(combo_key)
            limiting_cases.append((case_type, combo_key, params))

    # 1. Range boundaries (min/max of each parameter in grid)
    if config.get("include_boundaries", True):
        for param_name, values in parameter_grid.items():
            if len(values) >= 2:
                sorted_values = sorted(values)
                min_val = sorted_values[0]
                max_val = sorted_values[-1]

                # Min boundary case
                min_params = dict(base_parameters)
                min_params[param_name] = min_val
                add_case("boundary_min", param_name, min_val, min_params)

                # Max boundary case
                max_params = dict(base_parameters)
                max_params[param_name] = max_val
                add_case("boundary_max", param_name, max_val, max_params)

    # 2. Theoretical extremes
    if config.get("include_theoretical", True):
        extremes = config.get("theoretical_extremes") or THEORETICAL_EXTREMES.get(
            algorithm, {}
        )
        for param_name, extreme_values in extremes.items():
            for val in extreme_values:
                extreme_params = dict(base_parameters)
                extreme_params[param_name] = val
                add_case("theoretical", param_name, val, extreme_params)

    return limiting_cases


def generate_sintering_extreme_cases(
    base_parameters: dict[str, Any],
) -> list[tuple[str, str, dict[str, Any]]]:
    """Generate sintering extreme cases.

    Generates simulations with extreme sintering coefficients:
    - 0.5: Maximum sintering (50% overlap)
    - 0.75: High sintering
    - 0.9: Moderate sintering
    - 1.0: No sintering (just touching)

    Args:
        base_parameters: Base params for the simulation

    Returns:
        List of tuples: (case_type, description, parameters)
    """
    cases: list[tuple[str, str, dict[str, Any]]] = []

    for coeff in SINTERING_EXTREMES["coefficients"]:
        params = dict(base_parameters)
        params["sintering_type"] = "fixed"
        params["sintering_coeff"] = coeff
        cases.append(("sintering_extreme", f"coeff={coeff}", params))

    return cases


def apply_sintering_config(
    parameters: dict[str, Any],
    sintering_config: dict[str, Any] | None,
) -> dict[str, Any]:
    """Apply sintering configuration to simulation parameters.

    Args:
        parameters: Simulation parameters to update
        sintering_config: Sintering configuration dict with keys:
            - distribution_type: 'fixed', 'uniform', or 'normal'
            - coefficient: Fixed coefficient (for 'fixed' type)
            - min: Min coefficient (for 'uniform' type)
            - max: Max coefficient (for 'uniform' type)
            - mean: Mean coefficient (for 'normal' type)
            - std: Std deviation (for 'normal' type)

    Returns:
        Updated parameters dict
    """
    if not sintering_config:
        return parameters

    params = dict(parameters)
    dist_type = sintering_config.get("distribution_type", "fixed")
    params["sintering_type"] = dist_type

    if dist_type == "fixed":
        params["sintering_coeff"] = sintering_config.get("coefficient", 1.0)
    elif dist_type == "uniform":
        params["sintering_min"] = sintering_config.get("min", 0.85)
        params["sintering_max"] = sintering_config.get("max", 0.95)
    elif dist_type == "normal":
        params["sintering_mean"] = sintering_config.get("mean", 0.9)
        params["sintering_std"] = sintering_config.get("std", 0.05)

    return params


class CSVParseError(ValueError):
    """Error raised when CSV parsing fails."""

    pass


def parse_csv_geometry(csv_text: str) -> tuple[np.ndarray, int, float, float]:
    """Parse CSV geometry data and return particle array.

    Args:
        csv_text: CSV text content with columns: x, y, z, radius

    Returns:
        Tuple of (geometry_array, n_particles, radius_min, radius_max)
        - geometry_array: N x 4 numpy array (x, y, z, radius)
        - n_particles: Number of particles
        - radius_min: Minimum particle radius
        - radius_max: Maximum particle radius

    Raises:
        CSVParseError: If CSV format is invalid
    """
    try:
        reader = csv.DictReader(io.StringIO(csv_text))
    except Exception as e:
        raise CSVParseError(f"Failed to parse CSV: {e}") from e

    # Check for required columns (case-insensitive)
    if reader.fieldnames is None:
        raise CSVParseError("CSV file appears to be empty")

    fieldnames_lower = [f.strip().lower() for f in reader.fieldnames]
    required_columns = {"x", "y", "z", "radius"}
    missing = required_columns - set(fieldnames_lower)
    if missing:
        raise CSVParseError(
            f"Missing required columns: {missing}. Found: {reader.fieldnames}"
        )

    # Map lowercase column names to actual column names
    column_map = {}
    for fname in reader.fieldnames:
        lower = fname.strip().lower()
        if lower in required_columns:
            column_map[lower] = fname

    rows = []
    for row_num, row in enumerate(reader, start=2):  # Start at 2 (1-based + header)
        try:
            x = float(row[column_map["x"]])
            y = float(row[column_map["y"]])
            z = float(row[column_map["z"]])
            radius = float(row[column_map["radius"]])

            if radius <= 0:
                raise CSVParseError(
                    f"Invalid radius at row {row_num}: radius must be positive"
                )

            rows.append([x, y, z, radius])
        except (ValueError, KeyError) as e:
            raise CSVParseError(f"Invalid data at row {row_num}: {e}") from e

    if not rows:
        raise CSVParseError("No valid particle data found in CSV")

    n_particles = len(rows)
    if n_particles > 100000:
        raise CSVParseError(
            f"Maximum 100,000 particles allowed. Found: {n_particles}"
        )

    geometry = np.array(rows, dtype=np.float64)
    radii = geometry[:, 3]

    return geometry, n_particles, float(radii.min()), float(radii.max())
