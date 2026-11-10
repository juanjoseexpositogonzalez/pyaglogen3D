## MODIFIED Requirements

### Requirement: R24. Rollback Byte-Identity Guarantee

When `read_low_df_fix_flag()` returns `false`, the code path executed by
`run_tunable_cc_internal` MUST be byte-identical to the pre-fix algorithm: same RNG draw order,
same RNG consumers, same `find_feasible_pairs` threshold (`bounding_sum >= required_distance`,
full gamma), same seed pool construction. No new RNG streams are created in the flag-off path.

For any `(seed, TunableCcParams)` pair, running with `CC_TUNABLE_USE_LOW_DF_FIX=false` MUST
produce a `SimulationResult` that is **bit-identical in-memory** to the pre-patch reference,
verified by `examples/diagnostics/r24_in_memory_check` (two consecutive runs compared via
`to_bits()`).

When verifying against JSON-stored fixture files, tolerance is governed by the
**`serde_json` round-trip artifact** (≤ 1 ULP for ~14% of f64 values in arrays;
single-scalar values preserved exactly). This is a property of the storage format, not the
simulation. See `examples/diagnostics/r24_json_roundtrip` for the empirical bounds and
`design.md` for the rationale.

**Across platforms the bound is ≤ 2 ULP.** A fixture recorded on one target and compared
on another carries the storage artifact of the first plus the arithmetic of the second:
measured on seed1_df15.json, `coordinate[9][1]` differs by 2 ULP on x86_64/Linux where the
same commit and the same fixture differ by ≤ 1 ULP on arm64/macOS, and the in-memory
comparison on that platform is still bit-identical. The extra ULP belongs to floating-point
arithmetic, not to the algorithm, and it is stated here because a tolerance that only holds
on the machine that wrote the fixture is not a tolerance.

#### Scenario R24.1 — Flag-off reproduces pre-patch coordinates

- GIVEN any `TunableCcParams` (any `seed_type`, any `target_df`, any `N ≤ 500`) and any seed `s`
- WHEN the simulation runs with `CC_TUNABLE_USE_LOW_DF_FIX=false`
- THEN `result.coordinates` matches a recorded pre-patch JSON snapshot for `(params, s)` within ≤ 1 ULP per coordinate value on the target that recorded it, and ≤ 2 ULP across targets
- AND `result.radii` matches within the same bound

#### Scenario R24.2 — Flag-off reproduces pre-patch fractal metrics

- GIVEN the same `(params, s)` as R24.1
- WHEN the simulation runs with the flag OFF
- THEN `result.fractal_dimension` and `result.prefactor` match the pre-patch JSON snapshot bit-for-bit (`to_bits() == to_bits()`, single scalars preserved exactly by `serde_json`)
- AND `result.rg_evolution` (entire sequence) matches within the same bound per element: ≤ 1 ULP on the recording target, ≤ 2 ULP across targets

#### Scenario R24.3 — Flag-off creates no additional RNG streams

- GIVEN any simulation with the flag OFF
- WHEN execution reaches the end of `initialize_seed_clusters`
- THEN no RNG state was forked via the `PC_SEED_RNG_SALT` (no separate stream exists)
- AND the main RNG advance count equals the pre-patch advance count at the same point

---
