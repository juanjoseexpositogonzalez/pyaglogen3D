# Design: cc-tunable-low-df-fix

> SDD phase: DESIGN · Cycle 1 of 2
> Proposal: `openspec/changes/cc-tunable-low-df-fix/proposal.md`
> Root cause: `openspec/changes/cc-tunable-df-fidelity/explore.md` · Engram #705, #717

---

## Technical Approach

Apply two independent, flag-gated fixes to `tunable_cc.rs`: (a) loosen the bounding-check
threshold from `gamma` to `gamma/2` to match MATLAB, and (b) replace the monomer-only default
seed pool with `floor(N/PC_SEED_SIZE)` PC-generated 4-particle sub-clusters built by a new
`build_pc_seeds` helper using a **separate RNG stream**. Both changes are gated behind a new
`CC_TUNABLE_USE_LOW_DF_FIX` env-var flag (default `true`), orthogonal to `CC_TUNABLE_USE_PHASE3_ALGORITHM`.
No public API or `SimulationResult` fields change.

---

## Architecture Decisions

### Q1 — PC seed builder: new helper (not `run_tunable_internal` reuse)

| Option | Tradeoff | Decision |
|---|---|---|
| Reuse `run_tunable_internal` as-is | Tight coupling: takes `TunableParams`, seeds its own `create_rng(seed)`, returns a full `SimulationResult` including metrics. Extracting just the particle coords requires destructuring a complete result and throws away the RNG stream — violates the separate-stream invariant. | ✗ Rejected |
| Thin wrapper that calls `run_tunable_internal` | Callers would need to construct `TunableParams`, call `run_tunable_internal`, then convert `coordinates`+`radii` back into `TunableCluster`. Allocates full result structs for scratch seeds; awkward type boundary. | ✗ Rejected |
| **New `build_pc_seeds` helper in `tunable_cc.rs`** | Calls the lowest-level PC placement primitives (`place_particle_ballistic`) that are already accessible inside the same file via `super::tunable`. Accepts `(seed_size, rp, sintering, n_total, rng)`, returns `Vec<TunableCluster>`. Self-contained, no cross-module allocation bloat. | ✓ **Chosen** |

`run_tunable_internal` is **not** a clean primitive: it owns its RNG from `create_rng(seed)`,
runs to completion, and emits a `SimulationResult`. Calling it for N/4 seeds would
introduce N/4 independent RNG streams rooted at arbitrary seeds — impossible to make
deterministic without forking the main seed in a documented way. The helper approach
(calling `place_particle_ballistic` from `tunable.rs` directly via `pub(crate)` visibility)
avoids all of this cleanly.

**Justification (≤8 lines):** `run_tunable_internal` cannot return a partial cluster because its
entry point resets a fresh RNG per call. The PC placement logic in `tunable.rs` is already
correct and reusable. Exposing `place_particle_ballistic` as `pub(crate)` and calling it from
`build_pc_seeds` in `tunable_cc.rs` costs ~40 lines, avoids cross-crate allocation, keeps the
helper local to the module that needs it, and respects the separate-stream invariant in
Constraint 4.

### Q2 — Seed size: hardcode as `const PC_SEED_SIZE`

| Option | Tradeoff | Decision |
|---|---|---|
| Expose `seed_size: usize` on `TunableCcParams` | API surface grows; users could set seed_size=1 (=monomers, confusing), requires validation. Out of scope for this fix. | ✗ Rejected |
| **`const PC_SEED_SIZE: usize = 4` in `tunable_cc.rs`** | Matches MATLAB exactly; searchable constant, trivially promoted to a param in a follow-up change if needed. Zero API impact. | ✓ **Chosen** |

### Q3 (LOCKED) — New `CC_TUNABLE_USE_LOW_DF_FIX` flag

Separate flag, read once at simulation start via `read_low_df_fix_flag()` mirroring `read_phase3_flag()`.
Default `true`. Orthogonal to `CC_TUNABLE_USE_PHASE3_ALGORITHM`.

### Q4 (LOCKED) — Box-counting sanity assertion in regression tests

After each low-Df regression run: call `box_counting_3d_morton(&result.coordinates, 18)`,
assert `|BC_Df − Rg_Df| ≤ 0.20`. Tolerance accounts for documented finite-N BC bias (~0.2).

---

## Data Flow

```
run_tunable_cc_internal(params, seed, _py)
        │
        ├─ create_rng(seed)                         ← main RNG stream
        ├─ sample dpo, kf distributions             ← same draws as today
        │
        ├─ read_low_df_fix_flag()                   ← NEW: read once
        │       true  ──→  initialize_seed_clusters  ──→  build_pc_seeds(PC_SEED_SIZE, rp, sin, n, rng_pc)
        │       false ──→  initialize_seed_clusters  ──→  build_monomers(n, params, rng)
        │
        │   where rng_pc = create_rng(seed ^ PC_SEED_RNG_SALT)   ← separate stream
        │
        ├─ spread clusters (rng draws — identical in both paths)
        │
        ├─ read_phase3_flag()                       ← unchanged
        │
        └─ main merge loop
                │
                ├─ find_feasible_pairs
                │       bounding_check_threshold = if use_low_df_fix { required/2.0 } else { required }
                │                                               ↑ NEW local variable, not inline
                │
                └─ select_pair_smart / merge / track rg_evolution  ← identical to today
```

**Flag=false path** is byte-identical to current code: `build_monomers` uses the main `rng`,
the spread draws are the same, `find_feasible_pairs` uses `bounding_sum >= required`
(full gamma), and no new RNG consumers exist in this path.

---

## File Changes

| File | Action | Description |
|---|---|---|
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modify | Add `read_low_df_fix_flag()`, `const PC_SEED_SIZE`, `const PC_SEED_RNG_SALT`, `build_pc_seeds()`, `SeedType::PcSeeds` variant; modify `initialize_seed_clusters` and `find_feasible_pairs` |
| `aglogen_core/engine/src/simulation/tunable.rs` | Modify | Expose `place_particle_ballistic` as `pub(crate)` (currently private) |
| `aglogen_core/engine/tests/cc_tunable_low_df_test.rs` | Create | Parametric sweep + BC sanity assertions |
| `CHANGELOG.md` | Modify | Before/after Df+kf table for `Df_target ∈ {1.4, 1.5, 1.6, 1.7}` |

No changes to `result.rs`, Python bindings, or `SimulationResult` fields.

---

## Interfaces / Contracts

```rust
// tunable_cc.rs — new additions

const USE_LOW_DF_FIX_DEFAULT: bool = true;
const PC_SEED_SIZE: usize = 4;
/// XOR salt that forks the main seed into a separate PC-seed RNG stream.
/// Value chosen to be non-zero and far from the identity. Documented for
/// reproducibility audits.
const PC_SEED_RNG_SALT: u64 = 0x5a7d_3f1e_8b2c_9604;

fn read_low_df_fix_flag() -> bool {
    // mirrors read_phase3_flag() pattern exactly
    match std::env::var("CC_TUNABLE_USE_LOW_DF_FIX") {
        Ok(val) => !matches!(val.to_lowercase().as_str(), "false" | "0" | "no"),
        Err(_) => USE_LOW_DF_FIX_DEFAULT,
    }
}

/// Build floor(n / PC_SEED_SIZE) PC-generated seed clusters of PC_SEED_SIZE particles,
/// plus a leftover cluster (CC or monomer) if n mod PC_SEED_SIZE != 0.
/// Uses a separate RNG stream (rng_pc) so main rng draws are unaffected.
fn build_pc_seeds<R: Rng>(n: usize, rp: f64, sintering: &SinteringDistribution, rng_pc: &mut R)
    -> Vec<TunableCluster>;

// tunable.rs — visibility change only (no logic change)
pub(crate) fn place_particle_ballistic<R: Rng>(
    existing: &[Sphere],
    rng: &mut R,
    radius: f64,
    sintering: &SinteringDistribution,
) -> Option<Vector3>;
```

**`initialize_seed_clusters` modification (pseudocode):**
```
fn initialize_seed_clusters(params, rng, seed, use_low_df_fix) -> Vec<TunableCluster>:
    if use_low_df_fix AND params.seed_type == Monomers:
        rng_pc = create_rng(seed ^ PC_SEED_RNG_SALT)
        return build_pc_seeds(params.n_particles, rp, sintering, &mut rng_pc)
    else:
        // existing branches unchanged (Monomers / Dimers / Trimers / Custom)
```

**`find_feasible_pairs` modification (pseudocode):**
```
let bounding_threshold = if use_low_df_fix { required * 0.5 } else { required };
if bounding_sum >= bounding_threshold { ... }
```

The `use_low_df_fix` bool is passed down from `run_tunable_cc_internal` where it's read once.

---

## Testing Strategy

| Layer | Test function | What | Assertion |
|---|---|---|---|
| Integration | `low_df_parametric_sweep` | `Df_target ∈ {1.4,1.5,1.6,1.7}`, N=300, 3 seeds each | `mean(Df)/target ∈ [0.90, 1.10]`; no `kf < 1.0` |
| Integration | `low_df_bc_sanity` | Same runs, BC cross-check | `|BC_Df − Rg_Df| ≤ 0.20` for each seed |
| Integration | `non_regression_r21` | `Df_target ∈ {1.8,2.0,2.2}`, N=300, 3 seeds | Df within ±5% (existing R21 tolerance) |
| Integration | `rollback_flag_false_monomers` | Set `CC_TUNABLE_USE_LOW_DF_FIX=false`, run `Df=1.6` | Produces monomer pool, Df≈2.03 (old behavior) |
| Integration | `rollback_same_rng_monomer_path` | Flag=false: same seed → same `fractal_dimension` as pre-patch | Byte-identical result |
| Unit | `build_pc_seeds_count` | n=100, PC_SEED_SIZE=4 | Returns 25 clusters of 4 particles each |
| Unit | `build_pc_seeds_connectivity` | Each returned cluster | Each cluster has no disconnected particle |
| Unit | `low_df_fix_flag_env_var` | Set/unset `CC_TUNABLE_USE_LOW_DF_FIX` | `read_low_df_fix_flag()` returns correct bool |

All new tests live in `aglogen_core/engine/tests/cc_tunable_low_df_test.rs`.

---

## Performance Considerations

**PC seed build cost:** `build_pc_seeds` calls `place_particle_ballistic` for particles 2..4 of
each seed cluster. For N=300: 75 seeds × 3 ballistic placements = 225 O(k) sphere-intersection
checks where k ≤ 4. This is negligible relative to the main CC loop (N−75 = 225 merges, each
O(k²) with k up to N/2). Estimated overhead: <1% of wall time. Profile once during apply if N
≥ 2000 to confirm.

**Bounding-check change cost:** `find_feasible_pairs` loops O(k²) pairs and the threshold
change is a single multiply-by-0.5 per candidate. No measurable overhead.

---

## Rollback Rehearsal

Setting `CC_TUNABLE_USE_LOW_DF_FIX=false` at runtime (or removing it from the container env):

1. `read_low_df_fix_flag()` returns `false`.
2. `initialize_seed_clusters` skips `build_pc_seeds`; falls through to existing `build_monomers` / `Dimers` / `Trimers` branches — **same code path as today**.
3. The `rng_pc` stream is never created; **main RNG state is untouched**.
4. `find_feasible_pairs` uses `bounding_sum >= required` (full gamma) — **same as today**.
5. For a given `seed`, the sequence of RNG draws in the main loop is **byte-identical** to the pre-patch run.

Result: all `SimulationResult` fields, including `fractal_dimension`, `prefactor`, `coordinates`,
and `radii`, are numerically identical to any pre-patch run at the same `seed`.

---

## Migration / Rollout

- No DB migration. Old stored results (`fractal_dimension`, `kf`) remain valid (they are labeled
  as produced by the old algorithm; the fix is for new runs only).
- Deploy with `CC_TUNABLE_USE_LOW_DF_FIX=true` (default). Canary on low-Df jobs first.
- CHANGELOG must contain before/after table before merge.

---

## Open Questions

None. Q1–Q4 are resolved above. Design is unblocked for tasks phase.
