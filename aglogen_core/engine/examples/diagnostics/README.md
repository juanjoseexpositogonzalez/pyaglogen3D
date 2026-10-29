# Diagnostic Experiments — BC vs CC-Tunable Bug Study (2026-05-26)

These five examples were used to triangulate a reported bug
("Box-counting clamps Df near 2 for clusters with Df > 2"). The investigation
concluded that **box-counting is correct** and the actual bug is in the
CC-tunable aggregation generator (see engram topic
`cc-tunable-bug-study-2026-05`).

Run any of them from the workspace root:

```bash
cargo run --release --example <name> -p aglogen-engine
```

## Files

| Example                  | Question it answered                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| `bc_bias_diagnosis`      | Does BC bias change with N, aspect ratio, or geometry? (3 batteries)          |
| `bc_peraxis_diagnosis`   | Would per-axis normalization fix elongated-cluster bias? (No — breaks 3D)     |
| `bc_physical_range`      | Would restricting eps to `[2·min_d, Rg]` improve convergence? (No)            |
| `bc_high_df_clamp`       | Can BC reach Df > 2 at all? (Yes: filled_cube → 3.0, Menger d4 → 2.7265)      |
| `bc_vs_sim_real`         | **DECISIVE**: sim_Df vs BC_Df on real CC-tunable clusters at varied targets.  |

## The decisive result

From `bc_vs_sim_real` (N=2000 per cluster, 3 seeds each):

```
Df_target | sim_Df  | BC_Df
----------+---------+--------
   1.50   |  2.72   |  1.80    sim grossly over-reports for low Df
   1.80   |  1.80   |  1.62
   2.00   |  2.00   |  1.84
   2.20   |  2.21   |  1.92
   2.50   |  2.39   |  1.97    sim caps near 2.4
   2.70   |  2.35   |  2.08    sim caps near 2.4
   2.90   |  2.42   |  2.06    sim caps near 2.4
```

The CC-tunable generator cannot produce clusters whose Rg-scaling Df matches
the requested target outside roughly `[1.8, 2.2]`. The user also reported
that `kf` falls below 1 in some runs, which is physically impossible (kf ≥ 1
for any real aggregate).

## Status

These files are kept as historical reference. They are NOT part of the
production build path (they only compile when explicitly requested via
`cargo run --example`).

If you want to reproduce the study, run `bc_vs_sim_real` first — it is the
single most informative example.
