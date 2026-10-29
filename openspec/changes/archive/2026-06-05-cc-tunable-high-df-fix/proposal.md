# Proposal: cc-tunable-high-df-fix

> SDD phase: PROPOSAL · Cycle 2 of 2
> Cycle 1 = `cc-tunable-low-df-fix` (archived 2026-05-29 — bounding `gamma/2` + PC seeds shipped, default ON)
> Prior exploration: `openspec/changes/cc-tunable-df-fidelity/explore.md` (§4.B, §7 cover high-Df)

## Intent

The CC-tunable generator silently CAPS measured `Df ≈ 2.4` whenever the user asks for
`Df_target ≥ 2.5`. Cycle 1 restored `Df ∈ [1.4, 1.7]`; Cycle 2 must restore `Df ∈ [2.5, 2.9]`
without regressing Cycle 1 (R22–R25) or the working mid band [1.7, 2.5].

**Root cause (explore.md §4.B H_B2, lines 258–267):** For high `Df_target`, `calculate_com_distance`
returns `Some(d)` even when `d < 2·rp` — a **geometrically impossible target** (two spheres of
radius `rp` cannot have COM distance `< 2·rp` without overlap). The pair passes the bounding-sum
feasibility screen, but every placement attempt in the retry loop fails (no contact geometry
exists). Retries exhaust → adaptive/ballistic fallback → contact at `d = 2·rp` (= ballistic Df ≈
2.0–2.2). Repeated across every late-stage merge, the measured Df caps at the **ballistic Df
≈ 2.4**, never reaching the high-Df target.

This is NOT a measurement bias (H_B3) and NOT the `march_inward d_start` cap (H_B1, which
explore.md §4.B line 250 explicitly retracted: *"the cap `min(max_achievable * 2.0)` therefore
has no effect here"*). It is a **missing physical-contact guard in feasibility screening**.

## Scope

### In Scope
- Restore `mean(Df_measured)/Df_target ∈ [0.85, 1.15]` for `Df_target ∈ {2.5, 2.7, 2.9}` with `N ≥ 100`, `seeds ≥ 3`.
- Add a `d_required >= 2·rp_max` physical-contact guard to feasibility screening (`find_feasible_pairs`).
- Add seed-pinned regression tests for `Df_target ∈ {2.5, 2.7, 2.9}` + non-regression for Cycle 1 (R22–R25).
- Flag-gated rollback (separate flag, orthogonal to `CC_TUNABLE_USE_LOW_DF_FIX`).

### Out of Scope
- Cycle 1 fixes (already shipped: `gamma/2` bounding, PC seeds).
- Mid band `[1.7, 2.5]` — no new work; only non-regression assertions.
- Rg-evolution estimator overhaul / box-counting parity (H_B3 measurement bias deferred — Cycle 1 already proved BC sanity holds via R25 at ±0.20).
- Larger refactor of `march_inward_merge` or `position_clusters_for_contact`.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `cc-tunable-aggregation`: adds R26 (high-Df fix flag), R27 (physical-contact feasibility guard), and extends R5/R19 convergence to `Df_target ∈ [2.5, 2.9]`.

## Approach

**Single flag-gated fix** (same pattern as Cycle 1): add a **physical-contact guard** to feasibility screening.

### Fix
- File: `aglogen_core/engine/src/simulation/tunable_cc.rs` — `find_feasible_pairs` (~line 1959).
- Today: a pair is feasible if `bounding_sum >= required_distance * 0.5` (Cycle 1 `gamma/2`). The geometric impossibility `d_required < 2·max(rp_i, rp_j)` is NOT caught — pairs pass, every placement fails, retries exhaust, fallback dumps to ballistic at `d = 2·rp`.
- New: a pair is feasible only when **both** (1) `required_distance >= 2 · max(rp_i, rp_j)` AND (2) `bounding_sum >= required_distance * 0.5` (Cycle 1 unchanged). When zero pairs satisfy (1), adaptive fallback engages with `merge_type = "adaptive_high_df_floor"` and `actual_distance = 2·rp_max` — by definition an overshoot of the impossible target.
- Effect: ballistic merges contaminating the Rg-evolution regression at high Df are eliminated. Adaptive merges land at the physical floor instead.

### Why this pick (H_B2) and not H_B1 / H_B3
| Hypothesis | Status |
|---|---|
| **H_B1** (march_inward `d_start` cap) | **Retracted** by explore.md §4.B line 250: *"the cap `min(max_achievable * 2.0)` therefore has no effect here"*. |
| **H_B2** (geometric impossibility unscreened) | **Chosen**. Explore.md §4.B lines 263–267: *"cascade into: feasible=true …, but every placement attempt fails, exhausting retries → adaptive/ballistic always"*. Narrow, deterministic, additive to Cycle 1. |
| **H_B3** (largest-cluster Rg estimator bias) | **Deferred**. Real, but Cycle 1's R25 already pins Rg-Df vs BC-Df within ±0.20. Touching the estimator now destabilizes Cycle 1's contract. Tracked for a future `cc-tunable-estimator-overhaul` cycle. |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modified | New const `USE_HIGH_DF_FIX_DEFAULT`, helper `read_high_df_fix_flag()`, guard inside `find_feasible_pairs` (~line 1959), new `merge_type` tag `"adaptive_high_df_floor"` |
| `aglogen_core/engine/tests/cc_tunable_high_df_test.rs` | New | Parametric sweep for `Df_target ∈ {2.5, 2.7, 2.9}` + Cycle 1 non-regression assertions |
| `examples/diagnostics/high_df_feasibility_audit.rs` | New | Diagnostic: count pairs failing physical-contact guard per merge step (before/after evidence) |
| `CHANGELOG.md` | Modified | Before/after Df+kf table for high-Df band |

No changes to `result.rs`, Python bindings, `SimulationResult` fields, or `metrics.rs`.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Stricter guard shrinks late-stage feasible pool → simulation stalls or exits early | Medium | Zero-feasible triggers immediate `adaptive_high_df_floor` (always merges); existing `N*1000` iteration cap; mid-band sweep gates merge |
| Regression in Cycle 1 R22–R25 (`gamma/2`, PC seeds, R25 BC sanity) | Medium | Guard is additive (extra `AND` clause) — does NOT weaken Cycle 1; Cycle 1 regression tests MUST pass |
| Mid band [1.7, 2.5] degrades because guard fires for borderline pairs | Low-Med | Mid-band sweep `Df ∈ {1.8, 2.0, 2.2, 2.4}` REQUIRED in regression suite before merging; design phase decides conditional-vs-unconditional guard |
| Adaptive fallback rate spikes for Df=2.9 (almost every late pair fails contact) | Medium | Acceptable — `2·rp_max` floor still produces dense structures; trace adaptive ratio per band; document in CHANGELOG |
| H_B2 alone restores Df only to ~2.6, not 2.9 (residual H_B3 estimator bias) | Medium | Success criteria use ±0.15 tolerance; if mean Df < 2.6 for target 2.9, escalate to `cc-tunable-estimator-overhaul` follow-up |

## Rollback Plan

Introduce env var `CC_TUNABLE_USE_HIGH_DF_FIX` (default `true`), read once at simulation start
via `read_high_df_fix_flag()` mirroring Cycle 1's `read_low_df_fix_flag()`. Setting it to
`false` reverts `find_feasible_pairs` to the Cycle 1-only behavior (no physical-contact guard).
Orthogonal to `CC_TUNABLE_USE_LOW_DF_FIX` and `CC_TUNABLE_USE_PHASE3_ALGORITHM`. Old DB rows are
not migrated; new runs use new defaults.

## Dependencies

- Cycle 1 archived: `cc-tunable-low-df-fix` (R22–R25 live).
- Required reading: `openspec/changes/cc-tunable-df-fidelity/explore.md` §4.B, §7; Engram #717 (Cycle 1 proposal).
- Rust engine only; no frontend/Python work (per session config `strict_tdd: false`).

## Success Criteria

- [ ] `|mean(Df_measured) − Df_target| ≤ 0.15` for `Df_target ∈ {2.5, 2.7, 2.9}` over ≥ 3 seeds, `N ≥ 100`.
- [ ] `mean(kf_measured) ≥ 1.0` for every high-Df run (no `kf < 1` regressions).
- [ ] Cycle 1 R-tests pass: R21 (Df=2.0 ±5%), R25 (BC vs Rg ±0.20 for Df ∈ [1.4, 1.7]) — non-regression.
- [ ] Mid-band non-regression: `Df_target ∈ {1.8, 2.0, 2.2, 2.4}` still converges within existing tolerances.
- [ ] Rollback verified: `CC_TUNABLE_USE_HIGH_DF_FIX=false` reproduces Cycle 1-only behavior byte-identically for at least 3 fixture configs.
- [ ] CHANGELOG before/after Df+kf table for `Df_target ∈ {2.5, 2.7, 2.9}`.
- [ ] Diagnostic `high_df_feasibility_audit` shows: pre-fix `physical_contact_fail_count > 0` at late stages; post-fix the same pairs are filtered upstream and adaptive merges land at `d = 2·rp_max`.

## Open Questions for Design Phase

1. **Guard scope: unconditional or `Df_target >= 2.4` only?** Unconditional is simpler and safer (explore.md notes the impossibility can occur at lower Df with specific n1/n2 splits); conditional guarantees zero mid-band risk. *Recommend unconditional + mid-band sweep.*
2. **`rp_max` definition:** per-particle `max(rp_i, rp_j)`, or per-cluster max-radius? *Recommend per-particle (matches MATLAB).*
3. **Adaptive merge tag granularity:** distinct `"adaptive_high_df_floor"` or fold into `"adaptive"`? *Recommend distinct (aids audit).*
4. **R25-style BC cross-check for the high-Df band?** Defense-in-depth at the cost of test runtime. *Recommend yes.*
