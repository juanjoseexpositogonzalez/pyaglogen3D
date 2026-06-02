# Tasks: cc-tunable-high-df-fix

> SDD phase: TASKS · Cycle 2 of 2
> Proposal: `openspec/changes/cc-tunable-high-df-fix/proposal.md`
> Spec: `openspec/changes/cc-tunable-high-df-fix/specs/cc-tunable-aggregation.md`
> Design: `openspec/changes/cc-tunable-high-df-fix/design.md`
> Capability modified: `cc-tunable-aggregation` (R26, R27, extended R5/R19)

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~520–680 |
| 400-line budget risk | **High** |
| Chained PRs recommended | **Yes — 3 PRs** |
| Suggested split | PR 1 (Phase 0–2: snapshot + flag infra) → PR 2 (Phase 3–4: guard + behavioral tests) → PR 3 (Phase 5–8: non-regression + rollback + diagnostic + docs) |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

> **Action required before sdd-apply starts**: Confirm the feature-branch-chain strategy (inherited from Cycle 1) and authorize PR 1. Tracker branch: `feature/cc-tunable-high-df-fix`. PR 1 base = tracker branch. PR 2 base = PR 1 branch. PR 3 base = PR 2 branch.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Pre-fix snapshot + `USE_HIGH_DF_FIX_DEFAULT` const + `read_high_df_fix_flag()` | PR 1 | **Base: `feature/cc-tunable-high-df-fix`**. Fixtures only + flag infra. No behavioral change. Analogy: Cycle 1 PR 1+2. ~+180/-0 lines. |
| 2 | Guard in `find_feasible_pairs` + `use_high_df_fix` thread-through + `adaptive_high_df_floor` tag + R26/R27 parametric tests | PR 2 | **Base: PR 1 branch**. The behavioral change + its primary tests. ~+230/-15 lines. |
| 3 | Mid-band non-regression sweep + Cycle 1 non-regression (R21, R25) + rollback byte-identity tests + diagnostic example + CHANGELOG + docs | PR 3 | **Base: PR 2 branch**. Evidence + cleanup. ~+110/-5 lines. |

---

## Phase 0: Pre-Fix Snapshot Capture

> **MUST commit and merge into tracker branch before any source code change (mirrors Cycle 1 R24 pattern).**

- [x] 0.1 Create `aglogen_core/engine/tests/fixtures/pre_high_df_fix/README.md` — explain fixture provenance, parameters, and regeneration command. `+12/-0` lines. No source changes.
  - **Deps**: none.
- [x] 0.2 Add `aglogen_core/engine/examples/fixtures/gen_pre_high_df_fix_snapshots.rs` (`[[example]]` target `gen_pre_high_df_fix_snapshots`) — calls `run_tunable_cc_internal` for 3 tuples: `(seed=1, Df=2.7, N=100)`, `(seed=2, Df=2.9, N=100)`, `(seed=3, Df=2.5, N=100)` with `CC_TUNABLE_USE_HIGH_DF_FIX=false` (Cycle 1 production default), writes `coordinates`, `radii`, `fractal_dimension`, `prefactor`, `merge_trace` to compact JSON at `tests/fixtures/pre_high_df_fix/{name}.json`. Verify: `cargo run --release --example gen_pre_high_df_fix_snapshots -p aglogen-engine`. `+60/-0` lines.
  - **Deps**: none.
- [x] 0.3 Commit the 3 generated `.json` fixture files under `tests/fixtures/pre_high_df_fix/`. Hash-stable across two consecutive runs. `+~90/-0` lines (compact JSON).
  - Test: `cargo test --test cc_tunable_high_df_test` (existing suite must still pass before any source change).
  - **Deps**: 0.2.
  - **Hash-stable**: md5 confirmed identical across 2 consecutive runs. Pre-fix Df: {seed1=2.335, seed2=2.427, seed3=2.399} (capped at ~2.4 due to H_B2 bug — expected, confirms fixture captures Cycle-1-only path).

**Phase 0 exit gate**: 3 fixture files present and committed. Zero files in `src/` changed.

---

## Phase 1: Flag Constant + Reader

> Mirrors Cycle 1 Phase 1. No behavioral change — flag-off is identical to current production.

- [x] 1.1 In `tunable_cc.rs` lines ~66–87 (after `read_low_df_fix_flag`, before SALT REGISTRY): add `const USE_HIGH_DF_FIX_DEFAULT: bool = true` with full doc-comment (default ON, rollback, orthogonality to R22/R20). Add a SALT REGISTRY entry line for discoverability (no new salt needed for this flag). `+18/-0` lines.
  - **Deps**: Phase 0.
- [x] 1.2 Add `fn read_high_df_fix_flag() -> bool` immediately below the constant — exact mirror of `read_low_df_fix_flag()` pattern (lines 66–71), reads `CC_TUNABLE_USE_HIGH_DF_FIX`, off-values `"false"|"0"|"no"`. `+8/-0` lines.
  - **Deps**: 1.1.
- [x] 1.3 Add unit tests `high_df_fix_flag_default_on`, `high_df_fix_flag_off_values`, `high_df_fix_flag_orthogonal_to_r20_r22` to `aglogen_core/engine/tests/cc_tunable_high_df_test.rs` (create file). Tests via behavioral effects (public API); covers R26.1, R26.2, R26.3. `+55/-0` lines (new file).
  - Test: `cargo test -p aglogen-engine --test cc_tunable_high_df_test high_df_fix_flag`.
  - **Deps**: 1.2.
  - **PR1 also includes**: `_use_high_df_fix = read_high_df_fix_flag()` call site in `run_tunable_cc_internal` (no-op read, wired as `_use_high_df_fix` until PR2 passes it to `select_pair_smart`).

---

## Phase 2: Guard in `find_feasible_pairs` + Signature Thread-Through + Tag

> This phase contains the actual behavioral change. Flag-false path MUST remain byte-identical to current production (Cycle 1 state).

- [x] 2.1 Add `use_high_df_fix: bool` parameter to `find_feasible_pairs` signature (~line 2092–2098). Insert guard block after `Some(d) => d` and before the `bounding_sum >= required * bounding_threshold_factor` check: `if use_high_df_fix { let rp_i = clusters[i].particles.first().map(|s| s.radius).unwrap_or(rp); let rp_j = ...; let rp_max = rp_i.max(rp_j); if required < 2.0 * rp_max { continue; } }`. Update doc-comment. `+14/-2` lines.
  - **Deps**: 1.2.
- [x] 2.2 Add `use_high_df_fix: bool` parameter to `select_pair_smart` signature (~line 2136–2143). Thread through to `find_feasible_pairs` call. Update doc-comment. `+2/-1` lines.
  - **Deps**: 2.1.
- [x] 2.3 In `run_tunable_cc_internal` (~line 1063–1064): read `let use_high_df_fix = read_high_df_fix_flag();` alongside existing flag reads. Pass `use_high_df_fix` to `select_pair_smart` at ~line 1109. `+2/-1` lines.
  - **Deps**: 2.2.
- [x] 2.4 Modify `emit_adaptive_merge_entry` (~line 2189): add `merge_type_override: Option<&str>` parameter. Change the `merge_type` field assignment to `merge_type_override.unwrap_or("adaptive").to_string()`. Update all 3 existing call sites to pass `None` (no behavior change for existing callers). `+4/-3` lines (function + 3 call sites).
  - **Deps**: 2.3.
- [x] 2.5 In `run_tunable_cc_internal` `AllInfeasible` branch (~lines 1290–1333): when `use_high_df_fix = true`, pass `Some("adaptive_high_df_floor")` to `emit_adaptive_merge_entry` (both the march-success path at ~1328 and the march-fail ballistic path tagged with new merge_type). `+3/-2` lines.
  - **Deps**: 2.4.
- [ ] 2.6 Add unit test `physical_contact_guard_excludes_impossible_pair` to `cc_tunable_high_df_test.rs`: constructs a pair where `required_distance < 2·rp`, asserts `find_feasible_pairs` with flag ON returns empty; with flag OFF returns non-empty. Covers R27.1, R27.3. `+35/-0` lines.
  - Test: `cargo test -p aglogen-engine --test cc_tunable_high_df_test physical_contact_guard`.
  - **Deps**: 2.1.
- [ ] 2.7 Add unit test `adaptive_high_df_floor_tag_emitted` to `cc_tunable_high_df_test.rs`: low-cluster-count setup where all pairs have `required < 2·rp`; assert `select_pair_smart` with flag ON returns `AllInfeasible`; emitted trace has `merge_type == "adaptive_high_df_floor"`. Covers R27.2, R5 S5.5. `+40/-0` lines.
  - Test: `cargo test -p aglogen-engine --test cc_tunable_high_df_test adaptive_high_df_floor_tag`.
  - **Deps**: 2.5.

---

## Phase 3: High-Df Parametric Tests (R26/R27/R5/R19)

> Core acceptance tests for the behavioral fix. Written in the same test file (task 1.3 created it).

- [ ] 3.1 `high_df_convergence_band` in `cc_tunable_high_df_test.rs`: flag ON, `Df_target ∈ {2.5, 2.7, 2.9}`, `target_kf=1.3`, `N=100`, seeds `{1,2,3}`, `seed_type=Dimers`. Assert `|mean(fractal_dimension) − Df_target| ≤ 0.15` and `prefactor >= 1.0` per run. Covers R27.4, R5 S5.10, R19.7. `+55/-0` lines.
  - Test: `cargo test -p aglogen-engine --release --test cc_tunable_high_df_test high_df_convergence_band`.
  - **Deps**: Phase 2 complete.
- [ ] 3.2 `high_df_bc_sanity` in `cc_tunable_high_df_test.rs`: same sweep → call `box_counting_3d_morton` on coordinates → assert `|BC_Df − fractal_dimension| ≤ 0.20` for every (Df_target, seed). Assert no NaN/Inf/negative BC_Df. Covers R27.5, R5 S5.10 BC clause, locked decision #4. `+50/-0` lines.
  - Test: `cargo test -p aglogen-engine --release --test cc_tunable_high_df_test high_df_bc_sanity`.
  - **Deps**: 3.1.
- [ ] 3.3 `floor_actual_distance_equals_2rp_max` in `cc_tunable_high_df_test.rs`: run at Df=2.9, N=20, seed=7 (monomer pool to force all early pairs to fail guard); scan `merge_trace` for `"adaptive_high_df_floor"` entries; assert `actual_distance == 2.0 * rp_max` within 1 ULP. Covers R27.2, R5 S5.12. `+30/-0` lines.
  - Test: `cargo test -p aglogen-engine --test cc_tunable_high_df_test floor_actual_distance`.
  - **Deps**: 2.5.
- [ ] 3.4 `flag_off_no_high_df_floor_tag` in `cc_tunable_high_df_test.rs`: flag OFF, `Df_target=2.7`, seeds `{1,2,3}`. Assert NO `"adaptive_high_df_floor"` entries in any `merge_trace`. Covers R27.6, R26.2. `+25/-0` lines.
  - Test: `cargo test -p aglogen-engine --test cc_tunable_high_df_test flag_off_no_high_df_floor_tag`.
  - **Deps**: 2.5.

---

## Phase 4: Mid-Band Non-Regression Sweep

- [ ] 4.1 `mid_band_non_regression_high_df_fix_on` in `aglogen_core/engine/tests/integration_cc_tunable.rs`: flag ON AND low-Df flag ON (defaults), `Df_target ∈ {1.8, 2.0, 2.2, 2.4}`, `target_kf=1.3`, `N=300`, seeds `{1,2,3}`, `seed_type=Dimers`. Assert each meets existing R21/R5 tolerance tier. Assert `adaptive_high_df_floor` rate ≤ 10% of total merges in any single run. Covers R27.7, R5 S5.11, locked decision #1. `+55/-0` lines.
  - Test: `cargo test -p aglogen-engine --release --test integration_cc_tunable mid_band_non_regression_high_df_fix_on`.
  - **Deps**: Phase 2 complete.

---

## Phase 5: Cycle 1 Non-Regression (R21, R25)

- [ ] 5.1 `r21_still_converges_with_high_df_fix` in `integration_cc_tunable.rs`: rerun existing R21 assertion set with `CC_TUNABLE_USE_HIGH_DF_FIX=true` (new default). `Df ∈ {1.8, 2.0, 2.2, 2.5}`, N=300, seeds `{1,2,3}`. Assert all pass R21 ±5%. `+20/-2` lines (reuse setup, add explicit flag assertion).
  - Test: `cargo test -p aglogen-engine --release --test integration_cc_tunable r21_still_converges_with_high_df_fix`.
  - **Deps**: Phase 2 complete.
- [ ] 5.2 `r25_bc_sanity_low_df_band_unaffected` in `integration_cc_tunable.rs`: `Df ∈ {1.4, 1.5, 1.6, 1.7}`, flag ON + low-Df fix ON. Assert `|BC_Df − fractal_dimension| ≤ 0.20`. Cycle 1 R25 non-regression. `+20/-0` lines.
  - Test: `cargo test -p aglogen-engine --release --test integration_cc_tunable r25_bc_sanity_low_df_band_unaffected`.
  - **Deps**: Phase 2 complete.

---

## Phase 6: Rollback Byte-Identity Tests

> **Critical**: includes the design-flagged double-rollback interaction risk.

- [ ] 6.1 `rollback_high_df_fix_false_matches_pre_fix_snapshot` in `cc_tunable_high_df_test.rs`: load 3 Phase 0 fixtures; re-run with `CC_TUNABLE_USE_HIGH_DF_FIX=false`, `CC_TUNABLE_USE_LOW_DF_FIX=true`; assert `fractal_dimension`, `prefactor`, `coordinates`, `radii` are bit-identical (or 1e-10 relative for coordinates, mirroring Cycle 1 R24 tolerance). Covers R26.4, R27.6. `+45/-0` lines.
  - Test: `cargo test -p aglogen-engine --test cc_tunable_high_df_test rollback_high_df_fix_false`.
  - **Deps**: Phase 0 fixtures; Phase 2 complete.
- [ ] 6.2 `rollback_both_flags_false_matches_pre_cycle1` in `cc_tunable_high_df_test.rs`: **DOUBLE-ROLLBACK test** — `CC_TUNABLE_USE_HIGH_DF_FIX=false` AND `CC_TUNABLE_USE_LOW_DF_FIX=false`. Assert monomer pairs REAPPEAR (PC seed pool absent). Assert results are byte-identical to pre-Cycle-1 behavior (use the Cycle 1 `tests/fixtures/pre_low_df_fix/` fixtures as ground truth). **This is the design-flagged interaction risk** (design.md §4, flag matrix row 1). Covers R24.1 + R26.4 combined. `+35/-0` lines.
  - Test: `cargo test -p aglogen-engine --test cc_tunable_high_df_test rollback_both_flags_false`.
  - **Deps**: Cycle 1 `pre_low_df_fix` fixtures; Phase 2 complete.
- [ ] 6.3 `rollback_no_rng_fork_high_df` in `cc_tunable_high_df_test.rs`: flag OFF, two consecutive runs same seed → bit-identical coordinates. Verifies guard is read-only (no RNG consumption). Covers R26.4 RNG invariant. `+18/-0` lines.
  - Test: `cargo test -p aglogen-engine --test cc_tunable_high_df_test rollback_no_rng_fork_high_df`.
  - **Deps**: Phase 2 complete.

---

## Phase 7: Diagnostic Example

- [ ] 7.1 Create `examples/diagnostics/high_df_feasibility_audit.rs`: runs two simulations for each `Df_target ∈ {2.7, 2.9}`, `N=100`, `seed=42` — BEFORE (`USE_HIGH_DF_FIX=false`) and AFTER (`USE_HIGH_DF_FIX=true`). Per merge step: counts pairs where `calculate_com_distance` returns `Some(d)` with `d < 2·rp_max`; counts ballistic/adaptive/`adaptive_high_df_floor` entries; prints final Df. Expected output pattern per design §7. `+90/-0` lines.
  - Test: `cargo run --release --example high_df_feasibility_audit -p aglogen-engine` (manual / nightly; not gated in CI).
  - **Deps**: Phase 2 complete.

---

## Phase 8: CHANGELOG + Docs

- [ ] 8.1 In `CHANGELOG.md`: add `## cc-tunable-high-df-fix (unreleased)` entry with before/after Df+kf table for `Df_target ∈ {2.5, 2.7, 2.9}` (measured values from Phase 3 runs), `CC_TUNABLE_USE_HIGH_DF_FIX` rollback instructions, Cycle 2 note, reference to `high_df_feasibility_audit` diagnostic. `+40/-0` lines.
  - **Deps**: Phase 3 and Phase 5 measured values available.
- [ ] 8.2 Add doc-comment to `read_high_df_fix_flag()` — default behavior, rollback steps, orthogonality to R20/R22, parse-once contract, SALT REGISTRY note. `+15/-0` lines.
  - **Deps**: 1.2.
- [ ] 8.3 Extend `docs/cc-tunable-formula-fix.md` with new "High-Df Convergence Fix" section: root cause (H_B2 geometric impossibility), fix mechanism (physical-contact guard), before/after table, adaptive_high_df_floor tag explanation, rollback, `high_df_feasibility_audit` reference, Cycle 2 companion change note. `+35/-0` lines.
  - **Deps**: Phase 7 output available (example output observed).

---

## Dependency Graph

```
Phase 0 (snapshots, pre-code)
  └─→ Phase 1 (const + flag reader)
        └─→ Phase 2 (guard + thread-through + tag) ← behavioral change
              ├─→ Phase 3 (high-Df parametric tests)     ─┐
              ├─→ Phase 4 (mid-band non-regression)       │
              ├─→ Phase 5 (Cycle 1 non-regression)        ├─→ Phase 8 (CHANGELOG + docs)
              ├─→ Phase 6 (rollback byte-identity)        │
              └─→ Phase 7 (diagnostic example)           ─┘
```

Phases 3, 4, 5, 6, 7 are **parallelizable** once Phase 2 is complete.

---

## Chained PR Plan (feature-branch-chain, inherited from Cycle 1)

```
main
 └── feature/cc-tunable-high-df-fix  (tracker branch — DRAFT, never merges to main directly)
       └── PR 1: feat(cc-tunable): pre-fix snapshot + USE_HIGH_DF_FIX flag infrastructure
             └── PR 2: feat(cc-tunable): physical-contact guard + adaptive_high_df_floor tag + R26/R27 tests
                   └── PR 3: test(cc-tunable): non-regression + rollback + diagnostic + CHANGELOG
                              ↑ merges into tracker branch; tracker merges to main
```

| PR | Base branch | Phases | Est. lines | Includes |
|----|-------------|--------|------------|---------|
| PR 1 | `feature/cc-tunable-high-df-fix` | Phase 0–1 | ~+185/-0 | Fixtures (3 JSON), fixture generator, `USE_HIGH_DF_FIX_DEFAULT`, `read_high_df_fix_flag()`, flag unit tests |
| PR 2 | PR 1 branch | Phase 2–3 | ~+270/-25 | Guard in `find_feasible_pairs`, param thread-through, `emit_adaptive_merge_entry` override, tag logic, R26/R27/R5 parametric tests, BC sanity tests |
| PR 3 | PR 2 branch | Phase 4–8 | ~+220/-5 | Mid-band sweep, Cycle 1 non-regression (R21/R25), rollback byte-identity (incl. double-rollback), diagnostic example, CHANGELOG, doc-comments |

**Why 3 PRs (not 2, not 4)**: Mirrors Cycle 1 rationale. Phase 0 fixtures (JSON) must precede code changes; Phase 2 behavioral change is compact and reviewable alone (~295 lines); Phases 4–8 are evidence and cleanup that logically accompany each other and keep the "change + proof" story coherent in the final PR. A 2-PR split would put fixtures+guard in one PR (~455 lines, over budget). A 4-PR split would isolate non-regression tests needlessly.

**Diff pollution guard**: PR 2 must show ONLY Phase 2–3 changes against PR 1 branch. PR 3 must show ONLY Phase 4–8 changes against PR 2 branch. If a child PR shows prior-PR changes, retarget/rebase before opening for review.

---

## Open Risks for Apply Phase

1. **Double-rollback interaction (task 6.2)**: When BOTH `USE_HIGH_DF_FIX=false` AND `USE_LOW_DF_FIX=false`, monomer seeds reappear. The apply agent must verify that this row (flag matrix row 1 in design.md §5) produces byte-identical results to pre-Cycle-1 fixtures — NOT to Cycle 1 fixtures. Use `tests/fixtures/pre_low_df_fix/` as ground truth for this case.

2. **`adaptive_high_df_floor` tag scope (task 2.5)**: design.md §3.4 opts for "tag-all-when-flag-on" (simpler approach). Apply agent must implement this exactly: any `AllInfeasible` event with `use_high_df_fix=true` → tag `"adaptive_high_df_floor"`, regardless of whether contact guard or bounding check was the exclusion reason. The existing unit tests in `tests` module (`test_emit_adaptive_merge_entry_correct_fields` at ~line 4346) assert `merge_type == "adaptive"` — these MUST be updated to pass `None` (no override) to preserve their semantics.

3. **`rp_max` fallback for polydisperse (task 2.1)**: use `particles.first().map(|s| s.radius).unwrap_or(rp)` as specified in design §3.2. All clusters have ≥ 1 particle but the fallback is a required safety guard.

4. **Mid-band contingency (task 4.1)**: if Phase 4.1 shows `adaptive_high_df_floor` rate > 10% at Df=2.4 with PC seeds, the contingency from design §4 may need to be activated — a conditional `n1 >= PC_SEED_SIZE && n2 >= PC_SEED_SIZE` exemption. Apply agent must surface this immediately (do not silently widen the tolerance).

5. **`emit_adaptive_merge_entry` existing tests (tasks 2.4)**: 3 existing unit tests at lines ~4336–4376 call `emit_adaptive_merge_entry` directly. After adding `merge_type_override: Option<&str>`, all 3 call sites MUST be updated to pass `None` — or the function signature change will break them. Apply agent must update these in the same commit as task 2.4.

6. **Archive phase canonical-sync warning**: after Cycle 2 ships, the spec `cc-tunable-aggregation` archive must include the R26/R27 additions and the R5/R19 extensions. The archive agent must NOT overwrite the Cycle 1 non-regression references (R21–R25); it must APPEND the Cycle 2 additions as a delta layer.

---

## Per-File Line Delta Summary

| File | Action | Est. +/- |
|------|--------|---------|
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modify | +65/-10 |
| `aglogen_core/engine/tests/cc_tunable_high_df_test.rs` | Create | +390/-0 |
| `aglogen_core/engine/tests/integration_cc_tunable.rs` | Modify | +95/-2 |
| `aglogen_core/engine/tests/fixtures/pre_high_df_fix/*` | Create | +162/-0 (3 JSON + README + generator) |
| `examples/diagnostics/high_df_feasibility_audit.rs` | Create | +90/-0 |
| `CHANGELOG.md` | Modify | +40/-0 |
| `docs/cc-tunable-formula-fix.md` | Modify | +35/-0 |
| **Total** | | **~+877/-12 raw / ~675 net (excl. JSON)** |

> **Note on fixture JSON**: compact JSON for N=100 aggregates is ~25–30 lines per file (vs N=200 in Cycle 1). 3 files ≈ 75–90 lines. Phase 0 can remain under 200 lines, keeping PR 1 well within budget.
