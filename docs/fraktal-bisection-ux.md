# FRAKTAL Bisection UX (PYA-13)

Distinguishes 3 failure categories of the FRAKTAL bisection algorithm
and exposes diagnostic data that was previously discarded. Adds 4
quality states with graceful degradation, allowing the UI to convey
WHY an analysis failed and whether a partial result is usable.

## Why

Before this cycle, any image where the bisection didn't fully converge
returned a generic `"Bisection method failed to converge"` error. This
masked 3 distinct causes:

1. **Geometry incompatible with the model** (extreme view angles of
   planar aggregates fall outside the Granulated 2012 model's
   solvable domain).
2. **Non-physical result** (the bisection converges to a point with
   `kf < 0`).
3. **Numerical issue** (iteration limit exhausted, usually due to
   image noise).

The bisection solver was **already computing** all the diagnostic data
needed to distinguish these (residual, iterations, df estimate, kf),
but `granulated_2012.rs:296` discarded it on failure. This cycle
surfaces what was already there.

## Quality categories

| Quality | Badge | When | Df reported? |
|---------|-------|------|--------------|
| **converged** | 🟢 green | residual < 0.1 | Yes (exact) |
| **approximate** | 🟡 yellow | 0.1 ≤ residual ≤ 1.0 | Yes (with warning) |
| **excluded** | ⚪ gray | residual > 1.0 OR `no_sign_change` | No (fuera del modelo) |
| **failed** | 🔴 red | `kf_negative` OR engine error | No (no físico) |

## Failure reasons

When `quality` is `excluded` or `failed`, `failure_reason` indicates
the cause:

- **`no_sign_change`**: la ecuación FRAKTAL no cruza cero en
  `Df ∈ [1, 3]`. La proyección 2D del aggregate, vista desde ese ángulo,
  está fuera del dominio físico del modelo Granulated 2012. Típico en
  vistas top-down de aggregates planares (Df < 1.8). Mensaje al usuario:
  *"Geometría no analizable (modelo)"*.

- **`kf_negative`**: la bisección convirgió a un mínimo donde el
  prefactor `kf` es negativo. Resultado matemático sin sentido físico
  (kf debe ser positivo). Mensaje al usuario: *"Resultado no físico
  (kf < 0)"*.

- **`iteration_limit`**: la bisección agotó las 100 iteraciones máximas
  sin alcanzar la tolerancia de 1e-5. En la práctica casi nunca pasa
  porque `log2(2/1e-5) ≈ 17` iteraciones bastan; suele indicar ruido
  fuerte en la imagen. Mensaje al usuario: *"No convergió (ruido)"*.

## Per-image diagnostic data

Cada `FraktalBatchImage` ahora persiste 5 campos nuevos (todos
nullable):

- `bisection_iterations` (int): pasos de bisección ejecutados.
- `bisection_residual` (float): residual del último step.
- `failure_reason` (string): categoría arriba, o NULL si converged.
- `df_estimate` (float): best-guess de Df incluso si no convirgió
  (útil para `approximate`).
- `quality` (string): los 4 estados arriba.

Disponibles en el endpoint drill-down y en CSV export (5 columnas
appended).

## Stats semantic shift — IMPORTANTE

`mean_df` (y `mean_kf`, `mean_rg`, `mean_npo`) **AHORA cuentan SOLO
los converged**. Antes contaban todos los exitosos (lo que en la
nueva taxonomía sería converged + approximate).

Si quieres el comportamiento legacy (incluir approximate), usar el
campo nuevo `mean_df_inclusive` (y equivalentes).

```python
batch.stats.mean_df            # solo converged (NUEVO comportamiento)
batch.stats.mean_df_inclusive  # converged + approximate (legacy semantic)
```

Per-batch counters: `n_converged`, `n_approximate`, `n_excluded`,
`n_failed` también disponibles.

## CSV export

Single-image y batch CSV ahora incluyen 5 columnas appended al final:

```
... existing_columns,quality,bisection_iterations,bisection_residual,failure_reason,df_estimate
```

Locale-aware: floats respetan el separador decimal y de columnas del
usuario. Strings (quality, failure_reason) son literales.

Backwards compatible: parsers externos que ignoren columnas
desconocidas siguen funcionando.

## Migration

```bash
python manage.py migrate fractal_analysis 0011
```

Additive nullable, reversible. Legacy rows (sin los 5 campos nuevos)
quedan con `quality="converged"` por defecto (asunción optimista).

## Backward compatibility

- **Legacy `FraktalBatchImage` rows**: campos NULL/default; CSV
  exporta vacíos; frontend renderiza como `converged` (sin badge).
- **Engine results sin nuevos campos**: backend safety net en
  `persist_batch_results`: si hay `error` field → override a
  `quality="failed"`.
- **Parsers de CSV externos**: 5 columnas appended al final, no
  insertadas. Parsers que ignoran columnas desconocidas siguen
  funcionando.

## Validation

- Engine: 13 cargo tests cubriendo classify_quality + failure_reason
  detection + bracket_found tracking.
- Binding: 6 tests verificando los 5 fields surfaced en Python dict.
- Backend: 22 tests P3 + 12 tests P4 + 1 cross-cutting integration en
  `backend/tests/integration/test_fraktal_bisection_quality.py` con 15
  scenarios cubriendo todo el pipeline.
- Frontend: 91+ vitest tests across QualityBadge, drill-down per
  state, results table column, distributions overlay + dual-mean.

## Threshold tuning note

`EXCLUDED_RESIDUAL_THRESHOLD = 1.0` está hardcoded en
`aglogen_core/engine/src/fractal/fraktal/granulated_2012.rs`. Es un
threshold teórico — puede necesitar ajuste empírico después del
deploy si demasiadas imágenes que el usuario considera analizables
caen como `excluded`. Para tunearlo: editar la constante y recompilar
el wheel maturin.

## Known limitations

- **Algorithmic improvements deferred**: search range expansion,
  quality-aware bisection, otros algorithms (voxel solo recibe el
  surfacing pattern, no improvements). Backlog para futuros cycles.
- **Geometric domain limitation**: el modelo Granulated 2012 tiene
  restricciones físicas que ningún UX puede resolver — vistas
  extremas de aggregates planares simplemente no son analizables.
  El UX solo etiqueta la limitación con claridad.
- **Per-bucket quality split en histograms**: implementado a nivel
  chart-level (subtitle "X converged · Y approximate") en vez de
  por-bucket. Per-bucket queda como mejora futura si se justifica.
