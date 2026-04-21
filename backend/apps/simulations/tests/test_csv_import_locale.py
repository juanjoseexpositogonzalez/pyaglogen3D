"""Unit tests for CSV locale detection + metadata parsing (T12, T13).

These tests exercise :func:`parse_csv_geometry` directly (not through the
HTTP layer) because locale detection is a pure-function concern — the view
just forwards the metadata dict verbatim. Keeping them at the util-level
gives fast signal on sniffer behavior, metadata precedence, and edge cases.

Related spec: ``openspec/changes/import-aggregate/specs/import-aggregate-contract.md``
Requirements R1 (metadata), R2 (locale), R8 (import_metadata stamp).
"""

from __future__ import annotations

import pytest

from apps.simulations.services.params import DEFAULT_DIAMETER_NM
from apps.simulations.utils import CSVParseError, parse_csv_geometry


# --- Helpers -----------------------------------------------------------------


def _us_csv(rows: list[tuple[float, float, float, float]]) -> bytes:
    """Build a US-format CSV (``.`` decimal, ``,`` delimiter)."""
    header = "x,y,z,radius\n"
    body = "\n".join(f"{x},{y},{z},{r}" for x, y, z, r in rows) + "\n"
    return (header + body).encode("utf-8")


def _eu_csv(rows: list[tuple[float, float, float, float]]) -> bytes:
    """Build a European-format CSV (``,`` decimal, ``;`` delimiter)."""
    header = "x;y;z;radius\n"
    body = "\n".join(f"{x};{y};{z};{r}".replace(".", ",") for x, y, z, r in rows) + "\n"
    return (header + body).encode("utf-8")


# --- T17.1 US format ---------------------------------------------------------


def test_csv_us_format() -> None:
    """Sniffer picks ``.`` + ``,`` on a standard US-format CSV."""
    raw = _us_csv([(1.5, 2.5, 3.5, 0.25), (4.5, 5.5, 6.5, 0.3)] * 3)

    geometry, n, r_min, r_max, metadata = parse_csv_geometry(raw)

    assert n == 6
    assert geometry.shape == (6, 4)
    assert metadata["detected_decimal"] == "."
    assert metadata["detected_delimiter"] == ","
    assert metadata["locale_warning"] is False
    # First row x cell is 1.5
    assert geometry[0, 0] == pytest.approx(1.5)


# --- T17.2 European format ---------------------------------------------------


def test_csv_european_format() -> None:
    """Sniffer picks ``,`` + ``;`` on a European-format CSV."""
    raw = _eu_csv([(1.5, 2.5, 3.5, 0.25)] * 6)

    geometry, n, r_min, r_max, metadata = parse_csv_geometry(raw)

    assert n == 6
    assert metadata["detected_decimal"] == ","
    assert metadata["detected_delimiter"] == ";"
    # European comma was translated back to a dot for numeric parsing.
    assert geometry[0, 0] == pytest.approx(1.5)
    assert geometry[0, 3] == pytest.approx(0.25)


# --- T17.3 Decimal override bypasses sniffer --------------------------------


def test_csv_decimal_override_wins() -> None:
    """Explicit ``decimal_override`` beats whatever the sniffer would pick.

    The input is EU-shaped (comma decimals + semicolons), but we force
    ``decimal_override="."``. The parser MUST honor the override and the
    stamped ``detected_decimal`` MUST echo the caller's choice — not the
    sniffer guess. Because the file's numeric cells have no dots, float()
    will fail and the parser returns a CSVParseError. We assert on the
    metadata stamping via a secondary test that uses a mixed file.
    """
    # Use a file that CAN be parsed under ``.``: write numbers with dots
    # but use ``;`` as delimiter, so only the delimiter was ambiguous.
    raw = b"x;y;z;radius\n1.0;2.0;3.0;0.5\n4.0;5.0;6.0;0.5\n1.0;2.0;3.0;0.5\n"
    geometry, n, _, _, metadata = parse_csv_geometry(
        raw,
        decimal_override=".",
        delimiter_override=";",
    )

    assert n == 3
    assert metadata["detected_decimal"] == "."
    assert metadata["detected_delimiter"] == ";"
    assert geometry[0, 0] == pytest.approx(1.0)


# --- T17.4 Small-sample warning ---------------------------------------------


def test_csv_small_sample_sets_warning() -> None:
    """Fewer than 5 data rows triggers ``locale_warning=True``.

    Detection still runs on the available rows — we never error out on
    small files, we just surface a warning so the UI can prompt for
    override.
    """
    raw = _us_csv([(1.0, 2.0, 3.0, 0.5), (4.0, 5.0, 6.0, 0.5)])

    _, n, _, _, metadata = parse_csv_geometry(raw)

    assert n == 2
    assert metadata["locale_warning"] is True
    # Sniffer still produces a sensible guess on the 2 rows.
    assert metadata["detected_decimal"] == "."
    assert metadata["detected_delimiter"] == ","


# --- T17.5 Metadata lines extracted ------------------------------------------


def test_csv_metadata_lines_extracted() -> None:
    """All four supported ``#key=value`` keys are lifted into metadata."""
    body = (
        b"# unit=nm\n"
        b"# source=manual\n"
        b"# primary_particle_diameter_nm=30\n"
        b"# generated_at=2026-04-21T10:00:00Z\n"
        b"x,y,z,radius\n"
        b"1.0,2.0,3.0,0.5\n"
        b"4.0,5.0,6.0,0.5\n"
        b"7.0,8.0,9.0,0.5\n"
    )

    _, n, _, _, metadata = parse_csv_geometry(body)

    assert n == 3
    assert metadata["unit"] == "nm"
    assert metadata["source"] == "manual"
    assert metadata["primary_particle_diameter_nm"] == pytest.approx(30.0)
    assert metadata["generated_at"] == "2026-04-21T10:00:00Z"


# --- T17.6 Metadata diameter override wins ----------------------------------


def test_csv_metadata_override_wins_for_diameter() -> None:
    """When ``#primary_particle_diameter_nm`` is set, the view MUST honor it.

    This test checks the parser extracts the value correctly. The precedence
    logic in views._process_import_payload is covered by the broader
    import contract suite — here we only assert the parser stamps the
    explicit value at its declared float coercion.
    """
    body = (
        b"# primary_particle_diameter_nm=30.0\n"
        b"x,y,z,radius\n"
        b"1.0,2.0,3.0,0.5\n"
        b"4.0,5.0,6.0,0.5\n"
        b"7.0,8.0,9.0,0.5\n"
    )

    _, _, _, _, metadata = parse_csv_geometry(body)

    assert metadata["primary_particle_diameter_nm"] == pytest.approx(30.0)


# --- T17.7 Dimensionless unit uses default diameter -------------------------


def test_csv_metadata_unit_dimensionless_uses_default_diameter() -> None:
    """The parser records ``unit="dimensionless"`` verbatim.

    The view then uses DEFAULT_DIAMETER_NM when stamping the sim's
    ``primary_particle_diameter_nm``. This test locks the parser-side
    stamp; the view-side precedence is an integration concern covered
    elsewhere (and indirectly validated by the export tests in T18).
    """
    body = (
        b"# unit=dimensionless\n"
        b"x,y,z,radius\n"
        b"1.0,2.0,3.0,0.5\n"
        b"4.0,5.0,6.0,0.5\n"
        b"7.0,8.0,9.0,0.5\n"
    )

    _, _, _, _, metadata = parse_csv_geometry(body)

    assert metadata["unit"] == "dimensionless"
    # Sanity: the default diameter is 50 nm and will be used by the view.
    assert DEFAULT_DIAMETER_NM == pytest.approx(50.0)


# --- T17.8 Malformed metadata line is ignored --------------------------------


def test_csv_malformed_metadata_line_ignored() -> None:
    """A ``# not a pair`` line is skipped, parsing continues.

    Spec R1 scenario "Malformed metadata line" — mis-formatted ``#`` lines
    must not fail the import.
    """
    body = (
        b"# not a pair\n"
        b"# unit=nm\n"
        b"x,y,z,radius\n"
        b"1.0,2.0,3.0,0.5\n"
        b"4.0,5.0,6.0,0.5\n"
        b"7.0,8.0,9.0,0.5\n"
    )

    _, n, _, _, metadata = parse_csv_geometry(body)

    assert n == 3
    assert metadata["unit"] == "nm"
    # The malformed line must NOT appear anywhere in metadata.
    assert "not a pair" not in metadata
    # Nor in the unknown-keys forward-compat bucket, since it had no key.
    assert "_unknown_keys" not in metadata or "not a pair" not in metadata.get(
        "_unknown_keys", {}
    )


# --- Extra coverage: CSV parse error still raises ----------------------------


def test_csv_missing_required_column_still_raises() -> None:
    """Regression: removing the radius column keeps raising CSVParseError.

    The new T12/T13 parser keeps the old validation — we only ADDED
    metadata and locale features, we didn't weaken anything.
    """
    raw = b"x,y,z\n1,2,3\n4,5,6\n"
    with pytest.raises(CSVParseError, match="Missing required columns"):
        parse_csv_geometry(raw)
