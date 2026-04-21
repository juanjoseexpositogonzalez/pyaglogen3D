"""MATLAB ``.mat`` single-agglomerate importer.

This module bridges MATLAB-generated aggregate files into the pyAgloGen3D
import pipeline. It accepts v7 (and earlier) ``.mat`` files written by
``scipy.io.savemat`` or MATLAB's default ``save(...)`` and extracts an
``(N, 4)`` geometry matrix (``[x, y, z, radius]``) from variables named
``clusters`` or ``part``.

Contract (design Component 2 / spec R6):

- **v7.3 (HDF5) is explicitly rejected** with a clear re-save hint, because
  :func:`scipy.io.loadmat` can't read HDF5 without ``h5py``. Supporting HDF5
  is out of scope for this change.
- **Variable preference**: ``clusters`` wins if both ``clusters`` and
  ``part`` are present — this matches the MATLAB AgloGen3D reference
  implementation where ``clusters`` is the post-processed canonical export.
- **Multi-agglomerate ``.mat`` is rejected**. The presence of ``NofPart``
  with length > 1 signals a batch file; we ask the user to export a single
  agglomerate instead (spec R6 scenario).
- **Shape is always validated**: the extracted matrix must be exactly
  ``(N, 4)`` with ``N > 0`` and every radius finite and strictly positive.
  Garbage data fails fast at 400 at the view layer, never 500.

All distances are assumed to be in the same unit as the radius column;
no unit inference is done here. The view layer stamps
``primary_particle_diameter_nm`` from ``2 * mean(radius)`` and records
``import_metadata.source = "matlab"`` so downstream consumers can trace
the origin.

Callers:

- :meth:`apps.simulations.views.SimulationViewSet._process_import_payload`
  routes ``.mat`` uploads here before the post-parse pipeline (re-center,
  stamp contract params, enqueue metrics task).
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import numpy as np
import scipy.io


class MatParseError(Exception):
    """Raised when a ``.mat`` file cannot be interpreted as a single agglomerate.

    The view layer converts this into an HTTP 400 response with the exception
    message as-is, so make every message actionable — tell the user what they
    need to change about the file.
    """


# Variable name preference order: ``clusters`` (MATLAB AgloGen3D post-processed
# export) wins over ``part`` (raw simulator output). Documented in spec R6
# "Both names present → clusters is used".
_VARIABLE_PREFERENCE: tuple[str, ...] = ("clusters", "part")


def parse_mat_geometry(raw: bytes) -> tuple[np.ndarray, dict[str, Any]]:
    """Parse a ``.mat`` byte blob into an ``(N, 4)`` geometry + metadata.

    Args:
        raw: The raw bytes of the ``.mat`` file. Typically this comes from
            the upload view after base64-decoding the ``csv_data`` payload
            (the field is a misnomer for ``.mat`` uploads but we keep the
            name for wire compatibility — see views._process_import_payload).

    Returns:
        A 2-tuple ``(geometry, metadata)`` where:

        - ``geometry`` is a ``(N, 4)`` ``numpy.ndarray`` of dtype ``float64``
          with columns ``[x, y, z, radius]``. Guaranteed ``N > 0`` and every
          radius finite and strictly positive.
        - ``metadata`` is a dict with keys:
            * ``"source"``: always ``"matlab"``.
            * ``"original_variable"``: ``"clusters"`` or ``"part"`` (which
              variable was chosen).
            * ``"n_particles"``: the row count as a plain ``int``.

    Raises:
        MatParseError: For any of the rejection cases. The exception message
            is user-facing and is relayed verbatim by the view layer as an
            HTTP 400 body.

    Rejection cases (all produce :class:`MatParseError`):

    - ``raw`` is a v7.3 / HDF5 file (``scipy.io.loadmat`` raises
      ``NotImplementedError``).
    - Neither ``clusters`` nor ``part`` is present.
    - ``part`` is chosen and ``NofPart`` has more than one element.
    - The chosen variable is not a 2-D array of shape ``(N, 4)``.
    - ``N == 0``.
    - Any radius is non-finite or ``<= 0``.
    - Any coordinate is non-finite.
    """
    # Step 1: load the file. ``squeeze_me=True`` collapses trailing singleton
    # axes so a MATLAB ``1×N×4`` cell unwraps cleanly to ``N×4``. On v7.3
    # files (HDF5 under the hood), loadmat raises NotImplementedError — we
    # convert that to a user-facing MatParseError with the re-save hint.
    try:
        mat = scipy.io.loadmat(BytesIO(raw), squeeze_me=True)
    except NotImplementedError as exc:
        raise MatParseError(
            "MATLAB v7.3 (HDF5) not supported; save as -v7 or earlier"
        ) from exc
    except Exception as exc:  # pragma: no cover — defensive; scipy raises various types on corrupt files
        # Corrupt bytes, truncated file, wrong magic, etc. Bundle them all
        # into a single actionable message instead of leaking scipy's
        # internal exception types to the user.
        raise MatParseError(
            f"Could not read .mat file (is it a valid MATLAB file?): {exc}"
        ) from exc

    # Step 2: pick the variable. Prefer ``clusters`` per spec R6. If ``part``
    # is used, validate ``NofPart`` semantics (single agglomerate only).
    chosen_name: str | None = None
    chosen_array: Any = None
    for name in _VARIABLE_PREFERENCE:
        if name in mat:
            chosen_name = name
            chosen_array = mat[name]
            break

    if chosen_name is None:
        # Present-but-wrong: tell the user what we looked for. Filtering
        # private ``__*`` keys keeps the message focused on user-level
        # variables instead of MATLAB's header metadata.
        user_vars = sorted(k for k in mat if not k.startswith("__"))
        raise MatParseError(
            "No geometry variable found. Expected 'clusters' or 'part'. "
            f"File contains: {user_vars}"
        )

    # Step 3: multi-agglomerate rejection. ``NofPart`` is an array of
    # per-cluster particle counts; length > 1 means the file carries more
    # than one agglomerate, which is explicitly out of scope for MVP
    # (spec R6 "Multiple agglomerates rejected").
    #
    # We only enforce this when the chosen variable is ``part`` — the
    # post-processed ``clusters`` layout is always single-agglomerate by
    # definition in the AgloGen3D MATLAB reference.
    if chosen_name == "part" and "NofPart" in mat:
        nof_part = np.atleast_1d(np.asarray(mat["NofPart"]))
        if nof_part.size > 1:
            raise MatParseError(
                "Multi-agglomerate .mat not supported; export a single agglomerate "
                f"(NofPart has {nof_part.size} entries)"
            )
        # NofPart.size == 1 (or 0, treated as single) is fine — falls through.

    # Step 4: shape + dtype validation. Cast to float64 upfront so downstream
    # numeric code never has to second-guess MATLAB's integer exports.
    geometry = np.asarray(chosen_array, dtype=np.float64)

    # An ``(N, 4)`` file that MATLAB stored as a cell of rows can come back
    # as an object array from loadmat. Force a sane 2-D shape check.
    if geometry.ndim != 2 or geometry.shape[1] != 4:
        raise MatParseError(
            f"Variable '{chosen_name}' has shape {geometry.shape}; expected "
            "(N, 4) with columns [x, y, z, radius]"
        )

    n_particles = int(geometry.shape[0])
    if n_particles == 0:
        raise MatParseError(
            f"Variable '{chosen_name}' is empty; no particles to import"
        )

    # Step 5: finite + positive-radius validation. Box-counting and CoM
    # re-centering both silently misbehave on NaN/Inf, so we reject here
    # with a clear message instead of bubbling up numeric errors downstream.
    if not np.all(np.isfinite(geometry)):
        raise MatParseError(
            f"Variable '{chosen_name}' contains non-finite (NaN/Inf) values"
        )

    radii = geometry[:, 3]
    if not np.all(radii > 0.0):
        raise MatParseError(
            f"Variable '{chosen_name}' has non-positive radii; every radius must be > 0"
        )

    metadata: dict[str, Any] = {
        "source": "matlab",
        "original_variable": chosen_name,
        "n_particles": n_particles,
    }

    return geometry, metadata


__all__ = ["MatParseError", "parse_mat_geometry"]
