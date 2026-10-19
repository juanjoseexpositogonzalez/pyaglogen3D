# Delta Spec: fraktal-batch-extensions → capability fraktal-batch-persistence

> **Modifies R2 of `fraktal-batch-persistence`.** Restatement COMPLETE (regla de archive del repo:
> los bloques MODIFIED se escriben completos — spec-review r3 BLOCKER-2, verificado en r4 con diff
> solo-adiciones contra el canónico). Único cambio de contrato: el campo nullable
> `pixels_per_100nm` (+ cláusula de uso en re-análisis + scenario 2.11). Todo lo demás es el texto
> canónico verbatim (enumeración exhaustiva, AND-clauses y scenarios 2.1-2.10 preservados sin
> alteración).

### R2. FraktalBatchImage rows store per-image data + PNG bytes

**GIVEN** N images in a batch,
**WHEN** the batch task completes,
**THEN** N `FraktalBatchImage` rows exist, each with: `batch` (FK), `index` (int, unique together with `batch`), `filename`, `azimuth`, `elevation`, `fractal_dimension`, `prefactor`, `r_squared`, `n_particles_counted`, `dpo_used`, `error`, `png_bytes` (`BinaryField`), `png_scientific_bytes` (`BinaryField`, nullable), `rg_nm` (`FloatField`, nullable), `analysis_input_variant` (string, NOT NULL),
**AND** when the batch ZIP contains a scientific PNG for a direction, `png_scientific_bytes` MUST be populated with the threshold-applied binary bytes (post-render: pixels > 127 → 255, pixels ≤ 127 → 0; output is EXACTLY 0 or 255 per pixel — no tolerance),
**AND** when the batch ZIP does NOT contain a scientific PNG for a direction (legacy batch), `png_scientific_bytes` MUST be NULL (not empty bytes — NULL),
**AND** `analysis_input_variant` MUST be set to `"scientific"` when `png_scientific_bytes` was fed to the FRAKTAL engine for this image, and `"presentation"` when `png_bytes` was used instead,
**AND** `rg_nm` MUST be populated from the engine result when the analyzer returns a valid radius of gyration for that image,
**AND** `rg_nm` MUST be stored as NULL when the analyzer does not produce an Rg value for that image (analysis failure, or engine version that does not output Rg),
**AND** existing rows written before this migration have `rg_nm = NULL` and MUST remain fully accessible without error (additive field, no destructive migration),
**AND** existing rows written before migration `0008` have `analysis_input_variant = "presentation"` as the migration default and MUST remain fully accessible without error (additive field),
**AND** each row MUST additionally contain:
- `quality: CharField max_length=12, default="converged"` —
  choices: `converged | approximate | excluded | failed`
- `bisection_iterations: IntegerField, null=True`
- `bisection_residual: FloatField, null=True`
- `failure_reason: CharField max_length=20, null=True` —
  choices: `no_sign_change | kf_negative | iteration_limit | none | null`
- `df_estimate: FloatField, null=True`
- `pixels_per_100nm: FloatField, null=True, blank=True` — per-image calibration scale in
  pixels per 100 nm; populated at analysis time from `directions[i].pixels_per_100nm` when
  the corresponding ZIP `directions[]` entry carries it, and from the batch-level broadcast
  value when it does not (same two sources as the calibration semantics of
  `fraktal-batch-contract.md` R1)
**AND** existing rows written before migration `0011` have `quality = "converged"` (column
default) and all four new nullable fields as NULL; they MUST remain fully accessible
without error.

**AND** the bulk re-analysis defined in R13 (capability `fraktal-batch-contract`, change
`fraktal-batch-extensions`) uses the persisted per-image `pixels_per_100nm` value when
present and falls back to the batch scale when NULL, leaving the batch-level
`calibration_source` unchanged (per-image provenance is observable through this field only),
**AND** rows written before this migration have `pixels_per_100nm = NULL` and keep it (no
backfill) — their re-analysis (R13) falls back to the batch scale,

(Previously: R2 did not include `quality`, `bisection_iterations`, `bisection_residual`,
`failure_reason`, `df_estimate`, `analysis_input_variant`, `rg_nm` or `pixels_per_100nm`; which PNG variant was
fed to the analyzer was not recorded anywhere, and per-image Rg values and bisection diagnostic
data were not persisted.)

#### Scenario 2.1 — Converged image persistence

- GIVEN an image whose bisection converged (residual 0.04, iterations 12, Df 1.82)
- WHEN the batch task stores the result
- THEN the row has `quality = "converged"`, `bisection_iterations = 12`,
  `bisection_residual = 0.04`, `failure_reason = "none"`, `df_estimate = 1.82`,
  `fractal_dimension = 1.82`

#### Scenario 2.2 — Approximate image persistence

- GIVEN an image where bisection reached iteration limit with residual 0.5 (< 1.0 threshold)
- WHEN the batch task stores the result
- THEN `quality = "approximate"`, `bisection_residual = 0.5`, `failure_reason = "iteration_limit"`,
  `df_estimate` is set to the best Df approximation, `fractal_dimension = null`

#### Scenario 2.3 — Excluded image persistence (no_sign_change)

- GIVEN an image where bisection reported no_sign_change failure
- WHEN the batch task stores the result
- THEN `quality = "excluded"`, `failure_reason = "no_sign_change"`,
  `df_estimate = null`, `bisection_residual = null`, `fractal_dimension = null`

#### Scenario 2.4 — Failed image persistence (kf_negative)

- GIVEN an image where bisection reported kf_negative failure
- WHEN the batch task stores the result
- THEN `quality = "failed"`, `failure_reason = "kf_negative"`,
  `df_estimate = null`, `fractal_dimension = null`

#### Scenario 2.5 — Engine crash persistence

- GIVEN an image where the engine crashed without surfacing a bisection category
- WHEN the batch task stores the result (catching the exception)
- THEN `quality = "failed"`, `failure_reason = null` (not "none"),
  `df_estimate = null`, `bisection_iterations = null`, `bisection_residual = null`

#### Scenario 2.6 — Legacy row backward compatibility

- GIVEN a `FraktalBatchImage` row created before migration `0011`
- WHEN the drill-down or list endpoint is queried for this row
- THEN HTTP 200; `quality = "converged"` (column default); all four new nullable fields are null
- AND `fractal_dimension` and all other pre-migration fields serve correctly without error

#### Scenario 2.7 — New batch: scientific bytes used → variant recorded

- GIVEN a new-mode ZIP where direction `i` has both presentation and scientific PNGs
- WHEN the batch task completes (sync or async)
- THEN the `FraktalBatchImage` row for direction `i` has `png_scientific_bytes` non-NULL
- AND `analysis_input_variant = "scientific"`

#### Scenario 2.8 — Legacy batch: presentation used → variant recorded

- GIVEN a legacy ZIP with no `*.scientific.png` files
- WHEN the batch task completes
- THEN every `FraktalBatchImage` row has `png_scientific_bytes = NULL`
- AND `analysis_input_variant = "presentation"`

#### Scenario 2.9 — Pre-migration rows: default variant applied

- GIVEN existing `FraktalBatchImage` rows written before migration `0008`
- WHEN the drill-down endpoint is queried for any of these rows
- THEN HTTP 200 is returned; `analysis_input_variant = "presentation"` (migration default)
- AND `png_bytes` serves correctly; no error

#### Scenario 2.10 — Index uniqueness unchanged

- GIVEN a new-mode batch
- WHEN two rows with the same `(batch, index)` are attempted
- THEN the unique constraint is violated; second insert is rejected (unchanged behavior)

#### Scenario 2.11 — Re-analysis uses persisted per-image scale (renumbered from 2.9: canonical already has 2.9/2.10 — r4 minor 1)

- GIVEN a failed image whose row carries `pixels_per_100nm = 4.2` (populated at first analysis)
- WHEN the bulk re-analysis of R13 processes that image
- THEN the analysis runs at scale 4.2 pixels per 100 nm (not the batch broadcast value)
- AND the batch-level `calibration_source` is unchanged after the re-analysis

#### Scenario 2.12 — Mixed population at first analysis (r4 minor 6)

- GIVEN a grid-mode ZIP where direction `i` carries `directions[i].pixels_per_100nm = 4.2`
  and direction `j` does not (batch-level `parameters.pixels_per_100nm = 3.8`)
- WHEN the batch task stores both rows
- THEN row `i` has `pixels_per_100nm = 4.2` (per-direction source)
- AND row `j` has `pixels_per_100nm = 3.8` (batch broadcast source)

