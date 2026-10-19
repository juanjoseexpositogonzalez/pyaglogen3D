# Delta Spec: fraktal-batch-extensions → capability fraktal-batch-distributions

> r3 BLOCKER-1: con UNA sim por batch, la serie sim del overlay era un escalar (`n_sim ≤ 1`)
> — todos los gates n≥5 y escenarios de unión eran inalcanzables. C2 se reencamina (decisión
> forzada por los datos, a ratificar en approval.md) a un **marcador de referencia**: una línea
> vertical en el Df de la sim sobre el histograma de imágenes. Consecuencia: NO hay MODIFIED de
> R2/R5/R-DELTA-M — el binning, gates y tooltips canónicos quedan intactos (la Out-of-Scope
> "sin cambios a requisitos existentes" vuelve a ser cierta para esta capability).

## ADDED Requirements

### Requirement: R-DELTA-C2. Sim-Df reference marker on the image Df histogram (C2)

The batch result payload SHALL carry an additive nullable `sim_df_value: number | null` — the
linked simulation's `metrics["fractal_dimension"]` (`views.py:1132`), **with the SAME missing
rule as R12**: absent sim, deleted sim row, missing metric, or the `0.0` sentinel → `null`
(identical wording to R12's population rule — r3 minor 6: one rule, both deltas). Delivered
through the same three payload builders via the `_build_study_comparison` lineage (Change A of
this feature pair uses the same scalar; here it feeds the marker only).

When `sim_df_value` is non-null and the Df histogram is rendered, the component SHALL draw a
**vertical reference marker** at `x = sim_df_value`:

- dashed vertical line spanning the plot height, visually distinct from the bars (r3: the
  image series' binning, gates, and tooltips are UNTOUCHED — canonical R2/R5/R-DELTA-M apply
  exactly as canonical);
- a small label/chip near the line: `Sim Df: {value}` (2 decimals);
- hovering the marker shows `Sim Df: {value} (target: {target_df})` when `target_df` is
  available (source: R12's `sim_df.target_df`);
- the marker is hidden when `sim_df_value` is `null`, when the Df histogram itself is in a
  no-data state (canonical R4), and when the user disables it (a per-batch toggle, default ON).

The marker MUST NOT affect bucket computation (R2), degenerate rendering (R5), tooltip
breakdowns (R-DELTA-M), or the "N successful of M total" label in any way.

#### Scenario R-DELTA-C2.1 — Marker renders over a normal histogram

- **GIVEN** a batch linked to a sim with `fractal_dimension = 2.42`, 30 image Df values
- **WHEN** the Df histogram renders
- **THEN** the canonical histogram renders unchanged (Sturges buckets per R2, label per R3)
- **AND** a dashed vertical marker sits at `x = 2.42` with the `Sim Df: 2.42` chip

#### Scenario R-DELTA-C2.2 — Marker hidden

- **GIVEN** a batch without sim, with a deleted sim row, with a sim metric missing or `0.0`
- **WHEN** the Df histogram renders
- **THEN** no marker is drawn and no empty space or error state appears (histogram identical
  to pre-change)
