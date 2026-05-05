# Design: Sintering CC Fix (Cycle 11 / PYA-11)

## Technical Approach

One-line fix with ripple: inject `sintering_coeff` into `calculate_com_distance` so the
fractal-law CoM distance uses `rp_eff = rp · sintering_coeff` instead of bare `rp`.
This aligns the formula's assumed contact distance with the sintered contact distance
used by `has_intercluster_contact` and `check_overlap`, eliminating the geometric
impossibility that causes 100% ballistic fallback → single-monomer output.

Backward-compatible by construction: `rp_eff = rp · 1.0 = rp`.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|----------|--------|----------------------|-----------|
| Where to apply sintering | Inside formula (`rp_eff = rp·coeff`) | Post-formula scaling of `d`; post-processing compaction (Camino C) | Preserves formula structure; `rp²` factor appears once; mathematically identical at coeff=1.0 |
| Target Df interpretation | Df of the sintered shape | Df of the unsintered skeleton | Matches experimental convention (measured Df includes sintering); consistent with contact-distance model |
| Per-merge vs. per-simulation coeff | Per-merge (sampled, existing pattern) | Fixed per-simulation | `SinteringDistribution` already samples per-merge at L863; formula just needs the same sample value |

## Data Flow

```
Backend (sintering_config)
    │
    ▼
Python binding (parse_sintering → SinteringDistribution)
    │
    ▼
TunableCcParams.sintering ──▶ run_tunable_cc_internal
    │
    ├── per merge step: sintering_coeff = params.sintering.sample(rng)   [L863]
    │
    ├──▶ calculate_com_distance(n1, n2, rp, df, kf, sintering_coeff)     [L888] ◄── THE FIX
    │        └── rp_eff = rp * sintering_coeff
    │        └── d² uses rp_eff² (not rp²)
    │
    ├──▶ position_clusters_for_contact(..., sintering_coeff)             [L921] ✓ already correct
    ├──▶ has_intercluster_contact(..., sintering_coeff)                  [L932] ✓ already correct
    ├──▶ check_overlap(..., sintering_coeff)                             [L935] ✓ already correct
    └──▶ merge_ballistic(..., sintering_coeff)                           [L999] ✓ already correct
```

Key insight from code reading: **every** sintering-sensitive function EXCEPT
`calculate_com_distance` already receives and uses `sintering_coeff`. The fix is
adding it to the one remaining function.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modify | Add `sintering_coeff: f64` param to `calculate_com_distance`; use `rp_eff = rp * sintering_coeff`; update call site at L888 |
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | Modify | Update `select_contact_particles` to use sintered contact dist (L512: `p1.radius + p2.radius` → `sintered_contact_distance(...)`) |
| `aglogen_core/engine/tests/integration_cc_tunable.rs` | Modify | Add sintered convergence integration test (R9 scenario 9.1) |

**No changes needed:**
- Backend (`tasks.py`): sintering_coeff already plumbed via `parse_sintering` → `SinteringDistribution` → `TunableCcParams.sintering`. Verified at L1282-1303.
- Python binding (`lib.rs`): sintering already parsed and set on params at L1204-1236. No signature change.
- Frontend: sintering UI control pre-exists. No changes.
- DB migration: `sintering_config` JSONField already exists on `Simulation` model (L140). No migration.
- Ballistic fallback (`merge_ballistic`): already uses `sintered_contact_distance` at L676 and L696. ✓

## Interfaces / Contracts

### `calculate_com_distance` — new signature

```rust
fn calculate_com_distance(
    n_po1: usize,
    n_po2: usize,
    rp: f64,
    df: f64,
    kf: f64,
    sintering_coeff: f64,  // NEW — 1.0 = no sintering
) -> Option<f64> {
    let rp_eff = rp * sintering_coeff;
    // ... rest identical but uses rp_eff where rp appeared
}
```

### `select_contact_particles` — sintered contact distance

```rust
// L512: change bare contact_dist to sintered
let contact_dist = sintered_contact_distance(p1.radius, p2.radius, sintering_coeff);
```

This function must also accept `sintering_coeff: f64`. The call site at L913 already
has `sintering_coeff` in scope (from the merge loop).

## Mathematical Justification

The formula derives `d²` from the parallel-axis theorem + power-law `N = kf·(Rg/rp)^Df`:

```
d² = (n·rp²)/(n1·n2) · [n·(n/kf)^(2/Df) − n1·(n1/kf)^(2/Df) − n2·(n2/kf)^(2/Df)]
```

Substituting `rp_eff = rp·c` (where c = sintering_coeff):

```
d² = (n·rp_eff²)/(n1·n2) · [same bracket]
   = c² · (n·rp²)/(n1·n2) · [same bracket]
   = c² · d²_unsintered
```

So `d_sintered = c · d_unsintered`. This is the correct scaling: sintered contact
reduces CoM distance by factor `c`, matching the `sintered_contact_distance = c·(r1+r2)`
used everywhere else. At `c=1.0`, `d_sintered = d_unsintered` (identity).

The bracket `[n·(n/kf)^e − n1·(n1/kf)^e − n2·(n2/kf)^e]` is independent of `rp`,
so introducing `rp_eff` only affects the leading `rp²` factor. Structure preserved.

## Backwards Compatibility Matrix

| Layer | Old behavior (coeff=1.0) | New behavior (coeff=1.0) | New behavior (coeff<1.0) |
|-------|--------------------------|--------------------------|--------------------------|
| Formula `d²` | `n·rp²/(n1·n2)·[...]` | IDENTICAL (`rp_eff=rp`) | `n·(rp·c)²/(n1·n2)·[...]` |
| Contact check | `sintered_contact_distance` at coeff=1.0 | unchanged | unchanged |
| Ballistic fallback | uses sintered dist | unchanged | unchanged |
| Python binding | no sintering_coeff needed | unchanged (already defaults to 1.0) | already supported |
| DB records | `sintering_config` absent → 1.0 | unchanged | unchanged |
| Old sims re-run | same output | same output | now produces correct aggregate (was broken) |

## Migration Strategy

No DB migration needed. `sintering_config` JSONField already exists on `Simulation` model.
Absent `sintering_coeff` defaults to 1.0 at every layer (engine default, Python binding
default, backend `params.get("sintering_coeff", 1.0)` at L1283).

## Testing Strategy

| Layer | What | Approach | Priority |
|-------|------|----------|----------|
| Engine unit | coeff=1.0 regression: snapshot d² value for (n1=5,n2=3,Df=1.8,kf=1.3,rp=1.0) | Assert identical to pre-change value (compute once, hardcode) | P1 |
| Engine unit | coeff=0.9 scaling: d_sintered = 0.9 · d_unsintered | Compute both, assert ratio = 0.9 ± 1e-10 | P1 |
| Engine unit | coeff=0.5 extreme: d > 0 for well-posed inputs | Assert `Some(d)` where d > 0 | P1 |
| Engine unit | coeff=0.0 degenerate: returns None | Assert `None` | P1 |
| Engine unit | `select_contact_particles` uses sintered dist | Verify function signature accepts sintering_coeff | P1 |
| Engine integration | Full sim: sintering=0.9, Df=2.0, kf=1.0, N=350, 5 seeds | Assert N=350 particles, mean Df ∈ [1.90,2.10], mean kf ∈ [0.90,1.10] | P4 |
| Engine integration | Ballistic fallback sintering: Df=3.0, coeff=0.8 | All contacts ≤ 2·rp·0.8 + ε | P2 |
| Backend | sintering_coeff plumbed end-to-end | Existing tests + trace verification (no new test needed) | P3 |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Regression at coeff=1.0 | Low | P1 snapshot regression test asserts exact d² value |
| `select_contact_particles` bare contact distance | Medium | Fix in same PR — uses `sintered_contact_distance` instead of `p1.radius + p2.radius` |
| Other algorithms with sintering issues | N/A | Explicitly out of scope; documented in proposal |
| Performance | Negligible | One extra multiply per merge step |

## Open Questions

None — all decisions locked from exploration/proposal phase.
