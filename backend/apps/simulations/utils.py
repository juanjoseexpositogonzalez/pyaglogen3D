"""Utility functions for simulations."""

import csv
import io
import logging
import re
from datetime import datetime
from typing import Any

import numpy as np
from django.utils import timezone

logger = logging.getLogger(__name__)


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
            "lineal",
            "cruz2d",
            "asterisco",
            "cruz3d",
            # Df=2 (plane) configurations
            "plano",
            "dobleplano",
            "tripleplano",
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


# --- CSV metadata + locale helpers ------------------------------------------

# Supported `#key=value` metadata keys extracted from the file header. Unknown
# keys are preserved under ``metadata["_unknown_keys"]`` for forward-compat so
# a newer CSV that carries extra hints never causes an older parser to reject.
_SUPPORTED_METADATA_KEYS: frozenset[str] = frozenset(
    {"unit", "primary_particle_diameter_nm", "source", "generated_at"}
)

# Keys that must be coerced to float when present. Unit / source / generated_at
# stay as strings.
_FLOAT_METADATA_KEYS: frozenset[str] = frozenset({"primary_particle_diameter_nm"})

# Locale sniffer thresholds. Spec R2 scenario "Small sample size emits warning"
# fires when fewer than this many data rows are available.
_LOCALE_SNIFF_SAMPLE_SIZE: int = 5

# Header aliases — maps normalized real-world column names to the canonical
# ``x / y / z / radius`` keys the parser expects. MATLAB's ``writematrix``
# in a Spanish locale emits ``Partícula, Coordenada x [nm], ..., Radio [nm],
# Aplastamiento``; French MATLAB emits ``Rayon``; English-with-units emits
# ``X [nm]`` / ``radius_nm``. Normalization is: lowercase, trim, strip a
# trailing ``[...]`` unit suffix, replace whitespace runs with a single
# space. If the normalized name appears in this map, it resolves to the
# canonical key. Unknown columns are ignored (``aplastamiento``,
# ``particle``, etc.) so a CSV with extra diagnostic columns still imports.
_HEADER_ALIASES: dict[str, str] = {
    # canonical
    "x": "x",
    "y": "y",
    "z": "z",
    "radius": "radius",
    # English with units / underscores
    "radius_nm": "radius",
    # Spanish
    "coordenada x": "x",
    "coordenada y": "y",
    "coordenada z": "z",
    "radio": "radius",
    # French
    "rayon": "radius",
    # German (Radius is the same word, covered by canonical)
}

# Trailing unit annotation like `` [nm]`` or ``(nm)``. Stripped before
# lookup so ``Coordenada x [nm]`` and ``X (µm)`` both normalize to ``x``
# and ``coordenada x`` respectively.
_UNIT_SUFFIX_RE = re.compile(r"\s*[\[(][^\])]*[\])]\s*$")


def _normalize_header(raw: str) -> str:
    """Normalize a single CSV header cell for alias lookup.

    Steps:

    1. Lowercase
    2. Strip outer whitespace
    3. Strip a trailing ``[...]`` or ``(...)`` unit annotation
    4. Collapse internal whitespace runs to a single space

    No side effects, no exceptions — callers can feed anything.
    """
    s = (raw or "").strip().lower()
    s = _UNIT_SUFFIX_RE.sub("", s).strip()
    s = re.sub(r"\s+", " ", s)
    return s


# Regex for extracting `# key=value` comment lines. Leading whitespace after
# the `#` is tolerated — authors write `#unit=nm` and `# unit = nm` alike.
_METADATA_LINE_PATTERN = re.compile(r"^#\s*(.*)$")


def _split_metadata_comments(raw_text: str) -> tuple[list[str], dict[str, Any]]:
    """Strip leading ``#key=value`` lines and return ``(body_lines, metadata)``.

    Only consecutive ``#``-prefixed lines at the top of the file are consumed
    (matching the spec: metadata lives "before the column header"). Blank
    lines between metadata and the body are preserved in the body so the
    delimiter sniffer operates on the real data region only.

    Behavior details:

    - ``# key=value`` → stamped into ``metadata`` with string value.
    - ``# key = value`` (spaces around ``=``) → whitespace trimmed.
    - ``# not a pair`` → malformed, logged + skipped (NOT an error — R1).
    - Unknown keys → logged + preserved in ``metadata["_unknown_keys"]``.
    - Float keys (see ``_FLOAT_METADATA_KEYS``) → coerced; invalid → skipped
      with a log warning, value NOT stamped (so the caller can apply its own
      default).
    """
    lines = raw_text.splitlines(keepends=True)
    metadata: dict[str, Any] = {}
    unknown: dict[str, str] = {}
    cursor = 0

    for line in lines:
        stripped = line.rstrip("\r\n")
        match = _METADATA_LINE_PATTERN.match(stripped)
        if match is None:
            break
        cursor += 1

        payload = match.group(1).strip()
        if "=" not in payload:
            if payload:
                # Only log non-empty malformed lines; empty `#` is just a
                # decorative separator and deserves no noise.
                logger.debug("CSV metadata line has no `=`: %r", stripped)
            continue

        key_raw, _, value_raw = payload.partition("=")
        key = key_raw.strip()
        value = value_raw.strip()
        if not key:
            logger.debug("CSV metadata line has empty key: %r", stripped)
            continue

        if key in _FLOAT_METADATA_KEYS:
            try:
                metadata[key] = float(value)
            except ValueError:
                logger.warning(
                    "CSV metadata %s=%r is not a float; skipping", key, value
                )
            continue

        if key in _SUPPORTED_METADATA_KEYS:
            metadata[key] = value
        else:
            # Forward-compat: retained but clearly separated from the
            # supported key namespace.
            unknown[key] = value
            logger.info("CSV metadata line carried unknown key %r", key)

    if unknown:
        metadata["_unknown_keys"] = unknown

    return lines[cursor:], metadata


def _sniff_csv_locale(sample_lines: list[str]) -> dict[str, Any]:
    """Detect CSV delimiter and decimal separator from up to 5 data rows.

    Returns a dict with keys ``delimiter``, ``decimal``, ``warning``:

    - ``delimiter`` ∈ ``{",", ";", "\\t"}`` — prefers ``csv.Sniffer`` result;
      falls back to ``","`` if the sniffer can't tell.
    - ``decimal`` ∈ ``{".", ","}`` — counted over numeric-looking tokens:
        * only ``.`` seen → ``.``
        * only ``,`` seen → ``,``
        * both or neither → default ``.``
    - ``warning`` is ``True`` when fewer than ``_LOCALE_SNIFF_SAMPLE_SIZE`` rows
      were available, signaling low confidence. Empty input also warns.

    The detector never raises — it degrades gracefully to the US-centric
    default so a bad file still gets parsed and the user sees a proper data
    error instead of a locale error.
    """
    # Strip blank lines so we don't under-count rows when the author padded.
    trimmed = [line.strip() for line in sample_lines if line.strip()]
    warning = len(trimmed) < _LOCALE_SNIFF_SAMPLE_SIZE

    if not trimmed:
        return {"delimiter": ",", "decimal": ".", "warning": True}

    # Delimiter: csv.Sniffer is pretty good over a small joined sample. If it
    # raises (e.g. all rows are a single token), fall back to ","'.
    joined = "\n".join(trimmed[:_LOCALE_SNIFF_SAMPLE_SIZE])
    delimiter = ","
    try:
        dialect = csv.Sniffer().sniff(joined, delimiters=",;\t")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","

    # Decimal: scan numeric-looking tokens for ``.`` vs ``,``. Non-numeric
    # tokens are ignored — they can't disambiguate.
    has_dot = False
    has_comma = False
    for line in trimmed[:_LOCALE_SNIFF_SAMPLE_SIZE]:
        for token in line.split(delimiter):
            token = token.strip()
            if not token:
                continue
            # A token is "numeric-looking" if it consists of digits plus at
            # most one of the two separators (we count per-token, not per-file).
            if any(ch.isdigit() for ch in token):
                if "." in token:
                    has_dot = True
                if "," in token:
                    has_comma = True

    if has_dot and not has_comma:
        decimal = "."
    elif has_comma and not has_dot:
        decimal = ","
    else:
        decimal = "."

    return {"delimiter": delimiter, "decimal": decimal, "warning": warning}


def _normalize_numeric_cell(raw: str, decimal: str) -> str:
    """Normalize a numeric cell so Python's ``float()`` can parse it.

    When ``decimal == ","`` we replace the FIRST comma with a dot so numbers
    like ``"1,25"`` parse as ``1.25``. We do not touch non-numeric strings.
    """
    if decimal != ",":
        return raw
    # Only rewrite when the token looks numeric — avoids munging stray string
    # columns in a future schema expansion.
    stripped = raw.strip()
    if not stripped:
        return raw
    if any(ch.isdigit() for ch in stripped):
        return raw.replace(",", ".", 1)
    return raw


def parse_csv_geometry(
    raw: bytes | str,
    *,
    decimal_override: str | None = None,
    delimiter_override: str | None = None,
) -> tuple[np.ndarray, int, float, float, dict[str, Any]]:
    """Parse CSV geometry with metadata + locale detection.

    Args:
        raw: CSV content. ``bytes`` is decoded as UTF-8; ``str`` is used as-is
            (keeps backward-compat with callers that already decoded).
        decimal_override: Optional explicit decimal separator (``"." | ","``).
            When set, skips decimal sniffing.
        delimiter_override: Optional explicit column delimiter
            (``"," | ";" | "\\t"``). When set, skips delimiter sniffing.

    Returns:
        ``(geometry, n_particles, radius_min, radius_max, metadata)``:

        - ``geometry``: ``(N, 4)`` float64 array of ``(x, y, z, radius)``.
        - ``metadata``: dict with header ``#key=value`` pairs plus locale
          fields ``detected_decimal``, ``detected_delimiter``, and
          ``locale_warning`` (``True`` when fewer than 5 data rows were
          available for sniffing). Defaults ``unit="nm"`` when the header
          omits it.

    Raises:
        CSVParseError: on invalid format or data. Note malformed ``#`` lines
            are LOGGED, not raised (spec R1 scenario "Malformed metadata").
    """
    # --- Step 0: bytes → text --------------------------------------------
    # Real-world CSVs arrive in multiple encodings: MATLAB's ``writematrix``
    # on Windows emits Latin-1 (ISO-8859-1) with Spanish / French column
    # labels, Excel emits UTF-8-BOM, and a good chunk of Django fixtures
    # are plain UTF-8. We try UTF-8 first (strict — catches truncated
    # multi-byte sequences early), then fall back to Latin-1 which is a
    # strict superset of ASCII and never fails on a byte level. The
    # detected encoding is stamped in ``metadata["detected_encoding"]``
    # for UI traceability; any BOM from UTF-8-BOM or the Latin-1 path is
    # stripped via ``utf-8-sig`` before decoding.
    detected_encoding = "utf-8"
    if isinstance(raw, bytes):
        try:
            csv_text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            # Latin-1 is lossless for any byte sequence, so this cannot
            # raise. Accents (``í``, ``é``, ``ñ``) map to their expected
            # glyphs; control bytes round-trip unchanged. We log at info
            # so ops can spot EU-origin uploads without drowning the log.
            csv_text = raw.decode("latin-1")
            detected_encoding = "latin-1"
            logger.info("CSV payload decoded as Latin-1 fallback")
    else:
        csv_text = raw

    # --- Step 1: strip #metadata lines -----------------------------------
    body_lines, metadata = _split_metadata_comments(csv_text)
    metadata.setdefault("unit", "nm")
    metadata["detected_encoding"] = detected_encoding

    # --- Step 2: detect or honor locale ----------------------------------
    # Rule (see _sniff_csv_locale): the sniffer always runs, but if the
    # caller provided explicit overrides we take them verbatim. The detected
    # value is still stamped for UI traceability.
    if delimiter_override is not None and decimal_override is not None:
        if delimiter_override == "," and decimal_override == ",":
            # Same char can't be both. Reject with a clear error instead of
            # silently producing garbage numbers.
            raise CSVParseError(
                "delimiter and decimal cannot both be ','; pick different characters"
            )

    sniffed = _sniff_csv_locale(body_lines)
    delimiter = (
        delimiter_override if delimiter_override is not None else sniffed["delimiter"]
    )
    decimal = decimal_override if decimal_override is not None else sniffed["decimal"]

    if delimiter == "," and decimal == ",":
        # Even when sniffed this ambiguity is pathological — force decimal
        # to "." to keep parsing going, and warn.
        decimal = "."
        sniffed["warning"] = True

    metadata["detected_delimiter"] = delimiter
    metadata["detected_decimal"] = decimal
    metadata["locale_warning"] = bool(sniffed["warning"])

    # --- Step 3: parse body via csv.DictReader ---------------------------
    body_text = "".join(body_lines)
    try:
        reader = csv.DictReader(io.StringIO(body_text), delimiter=delimiter)
    except Exception as e:
        raise CSVParseError(f"Failed to parse CSV: {e}") from e

    if reader.fieldnames is None:
        raise CSVParseError("CSV file appears to be empty")

    # Resolve canonical column names via the header alias table. This
    # lets MATLAB-exported CSVs with Spanish or unit-annotated headers
    # (e.g. ``Coordenada x [nm]``, ``Radio [nm]``, ``Rayon``) import
    # without a manual header-rewrite step. Unknown columns are silently
    # ignored.
    required_columns = {"x", "y", "z", "radius"}
    column_map: dict[str, str] = {}
    for fname in reader.fieldnames:
        normalized = _normalize_header(fname)
        canonical = _HEADER_ALIASES.get(normalized)
        if canonical and canonical not in column_map:
            column_map[canonical] = fname

    missing = required_columns - set(column_map.keys())
    if missing:
        raise CSVParseError(
            f"Missing required columns: {missing}. Found: {reader.fieldnames}"
        )

    rows: list[list[float]] = []
    for row_num, row in enumerate(reader, start=2):  # Start at 2 (1-based + header)
        try:
            x = float(_normalize_numeric_cell(row[column_map["x"]], decimal))
            y = float(_normalize_numeric_cell(row[column_map["y"]], decimal))
            z = float(_normalize_numeric_cell(row[column_map["z"]], decimal))
            radius = float(_normalize_numeric_cell(row[column_map["radius"]], decimal))

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
        raise CSVParseError(f"Maximum 100,000 particles allowed. Found: {n_particles}")

    geometry = np.array(rows, dtype=np.float64)
    radii = geometry[:, 3]

    return (
        geometry,
        n_particles,
        float(radii.min()),
        float(radii.max()),
        metadata,
    )
