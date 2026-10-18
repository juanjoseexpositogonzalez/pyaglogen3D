# Proposal: cc-tunable-bc-alignment

> SDD phase: PROPOSAL · Cycle 3 sub-cycle 2 of 2 (PYA-17)
> Builds on sub-cycle 1 (`cc-tunable-rg-fit-fix`, archived 2026-10-18 — R27.4 accepted-deviation note).
> Prior exploration: Engram obs #9190 (estimator end-to-end) + docs/box_counting_comparison.md (known 0.05–0.2 Df bias vs Matlab).

## Intent

The engine's 3D box-counting estimator (`box_counting_3d_morton`) diverges from the Matlab
reference pipeline (`box_count.m` + `fit_frac.m`) in three documented ways, producing a
systematic Df bias of 0.05–0.2 on small/noisy agglomerates:

1. **Fit anchor**: the robust fit anchors on the **4 coarsest scales** (`start_idx = n−4`,
   `box_counting_3d.rs:299-380`) and greedily extends; Matlab uses a **fixed mid-scale window**
   (`e=[18,30]` of 32 levels, `fit_frac.m:3-11`). The coarse-anchor is the documented bias source.
2. **Log base**: natural log vs Matlab `log2` (numerically neutral for the slope, but intercept
   semantics and any range reporting differ).
3. **Precision**: Morton precision 18 (cap 21 bits/dim) vs Matlab `nb=32` — fewer scale levels;
   mid-window anchoring matters more when the level count is small.

Goal: expose a Matlab-aligned fit mode without breaking any existing consumer, and move the
high-Df BC sanity toward the long-term ±0.20 target (R27.5) where N allows.

Sub-cycle 1 established (evidence, design Log L1) that the Rg-evolution kf deficit is NOT
fixable by fit methodology; BC is the remaining estimator with a genuinely fixable bias.

## Scope

### In Scope
- Additive fit-window parameter on the 3D BC path (`fit_window` / `e_range` semantics — design
  locks the exact shape), default = **current behavior** for full backward compatibility.
- `log2` axis option behind the same additive parameter set (design locks whether it is a
  separate flag or tied to the aligned window).
- Dead-variable cleanup in `linear_regression_robust` (`best_start`/`best_r2`/`r2` residuals,
  `box_counting_3d.rs:312-358`) — verified numerically no-op (obs #9190 §2), rides along.
- Python binding + backend opt-in plumbing (additive optional params; default path untouched).
- Phase 0 diagnostic comparing current vs Matlab-aligned variants on real agglomerates
  (same Phase-0-first pattern that caught the inverted D1 premise in sub-cycle 1).
- N≥2000 diagnostic sweep targeting the ±0.20 long-term R27.5 tolerance (diagnostic first;
  test-tolerance tightening only if evidence supports it).

### Out of Scope
- Rg-evolution estimator (closed in sub-cycle 1: deficit is geometry, accepted deviation).
- 2D `box_counting.rs` (Fraktal images — separate naive-grid algorithm, untouched).
- Changing the DEFAULT BC behavior for any existing consumer (frontend `FractalMethod='box_counting'`,
  `sim_box_counting_df` CSV column, fraktal-batch contract) — additive opt-in only.
- Morton precision cap 21 → 32 rework (would change bit layout; deferred with rationale in design).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `cc-tunable-aggregation`: R27.5 note updated with the aligned-window evidence and the path to
  ±0.20 (test tolerance tightened only if Phase 0 evidence supports it at realistic N).

## Consumers / Blast Radius (from obs #9190 §4)

| Consumer | Site | Impact |
| --- | --- | --- |
| Python `box_counting_3d(coords, precision=18)` | `python/src/lib.rs:712-725` | additive optional param |
| Python `box_counting_agglomerate(...)` | `python/src/lib.rs:727-763` | additive optional param |
| Django endpoints + CSV `sim_box_counting_df` | `backend/apps/simulations/views.py:1502,1549,2116,2194`; specs `csv-export-locale.md:57`, `fraktal-batch-contract.md:273`, `import-aggregate-contract.md:141` | unchanged by default |
| Tests (8+ files) + diagnostics (6 examples) | engine tests, `examples/diagnostics/bc_*.rs`, `r25_n_sensitivity.rs` | must pass unmodified (default path) |

## Risks

| Risk | Mitigation |
| --- | --- |
| Default-path drift (any consumer sees different BC numbers) | Phase 0 asserts byte-identical default output before/after refactor; suite non-regression |
| Aligned window on 18-level Morton space is not equivalent to Matlab's 32-level window | Phase 0 measures both on real agglomerates; window semantics defined in our level space, not copied blindly |
| ±0.20 unreachable even aligned at N≤500 | Diagnostic-only tightening; canonical keeps ±0.90 with updated note if evidence says so |

## Verification Preview
- Phase 0 diagnostic `bc_window_alignment_audit.rs` → lock window semantics + log-base decision.
- Default-path byte-identity test (no consumer-visible change).
- Opt-in path: aligned window reproduces Matlab-pipeline Df within tight tolerance on fixture agglomerates.
- Full suite (`cargo test -p aglogen-engine --release`) + python binding tests.
