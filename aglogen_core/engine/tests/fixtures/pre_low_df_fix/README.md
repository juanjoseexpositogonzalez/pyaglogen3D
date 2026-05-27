# Pre-Fix Snapshots — cc-tunable-low-df-fix

## Purpose

These JSON files capture the **pre-fix reference output** of `run_tunable_cc_internal`
before the `cc-tunable-low-df-fix` change is applied. They are used exclusively by the
**R24 byte-identity tests** (`rollback_byte_identity` in `cc_tunable_low_df_test.rs`)
to prove that setting `CC_TUNABLE_USE_LOW_DF_FIX=false` produces bit-identical results
to the pre-patch algorithm.

## Files

| File | Seed | target_df | n_particles |
|------|------|-----------|-------------|
| `seed1_df15.json` | 1 | 1.5 | 100 |
| `seed2_df18.json` | 2 | 1.8 | 100 |
| `seed3_df20.json` | 3 | 2.0 | 100 |

All runs use `TunableCcParams::default()` overrides: `n_particles: 100`,
`radius_min: 1.0`, `radius_max: 1.0`, `target_kf: 1.3`, and the respective
`target_df` and `seed` values above.

## How to Regenerate

```bash
cd aglogen_core
cargo run --release --example gen_pre_fix_snapshots -p aglogen-engine
```

The generator writes the fixtures to this directory (`tests/fixtures/pre_low_df_fix/`).

## WARNING — DO NOT MODIFY AFTER COMMIT

These fixture files MUST NOT be modified or regenerated after this commit lands.
They encode the **pre-patch algorithm output** at specific seeds.

Regenerating them after the fix is applied (with `CC_TUNABLE_USE_LOW_DF_FIX=true`)
would produce different values and **silently invalidate the R24 byte-identity tests**.

If you must regenerate (e.g., after a Rust toolchain upgrade that changes f64 formatting):
1. Ensure `CC_TUNABLE_USE_LOW_DF_FIX=false` is set in your environment.
2. Run the generator.
3. Update the commit message to document the toolchain change.
4. Have the change reviewed by a maintainer.

## Float Serialization Contract

`serde_json` serializes `f64` using its shortest round-trip representation
(Ryu algorithm). This means every `f64` value written to JSON can be parsed
back to the exact same bit pattern. The R24 tests load these files and compare
using `==` element-wise — no epsilon tolerance.

Do not pretty-print these files. Compact JSON keeps the fixture footprint
manageable (each file is ~50–80 KB at N=100).
