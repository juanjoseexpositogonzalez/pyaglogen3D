"""Shared CSV locale helpers.

Hoisted from ``apps.simulations.views`` so that both simulations and
fractal_analysis CSV exports share the same decimal/delimiter logic.

Public API
----------
- ``get_user_csv_locale(request) -> tuple[str, str]``
- ``write_localized_row(writer, row, decimal) -> None``
"""

from __future__ import annotations

import re
from typing import Any

# Matches a "pure numeric cell" — optional sign, digits, optional single
# decimal point, optional exponent.  Only rewrite `.` → `,` on cells that
# match this, so non-numeric strings (IDs, names, unit labels) stay intact.
_NUMERIC_CELL_RE = re.compile(r"^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$")


def get_user_csv_locale(request: Any) -> tuple[str, str]:
    """Return ``(decimal, delimiter)`` for the authenticated user.

    Falls back to ``(".", ",")`` when the user is unauthenticated or when
    the profile fields are missing (e.g. during tests that bypass the
    migration).  Anonymous exports have always produced US-format CSV.
    """
    user = getattr(request, "user", None)
    decimal = getattr(user, "csv_decimal_separator", ".") or "."
    delimiter = getattr(user, "csv_column_delimiter", ",") or ","
    # Defensive: both attrs are CharField(max_length=1), but reject anything
    # we couldn't handle (e.g. a corrupted DB value) by falling back to US.
    if decimal not in (".", ","):
        decimal = "."
    if delimiter not in (",", ";", "\t"):
        delimiter = ","
    return decimal, delimiter


def _localize_numeric_cell(cell: Any, decimal: str) -> Any:
    """Rewrite a numeric cell's decimal separator for EU-locale output.

    Only pure numeric string cells are touched.  Non-string values are
    returned as-is (csv.writer converts them via ``str()`` on write, and
    those conversions use ``.`` by default — we never emit them through
    ``_localize_numeric_cell`` for EU output because the caller pre-formats
    floats with f-strings first).
    """
    if decimal != ",":
        return cell
    if isinstance(cell, str) and _NUMERIC_CELL_RE.match(cell):
        return cell.replace(".", ",")
    return cell


def _normalize_cell(cell: Any, decimal: str) -> Any:
    """Convert a cell value to its CSV-ready string representation.

    - ``None`` → ``""``
    - ``float`` → string with the correct decimal separator
    - ``int`` → unchanged (csv.writer handles it)
    - ``str`` → locale-swap numeric strings if EU decimal
    """
    if cell is None:
        return ""
    if isinstance(cell, float):
        s = str(cell)
        if decimal == ",":
            s = s.replace(".", ",")
        return s
    if isinstance(cell, str) and decimal == "," and _NUMERIC_CELL_RE.match(cell):
        return cell.replace(".", ",")
    return cell


def write_localized_row(writer: Any, row: list[Any], decimal: str) -> None:
    """Write a CSV row with decimal-separator localization applied.

    Handles raw floats, ints, None, and pre-formatted string cells:
    - Floats → str with chosen decimal separator
    - Ints → unchanged
    - None → empty string
    - Numeric strings → decimal-swapped if EU locale

    ``writer`` MUST already have been constructed with the user's column
    delimiter, so no delimiter handling happens here.
    """
    row = [_normalize_cell(cell, decimal) for cell in row]
    writer.writerow(row)
