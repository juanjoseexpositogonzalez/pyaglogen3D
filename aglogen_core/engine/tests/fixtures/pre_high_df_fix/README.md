# Pre-Fix Snapshots — cc-tunable-high-df-fix

## Purpose

These JSON files capture the **Cycle-1-only reference output** of `run_tunable_cc_internal`
before the `cc-tunable-high-df-fix` (Cycle 2) change is applied. They are used exclusively by
the **R26.4 / R27.6 byte-identity rollback tests** (`rollback_high_df_fix_false_matches_pre_fix_snapshot`
in `cc_tunable_high_df_test.rs`) to prove that setting `CC_TUNABLE_USE_HIGH_DF_FIX=false`
(with `CC_TUNABLE_USE_LOW_DF_FIX=true`) produces bit-identical results to the Cycle-1-only
baseline for the same parameters.

## Files

| File                  | Seed | target_df | n_particles |
|-----------------------|------|-----------|-------------|
| `seed1_df27.json`     | 1    | 2.7       | 100         |
| `seed2_df29.json`     | 2    | 2.9       | 100         |
| `seed3_df25.json`     | 3    | 2.5       | 100         |

All runs use `TunableCcParams::default()` overrides: `n_particles: 100`,
`radius_min: 1.0`, `radius_max: 1.0`, `target_kf: 1.3`, `seed_type: Dimers`, and the
respective `target_df` and `seed` values above.

The generator runs with `CC_TUNABLE_USE_HIGH_DF_FIX=false` (env var explicitly set) to
capture the Cycle-1-only code path. `CC_TUNABLE_USE_LOW_DF_FIX` is left at its default
(`true`) so these fixtures represent the **Cycle 1 production default** (flag matrix row 4:
`LOW_DF_FIX=T, HIGH_DF_FIX=F`).

## How to Regenerate

```bash
cd aglogen_core
CC_TUNABLE_USE_HIGH_DF_FIX=false cargo run --release --example gen_pre_high_df_fix_snapshots -p aglogen-engine
```

The generator writes the fixtures to this directory (`tests/fixtures/pre_high_df_fix/`).

## WARNING — DO NOT MODIFY AFTER COMMIT

These fixture files MUST NOT be modified or regenerated after this commit lands.
They encode the **Cycle-1-only algorithm output** at specific (seed, Df) configurations.

Regenerating them after applying `CC_TUNABLE_USE_HIGH_DF_FIX=true` (or without explicitly
setting it to `false`) would capture different values and **silently invalidate the R26.4
byte-identity tests**.

If you must regenerate (e.g., after a Rust toolchain upgrade that changes f64 formatting):
1. Ensure `CC_TUNABLE_USE_HIGH_DF_FIX=false` is set in your environment.
2. Ensure `CC_TUNABLE_USE_LOW_DF_FIX` is unset (defaults to `true`).
3. Run the generator.
4. Update the commit message to document the toolchain change.
5. Have the change reviewed by a maintainer.

## Float Serialization Contract

`serde_json` serializes `f64` using its shortest round-trip representation
(Ryu algorithm). This means every `f64` value written to JSON can be parsed
back to the exact same bit pattern. The R26.4 tests load these files and compare
using `==` (strict bit-equality for scalars, 1-ULP tolerance for vector fields
— see Cycle 1 design.md §R24 precedent).

Do not pretty-print these files. Compact JSON keeps the fixture footprint
manageable (each file is ~25–35 KB at N=100 with Dimers).

## Fixture Provenance

- **Generator source**: `examples/fixtures/gen_pre_high_df_fix_snapshots.rs`
- **Cycle 1 analog**: `tests/fixtures/pre_low_df_fix/` (R24 fixtures, generated pre-Cycle-1)
- **Spec**: R26.4, R27.6 in `openspec/changes/cc-tunable-high-df-fix/specs/cc-tunable-aggregation.md`
- **Design reference**: design.md §5 flag matrix row 4 (`LOW=T, HIGH=F`)
