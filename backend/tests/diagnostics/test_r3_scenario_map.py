"""#115, point 12 - which canonical R3 scenario does each test actually cite.

The canonical spec renumbered its scenarios and the tests did not follow. Measured
before this file existed:

    apps/simulations/tests/test_grid_expansion.py   cited R3.3 and R3.4 for what
                                                    the canonical calls R3.1 and R3.2
    tests/test_sintering_shape.py                   cited R3.5, R3.6 and R3.7 for
                                                    three tests that exercise R3.8,
                                                    and cited R3.8 for what the
                                                    canonical calls R3.6

The effect is the worst of the two: anyone mapping by identifier was told R3.1,
R3.4 and R3.7 had no witness (they did, under another label) and that R3.3 and
R3.7 did (those tests proved something else).

This is a **diagnostic**, not a gate. A mechanical check cannot verify that a test
exercises the scenario it names - only that the number it names exists - so what
it asserts is the part that can be asserted, and it prints the rest for a human.

    cd backend && python -m pytest tests/diagnostics/test_r3_scenario_map.py -q -s
"""

from __future__ import annotations

import re
from pathlib import Path

SPEC = (
    Path(__file__).resolve().parents[3]
    / "openspec"
    / "specs"
    / "batch-cc-tunable-parameter-parity"
    / "spec.md"
)
BACKEND = Path(__file__).resolve().parents[2]

_SCENARIO = re.compile(r"^#### Scenario (R3\.\d+) — (.+)$", re.MULTILINE)
_CITATION = re.compile(r"\bR3\.(\d+)\b")


def _canonical() -> dict[str, str]:
    assert SPEC.exists(), f"the canonical spec is not where this expects it: {SPEC}"
    return dict(_SCENARIO.findall(SPEC.read_text(encoding="utf-8")))


def _test_files() -> list[Path]:
    return [
        path
        for path in sorted(BACKEND.rglob("test_*.py"))
        if "diagnostics" not in path.parts
    ]


def _cited() -> dict[str, list[str]]:
    """The scenarios a test file *declares*, via a `# --- R3.x — ...` header.

    Deliberately not every mention of `R3.x` in the tree. Measured by a judge on
    PR #237: scanning free text counted `test_box_counting_async.py`, whose R3.1
    belongs to another capability (`batch-windowed-box-counting`), and
    `test_parametric_study_serializer.py`, which labels a shape test R3.1/R3.2
    for different scenarios. Five of the seven citations of R3.1/R3.2 were false,
    and deleting the real witnesses did not change the report - the map claimed
    coverage that did not exist.

    A witness therefore declares itself with the header, which is greppable, owned
    by the file, and cannot be produced by a stray mention in prose.
    """
    found: dict[str, list[str]] = {}
    for path in _test_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        for line in text.splitlines():
            if not line.startswith("# --- R3"):
                continue
            rel = str(path.relative_to(BACKEND))
            for number in {f"R3.{n}" for n in _CITATION.findall(line)}:
                files = found.setdefault(number, [])
                # One file can declare the same scenario in more than one
                # section; counting it twice would inflate a "how well is this
                # covered" number, which is the one thing this report must not do.
                if rel not in files:
                    files.append(rel)
    return found


def _every_mention() -> dict[str, list[str]]:
    """Every `R3.x` anywhere, headers or prose: the superset used to assert.

    Being a superset only makes the existence check stricter, which is what an
    assertion wants; it is the *report* that must not be inflated.
    """
    found: dict[str, list[str]] = {}
    for path in _test_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        for number in {f"R3.{n}" for n in _CITATION.findall(text)}:
            found.setdefault(number, []).append(str(path.relative_to(BACKEND)))
    return found


def test_every_cited_scenario_exists_in_the_canonical() -> None:
    """The mechanical half: a citation to a scenario that moved or vanished.

    Runs over every mention, headers and prose alike: a wider net only makes this
    stricter. It is what caught the state point 12 was opened for - a test
    claiming a number the canonical no longer uses for that behaviour.
    """
    canonical = _canonical()
    unknown = {
        number: files
        for number, files in _every_mention().items()
        if number not in canonical
    }

    assert not unknown, (
        "these files cite scenarios the canonical does not have: "
        + ", ".join(
            f"{number} ({files[0]})" for number, files in sorted(unknown.items())
        )
    )


def test_print_the_map_so_a_human_can_see_the_gaps() -> None:
    """The half that cannot be asserted, printed instead of guessed.

    A scenario with no citation is either a genuine gap or a test that does not
    say which scenario it covers. Only a person can tell those apart, so this
    reports and does not fail.
    """
    canonical = _canonical()
    cited = _cited()

    assert canonical, "no scenario parsed: the canonical format moved"

    print("\n=== canonical R3 scenarios ===")
    for number in sorted(canonical, key=lambda n: int(n.split(".")[1])):
        files = cited.get(number, [])
        where = f"{len(files)} file(s): {', '.join(sorted(files))}"
        mark = "  " if files else "NO WITNESS CITED -> "
        print(f"  {mark}{number}: {canonical[number]}")
        if files:
            print(f"      {where}")
