# openspec/ — Spec-Driven Development

This directory holds the **Spec-Driven Development (SDD)** artifacts for pyAgloGen3D.

## What lives here

```
openspec/
├── state.yaml     # project-wide SDD state (stack, test commands, conventions)
├── README.md      # this file
├── changes/       # active change proposals (one folder per change)
└── specs/         # canonical specs — deltas sync here on archive
```

## How SDD fits with the existing workflow

SDD is additive. It does NOT replace Jira or PRs — it sits *between* a Jira
ticket and the code, forcing intent to be written down before implementation:

```
Jira ticket (PYA-N)
        │
        ▼
openspec/changes/<change-name>/
   ├── proposal.md   ← why + scope
   ├── design.md     ← architecture decisions
   ├── specs/        ← requirements + scenarios (delta)
   └── tasks.md      ← broken-down work
        │
        ▼
fix/pya-N-* or feature/* branch
        │
        ▼
GitHub PR → main
        │
        ▼
openspec/specs/ ← deltas merged in on archive
```

## Workflow (mapped to SDD phases)

| Phase | What it produces | When |
|-------|------------------|------|
| `sdd-explore` | Investigation notes | Before committing to a change |
| `sdd-propose` | `proposal.md` | Once the idea is solid |
| `sdd-spec` | `specs/*.md` (delta) | Define requirements + scenarios |
| `sdd-design` | `design.md` | Architecture + tradeoffs |
| `sdd-tasks` | `tasks.md` | Implementation checklist |
| `sdd-apply` | Actual code | Implement following specs |
| `sdd-verify` | Validation report | Ensure code matches specs |
| `sdd-archive` | Merged specs | Sync delta → `specs/`, close change |

## Test commands

See `state.yaml` for the authoritative list. Summary:

- **Rust engine**: `cd aglogen_core && cargo test -p aglogen-engine`
  (use `PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1` for the python crate)
- **Django backend**: `cd backend && pytest`
- **Next.js frontend**: no test runner configured yet — lint + type-check only

## Conventions

- Conventional commits (no AI attribution in commit messages)
- Branches: `fix/pya-N-*`, `feature/*`, `rescue/*`
- Pragmatic testing (strict TDD **disabled** — existing codebase)

## For contributors

Do **not** hand-edit files under `specs/` — they are synced automatically when
a change is archived. Work inside `changes/<change-name>/` instead.
