"""The SDD index must keep naming the archives that exist on disk.

Issue #130 found `openspec/state.yaml` declaring 12 archived changes
against 30 directories, and only 7 of those 12 resolving: the rest named
the same work under the other date convention. The index had been drifting
for about thirty archives with nothing to notice.

Regenerating it fixed the instance and left the class alive, which is what
a peer session pointed out: an index nobody checks can only drift again.
This is the check. The repository has no CI (`.github/workflows` is empty),
so it lives in the one suite that actually runs.

It needs no database and no Django settings beyond import.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
STATE = REPO_ROOT / "openspec" / "state.yaml"
ARCHIVE = REPO_ROOT / "openspec" / "changes" / "archive"


def _declared() -> list[str]:
    text = STATE.read_text(encoding="utf-8")
    block = text.split("archived_changes:", 1)[1].split("\nstack:", 1)[0]
    return [
        line.strip()[2:].strip()
        for line in block.splitlines()
        if line.strip().startswith("- ")
    ]


def _on_disk() -> list[str]:
    return sorted(entry.name for entry in ARCHIVE.iterdir() if entry.is_dir())


def test_state_yaml_declares_exactly_the_archived_changes_on_disk() -> None:
    declared, on_disk = set(_declared()), set(_on_disk())

    missing = sorted(on_disk - declared)
    phantom = sorted(declared - on_disk)
    assert not missing, (
        f"{len(missing)} archived change(s) exist on disk and are not declared "
        f"in openspec/state.yaml: {missing}"
    )
    assert not phantom, (
        f"{len(phantom)} entr(y/ies) in openspec/state.yaml name no directory. "
        "Two date conventions live side by side; use the name "
        f"`openspec archive` created, not the style of the file: {phantom}"
    )


def test_last_archived_names_a_directory_that_exists() -> None:
    text = STATE.read_text(encoding="utf-8")
    match = re.search(r"^last_archived:\s*(\S+)\s*$", text, flags=re.M)
    assert match, "openspec/state.yaml has no last_archived entry"

    last = match.group(1)
    assert (ARCHIVE / last).is_dir(), (
        f"last_archived points at `{last}`, which is not a directory under "
        "openspec/changes/archive/"
    )


def test_no_archived_change_is_declared_twice() -> None:
    declared = _declared()
    duplicates = sorted({name for name in declared if declared.count(name) > 1})
    assert not duplicates, f"declared more than once: {duplicates}"
