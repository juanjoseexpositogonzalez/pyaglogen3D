"""Unit tests for ``apps.core.services.csv_locale`` (hoisted helpers).

Covers spec R1 (locale resolution) and R2 (localized row writing):
- Anonymous / EU / mixed / corrupt user prefs (R1)
- Float rendering with comma decimal (R2, scenario 2.1)
- Very small / very large floats (R2, scenario 2.2 / 2.3)
- None → empty string (R2, scenario 2.4)
- NaN and integer passthrough
"""

from __future__ import annotations

import csv
import io
import math
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from apps.core.services.csv_locale import (
    get_user_csv_locale,
    write_localized_row,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fake_request(
    *,
    authenticated: bool = True,
    decimal: str = ".",
    delimiter: str = ",",
) -> MagicMock:
    """Build a minimal request-like object with user prefs."""
    request = MagicMock()
    if not authenticated:
        request.user = None
    else:
        user = SimpleNamespace(
            csv_decimal_separator=decimal,
            csv_column_delimiter=delimiter,
            is_authenticated=True,
        )
        request.user = user
    return request


def _capture_row(row: list, decimal: str, delimiter: str = ",") -> list[str]:
    """Write a row via write_localized_row and return parsed cells."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter)
    write_localized_row(writer, row, decimal)
    buf.seek(0)
    return next(csv.reader(buf, delimiter=delimiter))


# ---------------------------------------------------------------------------
# R1 — get_user_csv_locale
# ---------------------------------------------------------------------------


class TestGetUserCsvLocale:
    """Spec R1 scenarios."""

    def test_anonymous_request(self) -> None:
        """Scenario 1.1 — anonymous → ('.', ',')."""
        req = _fake_request(authenticated=False)
        assert get_user_csv_locale(req) == (".", ",")

    def test_european_prefs(self) -> None:
        """Scenario 1.2 — EU (',', ';')."""
        req = _fake_request(decimal=",", delimiter=";")
        assert get_user_csv_locale(req) == (",", ";")

    def test_mixed_prefs(self) -> None:
        """Scenario 1.3 — mixed ('.', ';')."""
        req = _fake_request(decimal=".", delimiter=";")
        assert get_user_csv_locale(req) == (".", ";")

    def test_tab_delimiter(self) -> None:
        """Tab is a valid delimiter."""
        req = _fake_request(delimiter="\t")
        assert get_user_csv_locale(req) == (".", "\t")

    def test_corrupt_decimal_falls_back_to_dot(self) -> None:
        """Corrupt decimal value → fallback to '.'."""
        req = _fake_request(decimal="X")
        assert get_user_csv_locale(req)[0] == "."

    def test_corrupt_delimiter_falls_back_to_comma(self) -> None:
        """Corrupt delimiter value → fallback to ','."""
        req = _fake_request(delimiter="X")
        assert get_user_csv_locale(req)[1] == ","

    def test_empty_string_prefs_fall_back(self) -> None:
        """Empty string for decimal/delimiter → fallback to defaults."""
        req = _fake_request(decimal="", delimiter="")
        assert get_user_csv_locale(req) == (".", ",")

    def test_user_without_pref_attrs(self) -> None:
        """User object missing csv_* attrs → fallback to defaults."""
        req = MagicMock()
        req.user = SimpleNamespace(is_authenticated=True)  # no csv_* attrs
        assert get_user_csv_locale(req) == (".", ",")


# ---------------------------------------------------------------------------
# R2 — write_localized_row
# ---------------------------------------------------------------------------


class TestWriteLocalizedRow:
    """Spec R2 scenarios."""

    def test_floats_with_comma_decimal(self) -> None:
        """Scenario 2.1 — floats rendered with comma decimal."""
        cells = _capture_row([1.5, 2.0], decimal=",")
        assert cells[0] == "1,5"
        assert cells[1] == "2,0"

    def test_very_small_float(self) -> None:
        """Scenario 2.2 — 1e-10 with comma decimal.

        str(1e-10) → '1e-10' (no decimal point). The cell must not contain
        a dot (no US decimal leaking) and must parse back to the original.
        A value WITH a decimal like 1.5e-10 → '1,5e-10'.
        """
        cells = _capture_row([1e-10], decimal=",")
        # No dot (US decimal) should appear
        assert "." not in cells[0]
        # Parsable back to the original value
        assert float(cells[0].replace(",", ".")) == pytest.approx(1e-10)

    def test_very_small_float_with_decimal(self) -> None:
        """1.5e-10 with comma decimal → comma replaces the dot."""
        cells = _capture_row([1.5e-10], decimal=",")
        assert "," in cells[0]
        assert "." not in cells[0]
        assert float(cells[0].replace(",", ".")) == pytest.approx(1.5e-10)

    def test_very_large_float(self) -> None:
        """Scenario 2.3 — 1e10 with dot decimal."""
        cells = _capture_row([1e10], decimal=".")
        assert float(cells[0]) == pytest.approx(1e10)

    def test_none_renders_empty(self) -> None:
        """Scenario 2.4 — None → empty string."""
        cells = _capture_row(["x", None, 3.14], decimal=".")
        assert cells[0] == "x"
        assert cells[1] == ""
        assert float(cells[2]) == pytest.approx(3.14)

    def test_integer_passthrough(self) -> None:
        """Ints are unchanged regardless of decimal setting."""
        cells = _capture_row([42, 0], decimal=",")
        assert cells[0] == "42"
        assert cells[1] == "0"

    def test_nan_float(self) -> None:
        """NaN renders as a string, no crash."""
        cells = _capture_row([float("nan")], decimal=",")
        # Should not crash; the cell is some representation of NaN
        assert cells[0] != ""

    def test_string_with_dot_not_converted(self) -> None:
        """Non-numeric strings with dots are NOT converted (e.g. UUIDs)."""
        cells = _capture_row(["abc.def", "1.2.3"], decimal=",")
        # These are NOT numeric cells, should be untouched
        assert cells[0] == "abc.def"
        assert cells[1] == "1.2.3"

    def test_numeric_string_with_comma_decimal(self) -> None:
        """Pre-formatted numeric strings like '1.5000' get comma-swapped."""
        cells = _capture_row(["1.5000", "3.14"], decimal=",")
        assert cells[0] == "1,5000"
        assert cells[1] == "3,14"

    def test_floats_with_dot_decimal_unchanged(self) -> None:
        """With dot decimal, floats render normally."""
        cells = _capture_row([1.5, 2.0], decimal=".")
        assert cells[0] == "1.5"
        assert cells[1] == "2.0"
