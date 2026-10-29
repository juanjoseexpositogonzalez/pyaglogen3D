# Exploration: PYA-15 — Parametric Values (dpo & target_kf distributions)

**Date**: 2026-05-06  
**Status**: Complete — code familiarization only (READ-ONLY)

---

## 1. Map of dpo (`radius_min`/`radius_max`) and `target_kf` Usage

### 1.1 Engine — `target_kf`

| Location | Usage |
|----------|-------|
| `tunable_cc.rs:75` | `TunableCcParams.target_kf: f64` — struct field |
| `tunable_cc.rs:99` | Default value `1.3` |
| `tunable_cc.rs:869` | `let kf = params.target_kf;` — extracted in `run_tunable_cc_internal` |
| `tunable_cc.rs:930` | Passed to `calculate_com_distance(n_po1, n_po2, rp, df, kf, sintering_coeff)` |
| `tunable.rs:30-31` | `TunableParams` also has `target_kf` (Tunable PC — same pattern) |

**Consumers**: `calculate_com_distance` at `:324` is the SOLE consumer of `kf` in the physics. It's called once per merge attempt (line 930). The value is read once from params at line 869 and reused for all merges. **Sampling point**: replace `let kf = params.target_kf;` with `let kf = params.target_kf_distribution.sample(&mut rng);` (sample once at sim start per locked decision #4).

### 1.2 Engine — `radius_min` / `radius_max` (dpo proxy)

**All algorithms that have `radius_min`/`radius_max` fields**:

| Algorithm | File:line | Notes |
|-----------|-----------|-------|
| DLA | `dla.rs:24-25` | `DlaParams.radius_min/max` |
| Ballistic | `ballistic.rs:27-28` | `BallisticParams.radius_min/max` |
| Ballistic CC | `ballistic_cc.rs:34-35` | `BallisticCcParams.radius_min/max` |
| CCA | `cca.rs:25-26` | `CcaParams.radius_min/max` |
| Tunable PC | `tunable.rs:30-31` | `TunableParams.radius_min/max` |
| **Tunable CC** | `tunable_cc.rs:76-77` | `TunableCcParams.radius_min/max` |
| GCCA | `gcca.rs:371-372` | Function params (not struct) |

**Per locked decision #6**: dpo distribution applies ONLY to CC tunable in this cycle. Other algorithms use `radius_min`/`radius_max` directly (as today).

### 1.3 `primary_particle_diameter_nm` — the "dpo" display field

| Layer | Location | Name |
|-------|----------|------|
| Frontend form | `SimulationForm.tsx:159` | `primary_particle_diameter_nm` (FormParams) |
| Frontend form | `SimulationForm.tsx:199` | Default: `25.0` nm |
| Frontend submit | `SimulationForm.tsx:678` | Sent in payload as `primary_particle_diameter_nm` |
| Backend serializer | `serializers.py:98-113` | Converts legacy radius→diameter; stamps `v2` |
| Backend params | `services/params.py:46` | `PARAM_KEY_DIAMETER = "primary_particle_diameter_nm"` |
| Backend tasks | `tasks.py:1271-1280` | Reads `radius_min`/`radius_max` from params dict |
| Python binding | `lib.rs:1189` | `radius_min: f64` / `radius_max: Option<f64>` args |

**Key insight**: `primary_particle_diameter_nm` is a **display scale** factor (nm), NOT an engine input. The engine uses dimensionless `radius_min`/`radius_max` (typically ~1.0). The dpo distribution should operate on the engine-level `radius_min`/`radius_max` pair, NOT on the nm display value.

---

## 2. SinteringDistribution Pattern Recap

**File**: `sintering.rs:17-24` — the template to replicate:

```rust
pub enum SinteringDistribution {
    Fixed(f64),
    Uniform { min: f64, max: f64 },
    Normal { mean: f64, std: f64 },
}
```

**Key methods**: `sample(&self, rng) -> f64`, `mean() -> f64`, `fixed(v)`, `uniform(min,max)`, `normal(mean,std)`.

**Python binding pattern** (`lib.rs:550-562`):

```rust
fn parse_sintering(sintering_coeff, sintering_type, sintering_min, sintering_max, sintering_std)
    -> SinteringDistribution {
    match sintering_type { "uniform" => ..., "normal" => ..., _ => Fixed }
}
```

NOT a tagged dict — uses **flat keyword args** (`sintering_type: &str`, `sintering_coeff: f64`, etc.). Each algo function has these 5 params. The same pattern should be replicated for `dpo_*` and `kf_*` keyword families.

---

## 3. Backend Serializer Schema — Current Shape

The `Simulation.parameters` is a **JSONField** (dict). There is NO model-level schema — validation is in `serializers.py:164-192` and is algorithm-specific but minimal. Sintering config is part of the flat params dict, not a nested sub-object.

**Current shape for tunable_cc** (from `tasks.py:1363-1383`):

```python
{
  "n_particles": 1000,
  "target_df": 1.8,
  "target_kf": 1.3,          # ← will become distribution config
  "radius_min": 1.0,         # ← will become distribution config  
  "radius_max": None,         # polydisperse range (optional)
  "sintering_coeff": 1.0,
  "sintering_type": "fixed",
  "sintering_min": 0.85,
  "sintering_max": 0.95,
  "sintering_std": 0.05,
  "primary_particle_diameter_nm": 25.0,  # display scale only
  "seed_type": "monomers",
  "parameters_schema_version": "v2",
}
```

---

## 4. Frontend Form Structure — Conditional Fields

**Pattern** (`SimulationForm.tsx:1189-1267`): Conditional rendering uses `{algorithm === 'tunable_cc' && (<>...</>)}`. Each algorithm has its own JSX block inside the `<CardContent>` of the Parameters card.

**Sintering sub-form** (`SimulationForm.tsx:1006-1133`): Already implements the exact UX pattern needed:
- Toggle button (enabled/disabled)
- Distribution type selector (`fixed | uniform | normal`) via 3 `<Button>` tabs
- Conditional inputs per type: fixed→slider, uniform→2 sliders, normal→2 sliders
- Preview formula text

This is the **template to replicate** for dpo and target_kf distribution fields within the `tunable_cc` section.

---

## 5. SimulationResult — `dpo_used` / `target_kf_used`

**File**: `result.rs:7-32`

**Current state**: No `dpo_used` or `target_kf_used` fields exist. The struct has diagnostic metadata from frente 12 (`tunable_merges`, `ballistic_merges`, `max_retries_per_merge`) at lines 27-31.

**Where to add**: Append after line 31 in `SimulationResult`:

```rust
pub dpo_used: f64,          // sampled or fixed dpo value
pub target_kf_used: f64,    // sampled or fixed target_kf value
```

**PySimulationResult** (`lib.rs:279-309`): Also needs the two new fields + the `From<SimulationResult>` impl at line 350. These are NOT currently propagated — the backend `tasks.py:1661-1678` metrics dict doesn't include them either.

---

## 6. Recommended Phasing

The 6 phases from locked decision hold. No surprises in file count.

| Phase | Scope | Files touched |
|-------|-------|---------------|
| P1 | Engine enums + sample() | `sintering.rs` (reference), new `distribution.rs` or in `tunable_cc.rs`, `result.rs` |
| P2 | Engine integration | `tunable_cc.rs` (sampling in `run_tunable_cc_internal`, propagate to result) |
| P3 | Python binding | `lib.rs` (add `dpo_type/dpo_*` and `kf_type/kf_*` kwargs to `run_tunable_cc`, update `PySimulationResult`) |
| P4 | Backend | `tasks.py` (pass new kwargs), `serializers.py` (validation) |
| P5 | Frontend | `SimulationForm.tsx` (distribution sub-forms), `types.ts` (new fields) |
| P6 | Integration tests + docs | cargo tests, vitest, CHANGELOG, Jira close |

**No scope creep detected**: all consumers map cleanly to the locked plan.

---

## 7. Open Questions for Orchestrator

None. All code paths confirmed and match the locked decisions in engram #515.
