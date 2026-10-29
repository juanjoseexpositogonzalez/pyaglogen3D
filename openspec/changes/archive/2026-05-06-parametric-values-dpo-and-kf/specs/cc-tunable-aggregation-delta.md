# Delta for cc-tunable-aggregation

Existing capability `cc-tunable-aggregation` still applies in full. This delta records the
changes introduced by `parametric-values-dpo-and-kf` (cycle 13 / PYA-15):

1. `target_kf` becomes a parametric input accepting a scalar (legacy) or a distribution config (`Fixed`, `Normal`, `Uniform`). Result gains `target_kf_used: Option<f64>`.
2. `dpo` (engine-level `radius_min`/`radius_max`) for CC tunable gains the same distribution support. Result gains `dpo_used: f64`.
3. Normal-mode sampling uses a truncated Normal (±3σ) with up to 10 re-sample attempts and a mean fallback.
4. Two new result fields (`dpo_used`, `target_kf_used`) are always populated and propagated to API response and CSV export.
5. Python binding gains 10 optional kwargs; legacy callers without them continue unchanged.

Scope constraint: distribution support is wired **only** to CC-tunable (`TunableCcParams`). DLA,
Ballistic, CCA, GCCA, and Tunable PC algorithms continue using deterministic `radius_min`/`radius_max`.

---

## MODIFIED Requirements

### R11. `target_kf` Parametric Input

Modifies **the implicit `target_kf` scalar contract assumed by R1, R5, R6, and R10** of
[`cc-tunable-aggregation.md`](../../../specs/cc-tunable-aggregation.md).

The algorithm MUST accept `target_kf` as either:

| Mode | Type | Meaning |
|------|------|---------|
| `Fixed(v)` | scalar `f64` | Deterministic — identical to current behaviour |
| `Normal { mean, std }` | two `f64` | Gaussian sample truncated to [μ − 3σ, μ + 3σ] (see R13) |
| `Uniform { min, max }` | two `f64` | Uniform sample over `[min, max]` |

Default: `Fixed` wrapping the existing scalar value. The sampled value MUST be drawn **once at
run start** using the simulation's seeded RNG. It is stored as `target_kf_used: Option<f64>` in
the result (Some for CC-tunable; None for algorithms that don't use `kf`).

Validation MUST reject: `std ≤ 0` for Normal; `max ≤ min` for Uniform; any non-positive value.

(Previously: `target_kf` was a bare `f64` scalar read once at line 869 of `tunable_cc.rs`;
no distribution config or sampling existed.)

#### Scenario 11.1 — Fixed mode: identical to current behaviour (regression)

- GIVEN `target_kf = Fixed(1.3)`, seed `42`, `N=100`, `Df=1.8`
- WHEN the simulation runs
- THEN `result.target_kf_used = Some(1.3)` and aggregate Df/kf match the pre-cycle baseline for seed 42
- AND no statistical variance is introduced

#### Scenario 11.2 — Normal mode: sampled value within ±3σ

- GIVEN `target_kf = Normal { mean: 1.3, std: 0.1 }`, seed `42`
- WHEN the simulation runs
- THEN `result.target_kf_used = Some(v)` where `v ∈ [1.0, 1.6]` (μ ± 3σ)
- AND the physics uses `v` as the effective `kf` for all merge steps

#### Scenario 11.3 — Uniform mode: sampled value within bounds

- GIVEN `target_kf = Uniform { min: 1.1, max: 1.5 }`, seed `7`
- WHEN the simulation runs
- THEN `result.target_kf_used = Some(v)` where `v ∈ [1.1, 1.5]`

#### Scenario 11.4 — Fixed seed → reproducible sample

- GIVEN `target_kf = Normal { mean: 1.3, std: 0.1 }`, same seed used twice
- WHEN both simulations run independently
- THEN both `result.target_kf_used` are equal (deterministic sampling from seeded RNG)

#### Scenario 11.5 — Validation: non-positive std rejected

- GIVEN `target_kf = Normal { mean: 1.3, std: -0.1 }` or `std: 0.0`
- WHEN the simulation is submitted (backend serializer or engine param validation)
- THEN an error is returned describing the invalid parameter; no simulation is started

#### Scenario 11.6 — Validation: Uniform with max ≤ min rejected

- GIVEN `target_kf = Uniform { min: 1.5, max: 1.1 }` or `min == max`
- WHEN submitted
- THEN validation rejects with a descriptive error; no simulation is started

---

### R12. `dpo` Parametric Input (CC-Tunable Only)

**ADDED** to [`cc-tunable-aggregation.md`](../../../specs/cc-tunable-aggregation.md).

The CC-tunable algorithm MUST accept a `dpo_distribution` parameter governing how engine-level
`radius_min`/`radius_max` are sampled:

| Mode | Type | Meaning |
|------|------|---------|
| `Fixed(v)` | scalar `f64` | Deterministic — applies `radius_min = v`, `radius_max = v` (monodisperse) |
| `Normal { mean, std }` | two `f64` | Gaussian sample truncated to [μ − 3σ, μ + 3σ]; same value for min and max |
| `Uniform { min, max }` | two `f64` | Uniform sample; result used as both `radius_min` and `radius_max` |

Default: `Fixed` wrapping the existing scalar `radius_min` value. The sampled value MUST be
drawn **once at run start** using the seeded RNG. It is stored as `dpo_used: f64` in the result.

Validation MUST reject: `mean ≤ 0`, `std ≤ 0` for Normal; `min ≤ 0`, `max ≤ min` for Uniform.
The constraint `dpo > 0` MUST be enforced for all modes since `radius_min` must be positive.

Scope: this distribution applies **exclusively** to `TunableCcParams`. Other algorithm structs
(`DlaParams`, `BallisticParams`, etc.) are unchanged in this cycle.

#### Scenario 12.1 — Fixed mode: identical to current behaviour (regression)

- GIVEN `dpo_distribution = Fixed(1.0)`, seed `42`, `N=100`
- WHEN the simulation runs
- THEN `result.dpo_used = 1.0` and the aggregate matches the pre-cycle baseline for seed 42

#### Scenario 12.2 — Normal mode: sampled dpo within ±3σ

- GIVEN `dpo_distribution = Normal { mean: 1.0, std: 0.05 }`, seed `42`
- WHEN the simulation runs
- THEN `result.dpo_used ∈ [0.85, 1.15]` (μ ± 3σ)
- AND the physics uses this sampled value as the effective `radius_min/max`

#### Scenario 12.3 — Uniform mode: sampled value within [min, max]

- GIVEN `dpo_distribution = Uniform { min: 0.8, max: 1.2 }`, seed `7`
- WHEN the simulation runs
- THEN `result.dpo_used ∈ [0.8, 1.2]`

#### Scenario 12.4 — Validation: non-positive mean or std rejected

- GIVEN `dpo_distribution = Normal { mean: -1.0, std: 0.1 }` or `mean: 0.0`
- WHEN submitted
- THEN validation rejects with a descriptive error

#### Scenario 12.5 — Validation: non-positive Uniform bounds rejected

- GIVEN `dpo_distribution = Uniform { min: -0.5, max: 0.5 }` or `min: 0.0, max: 1.0` where min ≤ 0
- WHEN submitted
- THEN validation rejects; no simulation is started

---

## ADDED Requirements

### R13. Truncated Normal Sampling

**ADDED** to [`cc-tunable-aggregation.md`](../../../specs/cc-tunable-aggregation.md).

When `Normal { mean: μ, std: σ }` is specified for any parametric input, the system MUST
sample from a **truncated Normal** distribution bounded to `[μ − 3σ, μ + 3σ]`:

1. Draw a candidate from `Normal(μ, σ)` using the seeded RNG.
2. If the candidate falls outside `[μ − 3σ, μ + 3σ]`, reject it and re-draw.
3. Repeat up to **10 re-draw attempts** total.
4. If all 10 attempts fall outside the bounds, return **μ** (the mean) as the final value.

The RNG state advances for each drawn candidate (rejected or accepted), ensuring reproducibility.

#### Scenario 13.1 — Sample within bounds on first draw

- GIVEN `Normal { mean: 1.3, std: 0.1 }`, seed that produces a within-bounds first draw
- WHEN sampling is performed
- THEN the returned value `v ∈ [1.0, 1.6]` with no re-draws

#### Scenario 13.2 — No sample escapes the ±3σ bound across many draws

- GIVEN `Normal { mean: 1.3, std: 0.1 }` and 1000 independent seeds
- WHEN each seed samples once
- THEN all 1000 sampled values are in `[1.0, 1.6]`
- AND no value equals exactly 1.3 from a guaranteed fallback (statistically implausible)

#### Scenario 13.3 — Fallback to mean after 10 failed attempts

- GIVEN a degenerate case where the first 10 draws all fall outside ±3σ (can be forced in unit tests)
- WHEN sampling is performed
- THEN the returned value is exactly μ
- AND no panic or error is raised

#### Scenario 13.4 — Reproducibility: same seed → same sample

- GIVEN `Normal { mean: 1.3, std: 0.1 }` and seed `42` used twice, independently
- WHEN sampling is performed in each run
- THEN both runs return the same value

---

### R14. Result Fields `dpo_used` and `target_kf_used`

**ADDED** to [`cc-tunable-aggregation.md`](../../../specs/cc-tunable-aggregation.md).

The `SimulationResult` returned by the CC-tunable algorithm MUST include:

| Field | Type | Populated |
|-------|------|-----------|
| `dpo_used` | `f64` | Always; equals the sampled or fixed dpo value used in that run |
| `target_kf_used` | `Option<f64>` | `Some(v)` for CC-tunable; `None` for algorithms without kf |

Both fields MUST be serialized in the API response payload and included in CSV exports.

#### Scenario 14.1 — Fixed mode: `dpo_used` equals the configured value

- GIVEN `dpo_distribution = Fixed(1.0)` and any seed
- WHEN the simulation completes
- THEN `result.dpo_used == 1.0` exactly

#### Scenario 14.2 — Normal mode: `dpo_used` equals the actual sampled value

- GIVEN `dpo_distribution = Normal { mean: 1.0, std: 0.05 }`, seed `42`
- WHEN the simulation completes
- THEN `result.dpo_used` equals the value drawn from the distribution (not the mean)
- AND `result.dpo_used ∈ [0.85, 1.15]`

#### Scenario 14.3 — `target_kf_used` is None for non-kf algorithms

- GIVEN any algorithm that is NOT CC-tunable (e.g., DLA, Ballistic)
- WHEN the simulation completes
- THEN `result.target_kf_used == None`
- AND the API response serializes this field as `null`

#### Scenario 14.4 — Both fields present in API response and CSV

- GIVEN a completed CC-tunable simulation
- WHEN the API result is fetched OR CSV is exported
- THEN `dpo_used` and `target_kf_used` appear in the payload/row
- AND neither field is absent or null (for CC-tunable runs, `target_kf_used` is non-null)

---

### R15. Python Binding Backward Compatibility

**ADDED** to [`cc-tunable-aggregation.md`](../../../specs/cc-tunable-aggregation.md).

The `run_tunable_cc` Python binding MUST accept 10 new optional keyword arguments for
distribution configuration (5 per parameter):

| Param | Args |
|-------|------|
| `dpo` | `dpo_mode: str`, `dpo_value: f64`, `dpo_mean: f64`, `dpo_std: f64`, `dpo_min: f64`, `dpo_max: f64` |
| `kf` | `kf_mode: str`, `kf_value: f64`, `kf_mean: f64`, `kf_std: f64`, `kf_min: f64`, `kf_max: f64` |

When any of these kwargs are absent, the binding MUST fall back to the existing scalar
`radius_min` / `target_kf` positional arguments (Fixed mode). Existing callers are unaffected.

Valid `mode` strings: `"fixed"` (default), `"normal"`, `"uniform"`.

#### Scenario 15.1 — Legacy caller: no new kwargs → Fixed fallback works

- GIVEN a Python call to `run_tunable_cc(radius_min=1.0, target_kf=1.3, ...)`  without any `dpo_*` or `kf_*` kwargs
- WHEN the call executes
- THEN `result.dpo_used == 1.0` and `result.target_kf_used == Some(1.3)`
- AND behavior is bit-for-bit identical to the pre-cycle version for the same seed

#### Scenario 15.2 — New kwargs: Normal mode via Python

- GIVEN `run_tunable_cc(..., dpo_mode="normal", dpo_mean=1.0, dpo_std=0.05, kf_mode="fixed", kf_value=1.3)`
- WHEN the call executes
- THEN `result.dpo_used ∈ [0.85, 1.15]` and `result.target_kf_used == Some(1.3)`

#### Scenario 15.3 — Invalid mode string rejected

- GIVEN `dpo_mode="gaussian"` (not a valid mode string)
- WHEN the call executes
- THEN a `ValueError` or equivalent is raised before any simulation logic runs

#### Scenario 15.4 — Uniform mode via Python

- GIVEN `run_tunable_cc(..., kf_mode="uniform", kf_min=1.1, kf_max=1.5)`
- WHEN the call executes
- THEN `result.target_kf_used = Some(v)` where `v ∈ [1.1, 1.5]`
