# Design: cc-tunable-high-df-fix

> SDD phase: DESIGN · Cycle 2 of 2
> Proposal: `openspec/changes/cc-tunable-high-df-fix/proposal.md`
> Root cause: `openspec/changes/cc-tunable-df-fidelity/explore.md` §4.B · Engram #754
> Cycle 1 reference: `openspec/changes/archive/cc-tunable-low-df-fix-2026-05-29/design.md`

---

## 1. Decision Summary (LOCKED)

| Decision | Choice | Rationale |
|---|---|---|
| Root cause | **H_B2**: `calculate_com_distance` returns `Some(d)` when `d < 2·rp`, passing the bounding check but making every placement attempt fail | explore.md §4.B lines 263–267; H_B1 retracted (line 250), H_B3 deferred |
| Guard scope | **Unconditional** — fires for all Df bands | Geometric impossibility can occur at any Df with specific n1/n2 splits; unconditional is additive (extra AND clause), never removes a geometrically valid pair |
| `rp_max` definition | **Per-particle** `max(rp_i, rp_j)` | MATLAB-aligned; no cluster bounding radius ambiguity |
| Adaptive tag | **`"adaptive_high_df_floor"`** (distinct from `"adaptive"`) | Enables precise audit separation of floor-triggered vs bounding-triggered fallbacks |
| BC cross-check | **Yes** for high-Df band | Defense-in-depth mirroring Cycle 1 R25; adds test runtime but confirms Rg-Df vs BC-Df within ±0.20 |
| Capability modified | `cc-tunable-aggregation` (R26, R27, extended R5/R19) | No new capability; no API surface change |

---

## 2. Architecture Overview

### `find_feasible_pairs` today (Cycle 1 state)

```
for each pair (i, j):
  d_required = calculate_com_distance(n1, n2, rp, df, kf, sint)
    → returns Some(d) if d² > 0           ← does NOT check d < 2·rp
    → returns None  if d² ≤ 0 or NaN      ← skipped (degenerate)

  [Cycle 1] bounding_sum >= d_required * 0.5  ?
    YES → push to feasible pool
    NO  → skip

if feasible pool empty → AllInfeasible → march_inward_merge → "adaptive" tag
```

**Bug path for high-Df**: `d_required < 2·rp_max` (geometrically impossible: two spheres
cannot touch at that COM distance without overlapping). The pair passes bounding check
(`bounding_sum >= d_required * 0.5` is trivially satisfied for small `d_required`).
Every placement attempt in the retry loop fails (`position_clusters_for_contact` /
`has_intercluster_contact` cannot be satisfied). Retries exhaust → `march_inward_merge`
→ lands at `d = 2·rp` (ballistic contact) → `"adaptive"` or `"ballistic"` tag.
Repeated at every late-stage merge, measured Df caps at ballistic Df ≈ 2.0–2.4.

### `find_feasible_pairs` after Cycle 2

```
for each pair (i, j):
  d_required = calculate_com_distance(n1, n2, rp, df, kf, sint)
    → None  → skip (degenerate)
    → Some(d) → continue

  [NEW] rp_max = max(rp_i, rp_j)         ← per-particle, not cluster bounding radius
  [NEW] d_required >= 2 · rp_max ?
    NO  → SKIP (physical-contact guard — geometrically impossible)
    YES → continue to bounding check

  [Cycle 1] bounding_sum >= d_required * 0.5 ?
    YES → push to feasible pool
    NO  → skip

if feasible pool empty (all pairs failed guard or bounding):
  → adaptive fallback engages with tag "adaptive_high_df_floor"
  → actual_distance = 2 · rp_max  (physical floor)
```

**Slot**: the physical-contact guard is inserted **after** `calculate_com_distance` returns
`Some(d)` and **before** the Cycle 1 `gamma/2` bounding check. This is purely additive:
it cannot weaken Cycle 1 because it only removes pairs that would have exhausted retries
anyway.

### Adaptive-fallback path change

When `find_feasible_pairs` returns an empty pool (new: because ALL pairs fail the guard),
the `AllInfeasible` branch in `run_tunable_cc_internal` (line ~1290) calls
`march_inward_merge`. The resulting `MergeTraceEntry` is emitted with
`merge_type: "adaptive_high_df_floor"` instead of `"adaptive"`.

`emit_adaptive_merge_entry` is the current emitter (line ~2189). The Cycle 2 change
introduces a parallel `emit_adaptive_high_df_floor_entry` (or adds a tag parameter — see
§3 below for the chosen approach).

---

## 3. Code-Level Design

### 3.1 New constant and flag reader

```rust
// tunable_cc.rs — new additions (mirror of Cycle 1 pattern exactly)

/// Feature flag for the high-Df fix.
///
/// Default: `true` (fix active — physical-contact guard in `find_feasible_pairs`).
/// Set env var `CC_TUNABLE_USE_HIGH_DF_FIX=false` to revert to Cycle 1-only behavior.
/// Orthogonal to `CC_TUNABLE_USE_LOW_DF_FIX` and `CC_TUNABLE_USE_PHASE3_ALGORITHM`.
/// Parsed once at simulation start, NOT at compile time (R3.9 invariant).
const USE_HIGH_DF_FIX_DEFAULT: bool = true;

fn read_high_df_fix_flag() -> bool {
    match std::env::var("CC_TUNABLE_USE_HIGH_DF_FIX") {
        Ok(val) => !matches!(val.to_lowercase().as_str(), "false" | "0" | "no"),
        Err(_) => USE_HIGH_DF_FIX_DEFAULT,
    }
}
```

Add `USE_HIGH_DF_FIX_DEFAULT` to the **SALT REGISTRY comment block** (lines 81–87) as a
flag registry entry (it doesn't need a salt, but the registry pattern must be followed for
discoverability).

### 3.2 `find_feasible_pairs` — signature and guard

**No signature change.** Add `use_high_df_fix: bool` as a new parameter (parallel to the
existing `use_low_df_fix: bool`). The caller passes it from `run_tunable_cc_internal`
where it is read once via `read_high_df_fix_flag()`.

```rust
pub(crate) fn find_feasible_pairs(
    clusters: &[TunableCluster],
    target_df: f64,
    target_kf: f64,
    rp: f64,
    sintering_coeff: f64,
    use_low_df_fix: bool,
    use_high_df_fix: bool,   // NEW — physical-contact guard
) -> Vec<PairCandidate> {
    let bounding_threshold_factor: f64 = if use_low_df_fix { 0.5 } else { 1.0 };

    for i in 0..k {
        for j in (i + 1)..k {
            let required = match calculate_com_distance(...) {
                Some(d) => d,
                None => continue,
            };

            // NEW: physical-contact guard (Cycle 2, R27)
            if use_high_df_fix {
                let rp_i = clusters[i].particles.first().map(|s| s.radius).unwrap_or(rp);
                let rp_j = clusters[j].particles.first().map(|s| s.radius).unwrap_or(rp);
                let rp_max = rp_i.max(rp_j);
                if required < 2.0 * rp_max {
                    continue; // geometrically impossible — skip
                }
            }

            // Cycle 1: bounding check (unchanged)
            if bounding_sum >= required * bounding_threshold_factor {
                feasible.push(...);
            }
        }
    }
}
```

**`rp_max` rationale**: For monodisperse runs (the typical case), all `particle.radius == rp`,
so `rp_max = rp`. For polydisperse runs, the per-particle max correctly identifies the
minimum physical COM distance for that specific pair. The `particles.first()` fallback to `rp`
is a safety guard only — all clusters have ≥ 1 particle.

### 3.3 `select_pair_smart` — thread-through

`select_pair_smart` calls `find_feasible_pairs`. Add `use_high_df_fix: bool` to its
signature and thread it through. Same pattern as the existing `use_low_df_fix` thread.

### 3.4 New `merge_type` tag `"adaptive_high_df_floor"`

When `AllInfeasible` fires AND `use_high_df_fix = true`, the adaptive-fallback entry is
tagged distinctly. The cleanest approach (no new emitter function, no new enum): pass a
`merge_type_override: Option<&str>` to `emit_adaptive_merge_entry`, defaulting to
`"adaptive"`. When the high-Df guard is the reason for `AllInfeasible`, pass
`Some("adaptive_high_df_floor")`.

```rust
// Pseudocode inside the AllInfeasible branch:
let tag = if use_high_df_fix && all_pairs_failed_contact_guard {
    "adaptive_high_df_floor"
} else {
    "adaptive"
};
// emit entry with tag
```

**Detecting "all pairs failed contact guard"**: `find_feasible_pairs` currently returns a
`Vec<PairCandidate>` (empty = infeasible). To distinguish "empty because bounding" from
"empty because contact guard", add a lightweight `PhysicalContactFailCount` counter to
`find_feasible_pairs` return value — OR simply tag all `AllInfeasible` events as
`"adaptive_high_df_floor"` when `use_high_df_fix = true`. Given that at high Df the guard
is the dominant cause, the simpler approach (tag-all-when-flag-on) is acceptable and maps
cleanly to the diagnostic example in §6.

**Decision (tasks-to-refine)**: tag all `AllInfeasible` entries as
`"adaptive_high_df_floor"` when `use_high_df_fix = true`. This is conservative and
unambiguous. Tasks phase confirms.

### 3.5 `actual_distance` in the floor fallback

`march_inward_merge` returns the actual COM distance it achieved. For the physical-contact
floor case, this will be ≈ `2·rp_max` (the minimum achievable contact). The trace entry
`actual_distance` is correct-by-construction — no special handling needed.

---

## 4. Mid-Band Impact Analysis

For monomer pairs (n1=n2=1), `Df=2.0`, `kf=1.3`:
`d² = 2·rp²·[2·(2/1.3)^1.0 - 2·(1/1.3)^1.0] = 2·rp²·[3.077 - 1.538] = 3.077·rp²`
→ `d ≈ 1.754·rp < 2·rp`. Guard fires.

This means the guard fires for monomer pairs at Df ≤ ~2.4 in the mid-band. However:

1. **Cycle 1 shipped PC seeds**: the pool starts with 4-particle clusters, not monomers.
   The smallest pairs in the pool have `n_min = 4`, where `d ≥ 2·rp` holds for Df ≤ 2.9.
2. For 4-particle symmetric merge (`n1=n2=4`, `Df=2.0`, `kf=1.3`): `d ≈ 4.8·rp > 2·rp`.
   Guard does NOT fire.
3. For all typical late-stage merges in the mid-band (n ≥ 4), `d_required > 2·rp_max` holds.

**Conclusion**: the guard is safe for the mid-band **given PC seeds are active** (Cycle 1's
`use_low_df_fix = true`). The remaining risk is the interaction when `use_low_df_fix = false`
(monomer seeds + high-Df guard). Spec for flag-false path: guard fires for early monomer
merges at Df ≤ 2.4, sending them to `adaptive_high_df_floor`. This is acceptable because the
flag-false path already produced incorrect Df; the guard makes it no worse and adds correct
fallback behavior.

**Mid-band regression sweep** (`Df ∈ {1.8, 2.0, 2.2, 2.4}`) is REQUIRED before merge and
will empirically confirm no pool shrinkage when PC seeds are active.

**Contingency** (NOT added now — flag for tasks): if the mid-band sweep shows > 5%
degradation at Df=2.4 with PC seeds, tasks phase can introduce a
`use_high_df_fix && required < 2.0 * rp_max && n1 >= PC_SEED_SIZE && n2 >= PC_SEED_SIZE`
conditional that exempts tiny merges — but the current analysis predicts this is unnecessary.

---

## 5. Flag Matrix (2³ = 8 rows)

| `USE_LOW_DF_FIX` | `USE_HIGH_DF_FIX` | `USE_PHASE3_ALGORITHM` | Behavior |
|:---:|:---:|:---:|---|
| F | F | F | Phase 2: random pair, full gamma, monomers, no guards. Pre-Cycle 1 baseline. |
| F | F | T | Phase 3: smart pair, full gamma, monomers, no guards. Pre-Cycle 1 with Phase 3. |
| T | F | F | Cycle 1 fixes (PC seeds + gamma/2) but Phase 2 pair selection. |
| T | F | T | **Cycle 1 production default**: PC seeds, gamma/2, Phase 3 smart pair. R22–R25 pass. |
| F | T | F | Phase 2 + contact guard only. Guard fires on monomers at Df<2.4; adaptive floor. |
| F | T | T | Phase 3 + contact guard, monomer seeds, gamma. High-Df guard active but mid-band may regress (no PC seeds). |
| T | T | F | Cycle 1 + Cycle 2 fixes, Phase 2 pair selection. |
| T | T | T | **Cycle 2 production default**: PC seeds, gamma/2, Phase 3, contact guard. Full fix. |

Rollback: set `CC_TUNABLE_USE_HIGH_DF_FIX=false` → row 4 (Cycle 1 production). Byte-identical
for any given seed (guard is additive only; removing it restores prior RNG path).

---

## 6. Test Design (outline only — tests written in tasks/apply)

### R26/R27 — High-Df parametric sweep
- `Df_target ∈ {2.5, 2.7, 2.9}`, seeds `∈ {1, 2, 3}`, `N ∈ {100, 500}` (unit), `N=2000` (nightly)
- Assert: `|mean(Df_measured) − Df_target| ≤ 0.15`, `mean(kf) ≥ 1.0`
- File: `aglogen_core/engine/tests/cc_tunable_high_df_test.rs`

### R28 — High-Df BC cross-check (R25 style)
- Same sweep runs → call `box_counting_3d_morton` → assert `|BC_Df − Rg_Df| ≤ 0.20`
- Defense-in-depth; catches Rg-estimator drift independent of geometry fix

### R21, R25 — Cycle 1 non-regression
- Re-run existing fixtures with `USE_HIGH_DF_FIX=true` (new default)
- Assert byte-identical for R24 (rollback identity) and tolerance-pass for R21/R25

### Mid-band non-regression
- `Df_target ∈ {1.8, 2.0, 2.2, 2.4}`, seeds `∈ {1, 2, 3}`, `N=300`
- Assert within existing Cycle 1 tolerances (R21: ±5%)

### Rollback byte-identity
- `CC_TUNABLE_USE_HIGH_DF_FIX=false` with 3 fixture configs → same `fractal_dimension`,
  `prefactor`, `coordinates`, `radii` as Cycle 1 baseline (strict bit-equality for scalars,
  1 ULP for vector fields per Cycle 1 R24 precedent)

---

## 7. Diagnostic Example (outline)

**`examples/diagnostics/high_df_feasibility_audit.rs`**

Runs two simulations for each `Df_target ∈ {2.7, 2.9}`, `N=100`, seed=42:
- **Before** (`USE_HIGH_DF_FIX=false`): counts pairs where `calculate_com_distance` returns
  `Some(d)` with `d < 2·rp_max` per merge step; counts ballistic/adaptive merges.
- **After** (`USE_HIGH_DF_FIX=true`): counts pairs filtered by contact guard; counts
  `adaptive_high_df_floor` entries; shows final Df.

Expected output pattern:
```
[BEFORE] step 450: 12 pairs returned Some(d), 11 failed contact (d < 2*rp). → ballistic
[AFTER]  step 450: 12 pairs returned Some(d), 11 filtered by guard. → adaptive_high_df_floor at d=2.0*rp
[BEFORE] mean Df = 2.38  [AFTER] mean Df = 2.71
```

---

## 8. Risks

| Risk | Disposition |
|---|---|
| Mid-band degradation when PC seeds active | **Analyzed**: guard does not fire for n≥4 pairs at Df≤2.4. Empirical confirmation required (mid-band sweep in tests). |
| Tag ambiguity (`"adaptive"` vs `"adaptive_high_df_floor"`) | **Resolved here**: tag-all-when-flag-on approach. Task phase confirms if finer discrimination needed. |
| H_B2 alone insufficient for Df=2.9 (residual H_B3 bias) | **Deferred**: success criterion uses ±0.15; if mean Df < 2.6 for target 2.9, escalate to `cc-tunable-estimator-overhaul`. |
| `rp_max` for polydisperse runs | **Resolved**: per-particle `max(rp_i, rp_j)` is correct and implemented via `particles.first()`. Tasks phase verifies. |
| Rollback path changes RNG draws | **No**: guard is in `find_feasible_pairs` (read-only decision). No new RNG consumers. Flag-false path is byte-identical to Cycle 1. |
| `select_pair_smart` signature ABI | **Internal (`pub(crate)`)**: no external callers. Signature change is safe. |

---

## 9. File Changes

| File | Action | Description |
|---|---|---|
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modify | Add `USE_HIGH_DF_FIX_DEFAULT`, `read_high_df_fix_flag()`, contact guard in `find_feasible_pairs`, `use_high_df_fix` param thread-through, `"adaptive_high_df_floor"` tag |
| `aglogen_core/engine/tests/cc_tunable_high_df_test.rs` | Create | Parametric sweep R26/R27, BC cross-check R28, Cycle 1 non-regression, rollback byte-identity |
| `examples/diagnostics/high_df_feasibility_audit.rs` | Create | Before/after counter for pairs failing contact guard per merge step |
| `CHANGELOG.md` | Modify | Before/after Df+kf table for `Df_target ∈ {2.5, 2.7, 2.9}` |

No changes to `metrics.rs`, `result.rs`, Python bindings, or `SimulationResult` fields.

---

## 10. Open Questions

None. All preflight decisions are locked. Design is unblocked for tasks phase.

---

## References

- Proposal: `openspec/changes/cc-tunable-high-df-fix/proposal.md`
- Exploration: `openspec/changes/cc-tunable-df-fidelity/explore.md` §4.B, §7
- Cycle 1 design: `openspec/changes/archive/cc-tunable-low-df-fix-2026-05-29/design.md`
- Engram #754 (proposal), #717 (Cycle 1 proposal), #748 (Cycle 1 archive)
