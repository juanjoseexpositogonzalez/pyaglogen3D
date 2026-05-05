# PYA-11 Bug 3 Deep-Dive: Why Sintering Still Collapses to 1 Monomer

**Date**: 2026-05-05
**Change**: sintering-cc-fix (PYA-11), Phase 2 — post P1+P2 commits
**Status**: Root cause identified. Fix scoped.

## Root Cause: `merge_ballistic` Step Size Skips Sintered Contact Window

The march step in `merge_ballistic` (line 670–675) is `min_radius * 0.5 = 0.5` for
monodisperse particles with `rp = 1.0`. The sintered snap window is
`[contact_dist * 0.9, contact_dist * 1.01]`.

For `sintering_coeff = 0.9`:
- `contact_dist = 0.9 * (1.0 + 1.0) = 1.8`
- snap window: `[1.62, 1.818]` — width `0.198`
- launch_dist = `1.0 + 1.0 * 3.0 = 4.0`
- step grid from launch: `4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0, ...`
- **NO step lands inside [1.62, 1.818]** → snap never triggers → merge never succeeds

For `coeff = 1.0`:
- `contact_dist = 2.0`, snap window `[1.8, 2.02]`
- step grid hits `2.0` exactly → snap triggers → merge succeeds

This is deterministic, not probabilistic. **Ballistic ALWAYS fails for any monomer
pair with `sintering_coeff < 1.0`** (verified: 0/200 successes at coeff=0.9 vs
200/200 at coeff=1.0 across random directions).

## Why Tunable Also Fails (Monomer-Monomer)

The tunable path places CoMs at `required_distance` apart. For monomers,
particle center = cluster CoM, so the inter-particle distance equals
`required_distance`. With `df=1.8, kf=1.4, coeff=0.9`:

- `required_distance ≈ 1.628`
- `sintered_contact_dist = 1.8`
- `1.628 < 1.8` → particles overlap by sintered criterion
- `check_overlap` returns `true` → merge rejected

For `df=2.0, kf=1.0`: `required_distance = contact_dist = 1.8` (equal) → no
overlap → tunable succeeds. This explains why `test_ballistic_fallback_sintered_contacts`
passes — its params allow tunable merges for the first few monomer pairs.

## All Contact-Distance Call Sites in `tunable_cc.rs`

| Line | Function | Uses sintered? | Notes |
|------|----------|----------------|-------|
| 332 | `calculate_com_distance` | ✅ `rp_eff = rp * sintering_coeff` | P1 fix — correct |
| 389–392 | `check_overlap` (bounding) | ✅ `sintered_contact_distance` | Correct |
| 402 | `check_overlap` (particle) | ✅ `sintered_contact_distance` | Correct |
| 431–434 | `has_intercluster_contact` (bounding) | ✅ `sintered_contact_distance` | Correct |
| 444 | `has_intercluster_contact` (particle) | ✅ `sintered_contact_distance` | Correct |
| 528 | `select_contact_particles` | ✅ `sintered_contact_distance` | P2 fix — correct |
| 572 | `position_clusters_for_contact` | ✅ `sintered_contact_distance` | Correct |
| 688 | `merge_ballistic` (snap) | ✅ `sintered_contact_distance` | Correct formula, **but step size skips the window** |
| 690 | `merge_ballistic` (snap window) | ⚠️ Window `[0.9×cd, 1.01×cd]` | Too narrow for step=0.5 |
| 777 | `build_dimers` | ❌ Uses `2.0 * rp` (bare) | Correct — seeds shouldn't be sintered |
| 809–810 | `build_trimers` | ❌ Uses `2.0 * rp`, `4.0 * rp` | Same — correct for seeds |

## End-to-End Trace (N=10, sintering=0.9, seed=42)

1. **Initialization**: 10 monomer clusters, spread ≤10.77 units from origin.
2. **Main loop** runs 10,000 iterations (all of them):
   - Each iteration: 101 tunable attempts (retries 0–100), all fail because
     `required_distance(1.628) < sintered_contact_dist(1.8)` → overlap.
   - Ballistic fallback: tries 100 random directions, all fail because
     step=0.5 never lands in snap window [1.62, 1.818].
   - **Zero merges succeed**.
3. **Result extraction**: `clusters.remove(0)` returns first cluster (1 monomer).
4. `result.coordinates.len() == 1`.

## Recommended Fix

**Location**: `merge_ballistic`, line 670–675.

**Fix**: Reduce step size to at most `min(snap_window_width * 0.5, current_step)`:
```rust
let contact_dist_min = sintered_contact_distance(
    /* smallest radius in cluster2 */,
    /* smallest radius in cluster1 */,
    sintering_coeff,
);
let snap_width = contact_dist_min * 0.11; // 1.01 - 0.9
let step = (min_radius * 0.5).min(snap_width * 0.5);
```

Or more robustly, change the snap detection from exact-step-landing to
continuous-interval checking: instead of testing the current distance,
test whether the snap window was crossed during this step (i.e., check
`prev_dist >= lower_bound && curr_dist <= upper_bound`).

**Scope**: ~10 lines changed in `merge_ballistic` only.
**Files**: `aglogen_core/engine/src/simulation/tunable_cc.rs`

**Secondary consideration**: The tunable path's monomer-monomer overlap
issue is a separate (pre-existing) problem that exists even at coeff=1.0.
It works at coeff=1.0 only because ballistic fallback catches it. The
mathematical reason is that `required_distance < contact_distance` for
monomer pairs with most df/kf combinations. This is acceptable — the
thesis expects ballistic fallback for degenerate geometries.

## Verification Plan

1. **Unit test**: `merge_ballistic` with two monomers at `sintering_coeff=0.9` → must return `true`.
2. **E2E test**: The stashed `test_sintering_e2e_smoke_moderate_df` (N=10, df=1.8, kf=1.4, sintering=0.9) → must produce 10 particles.
3. **Regression**: All existing tests must still pass (including `test_ballistic_fallback_sintered_contacts`).
4. **Sweep**: Run the monomer ballistic test across coeff ∈ {0.5, 0.6, 0.7, 0.8, 0.9, 0.95} → all must succeed.
