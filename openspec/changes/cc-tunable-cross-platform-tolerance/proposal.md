## Why

The first CI run this repository ever had failed the engine job on
`rollback_byte_identity`: `coordinate[9][1]` of `seed1_df15.json` differed by **2 ULP** on
x86_64/Linux, against a requirement that allows 1. The same commit and the same fixture
give ≤ 1 ULP on arm64/macOS, and the in-memory comparison on each platform is
bit-identical.

So the fixture's tolerance was written on one target and enforced on another. R24 explains
its 1 ULP as the `serde_json` storage artifact; across platforms there is a second source,
the arithmetic, and 1 ULP does not cover it. A tolerance that only holds on the machine
that recorded the fixture is not a tolerance: it fails the moment the suite runs anywhere
else, which - until this week - it never did.

## What Changes

- **R24** states the cross-target bound and why it exists, with the measurement.
- **R24.1** and **R24.2** name both bounds per value: ≤ 1 ULP on the recording target,
  ≤ 2 ULP across targets. The in-memory bit-identity guarantee is untouched - it is the
  property that actually protects the rollback, and it holds on both platforms.
