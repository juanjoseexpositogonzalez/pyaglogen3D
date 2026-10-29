# Delta Spec: fraktal-batch-extensions → capability fraktal-batch-distributions

> r3 BLOCKER-1: con UNA sim por batch, la serie sim del overlay era un escalar (`n_sim ≤ 1`)
> — C2 reencaminada (decisión forzada por los datos) a un **marcador de referencia**: línea
> vertical en el Df de la sim sobre el histograma de imágenes. r4 MAJOR-2: la fuente del valor
> es ÚNICA — `study_comparison.sim_df.value` (publicado por R12 del contract delta); NO hay
> clave top-level `sim_df_value` duplicada. Consecuencia: NO hay MODIFIED de R2/R5/R-DELTA-M —
> binning, gates y tooltips canónicos intactos (la Out-of-Scope vuelve a ser cierta).

## ADDED Requirements

### Requirement: R-DELTA-C2. Sim-Df reference marker on the image Df histogram (C2)

The Df histogram panel SHALL draw a **vertical reference marker** at
`x = study_comparison.sim_df.value` when ALL of the following hold (r4 minors 4-5):

- the batch summary carries a non-null `study_comparison` (R12 of the contract delta — its
  `sim_df.value` is the single source of truth; no separate top-level key exists, and
  `target_df` for the hover comes from `study_comparison.sim_df.target_df`);
- the Df histogram itself renders — i.e. `n_successful ≥ 5` per the canonical gates. When the
  histogram is in a no-data state (canonical R4, `n_successful = 0`) or omitted by the
  "Not enough data" state (`1 ≤ n_successful < 5`, canonical R8 / component behavior), the
  marker is NOT drawn either (no marker floating over a plotless panel);
- the per-batch toggle is ON — component-local state, default ON, NOT persisted (r4 minor 5;
  the component has no persistence today and this change adds none).

The marker rendering:

- dashed vertical line spanning the plot height, visually distinct from the bars;
- a small label/chip near the line: `Sim Df: {value}` (2 decimals);
- hovering the marker shows `Sim Df: {value} (target: {target_df})` when `target_df` is
  non-null.

The marker MUST NOT affect bucket computation (R2), degenerate rendering (R5), tooltip
breakdowns (R-DELTA-M), the "N successful of M total" label, or the global/per-metric no-data
gates in any way.

#### Scenario R-DELTA-C2.1 — Marker renders over a normal histogram

- **GIVEN** a batch linked to a sim with `fractal_dimension = 2.42` (sentinel rule applied per
  R12) and 30 image Df values
- **WHEN** the Df histogram renders with the toggle ON
- **THEN** the canonical histogram renders unchanged (Sturges buckets per R2, label per R3)
- **AND** a dashed vertical marker sits at `x = 2.42` with the `Sim Df: 2.42` chip

#### Scenario R-DELTA-C2.2 — Marker hidden

- **GIVEN** any of: no sim / deleted sim / missing metric / `0.0` sentinel (`study_comparison`
  null), OR toggle OFF, OR the Df panel in no-data or "Not enough data" state
- **WHEN** the Df panel renders
- **THEN** no marker is drawn and no empty space or error state appears (panel identical to
  pre-change)
