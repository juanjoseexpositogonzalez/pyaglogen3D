# Delta Spec: fraktal-batch-extensions → capability fraktal-batch-distributions

> r2 MAJOR: el overlay del C2 en el MISMO histograma exige una excepción puntual a R2/R5/R-DELTA-M
> cuando el overlay está ACTIVO (la Out-of-Scope original prohibía tocarlos y se contradecía).
> Fuera del modo overlay, R2/R5/R-DELTA-M se aplican SIN cambios por serie.

## MODIFIED Requirements

### Requirement: R2. Bucket count derived from Sturges' rule, bounded [3, 30]

When the sim-Df overlay (R-DELTA-C2) is ACTIVE on the Df histogram, the bin range and count are
computed over the UNION of both series instead of the image series alone:

`k = ceil(log2(n_union) + 1)` with `n_union = n_image + n_sim` (successful values of both
series), clamped to `[3, 30]`; boundaries evenly spaced over the union `[min, max]` of both
series. Each METRIC's bucket count stays independent (kf, Rg, npo unchanged). When the overlay
is not active, R2 applies exactly as canonical (per-series, per-metric).

#### Scenario 2-O.1 — Union binning under overlay

- **GIVEN** 30 image Df values in [1.4, 2.2] and 3 sim Df values in [2.3, 2.5], overlay ON
- **WHEN** the Df histogram is computed
- **THEN** the shared bins cover [1.4, 2.5] with `k = ceil(log2(33) + 1) = 7` buckets, and
  each series is binned over those shared boundaries (counting remains per-series)

### Requirement: R5. Single unique value → degenerate histogram with one bar

Per series: when a series has `n ≥ 5` with zero variance, its series renders a single bar
spanning that value over the active shared range (overlay ON) or its own range (overlay OFF).
The component MUST NOT error or omit a qualifying series because the OTHER series is
degenerate or sparse.

#### Scenario 5-O.1 — Independent degeneracy under overlay

- **GIVEN** 10 image Df values all identical and 6 sim Df values with variance, overlay ON
- **THEN** the image series renders its single bar AND the sim series renders its histogram
  over the shared range — neither state suppresses the other

### Requirement: R-DELTA-M. Df histogram tooltip shows per-quality count breakdown

When the sim-Df overlay is ACTIVE, each bar's tooltip MUST attribute counts per SOURCE SERIES
in addition to the per-quality breakdown of the image series:

`"{n_image_in_bucket} images ({converged} converged, {approximate} approximate), {n_sim_in_bucket} sim"`

omitting empty components per the canonical rules. The per-quality format applies unchanged
to the image series; the sim series contributes a single count (no quality breakdown). With
the overlay OFF, R-DELTA-M applies exactly as canonical.

## ADDED Requirements

### Requirement: R-DELTA-C2. Sim-Df overlay in the image Df histogram (C2)

The batch result payload SHALL carry an additive `sim_df_values: […]` array (the linked sim's
`sim_box_counting_df` source per canonical R9; empty when no sim/metric — note: a batch links
ONE sim, so this array holds the values of that single sim's comparison lineage; empty is the
common case for sim-less batches). The FraktalBatchDistributions component SHALL render the
sim series as an overlay in the Df histogram per the MODIFIED R2/R5/R-DELTA-M above, with
PER-SERIES data-volume gates replacing the card-level early return:

- image series: existing per-metric gate (`MIN_N_SUCCESSFUL = 5`, `:97/:241`)
- sim series: renders at `n ≥ 5`; `1 ≤ n < 5` → "Not enough data" chip for that series;
  `n = 0`/absent → overlay hidden
- the global no-data gate (`:166-181`) applies only when BOTH series are empty for the metric
- the overlay toggle is hidden when `sim_df_values` is empty

#### Scenario R-DELTA-C2.1 — Mixed gates under overlay

- **GIVEN** an image series with `n = 3` (< 5) and a sim series with `n = 8`, overlay ON
- **WHEN** the Df panel renders
- **THEN** the sim series renders its histogram (it qualifies) and the image series shows its
  per-metric "Not enough data" state IN THE SAME CARD — the early-return gate does not
  suppress the qualifying series (r2 minor: gates are per-series, not card-level)
