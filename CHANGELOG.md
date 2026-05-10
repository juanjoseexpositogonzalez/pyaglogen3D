## coordination-export-and-histogram (unreleased)

### Added
- Per-particle coordination data in `Simulation.metrics.coordination.per_particle` — list of `{particle_id, n_contacts, contact_neighbors}` for every particle
- Coordination distribution histogram in `Simulation.metrics.coordination.distribution` — keyed by coordination number, value = particle count
- 2 new sections in per-simulation CSV export (`/api/v1/projects/{p}/simulations/{s}/export/`):
  - `# section: coordination_per_particle`
  - `# section: coordination_distribution`
- 2 new columns in parametric study batch CSV export: `Coord_Mode`, `Coord_Max`
- New service `apps/simulations/services/coordination.py` — single source of truth for contact computation

### Changed
- **Contact threshold unified** across the codebase to `(r_i + r_j) * 1.01` (1% tolerance, matching neighbor_graph endpoint). Previously: tasks.py used `2.1 * radius` (monodisperse) and `(r_i+r_j)*1.05` (polydisperse). Historical `coordination.mean` and `coordination.std` values may differ ~3-5% from previous releases. One-time correction for consistency.
- `neighbor_graph` endpoint now returns cached per-particle data when available (faster, identical results to export).

### Migration
- No DB migration. New fields persist in existing JSONField.
- Historical simulations remain valid; their `coordination` field has only `{mean, std}` (frontend treats new fields as Optional).

## pya-14-phase3-df-convergence (unreleased)

### Fixed

- **CC tunable Df convergence for Df<2** — was systematically biased +16.4% (Df_target=1.7 → Df_measured≈1.98), now within ±10% for Df ∈ {1.4, 1.6, 1.7, 1.8} and ±5% for Df ≥ 2.0 (Df=1.7 → 1.707, error 0.4%).

### Added

- **Smart pair selection** — feasibility pre-screen filters geometrically impossible pairs before retry loop (R3 modified).
- **Adaptive merge with march-inward placement** — analytical sphere-sphere contact solver replaces undershoot ballistic for the no-feasible-pair case (R5 modified, R18 added).
- **`merge_type="adaptive"`** value + `overshoot_pct` field in merge_trace entries (R18).
- **Feature flag `CC_TUNABLE_USE_PHASE3_ALGORITHM`** env var for production rollback (default `true`, R20).

### Closes

- Jira **PYA-14** fully — Phase 1 (instrumentation), Phase 2 (bug fixes Bug A + Bug B), Phase 3 (algorithmic convergence) all shipped.

## ai-provider-model-catalog (unreleased)

### Added

- **Dynamic model catalog per provider** (Anthropic / OpenAI / Groq / xAI): populated automatically via `POST /api/v1/ai/providers/{id}/test_connection/` and refreshable on demand via new `POST /api/v1/ai/providers/{id}/refresh_models/` endpoint.
- **`available_models` and `models_refreshed_at` fields** on `AIProviderConfig` model — persists last-fetched catalog per provider.
- **Frontend dynamic model picker** with empty-state CTA ("Test connection to load available models"), ⭐ recommended badge, stale-model warning, and "Refreshed X ago" relative timestamp.

### Migration

- `0004_add_model_catalog_fields` — additive only (two new nullable/default fields), no data migration required. Reversible.

### NOT closed

- No Jira ticket — user-requested feature, no prior issue.

## pya-14-phase2-seed-type-fix (unreleased)

### Fixed

- **`seed_type` parameter ignored** (`backend/apps/simulations/serializers.py`): The DRF serializer's `create()` method did not lift `parameters.seed_type` from the nested params blob into the top-level model field, so the DRF default `"monomers"` always won. Every simulation requesting `dimers` or `trimers` actually ran with monomers. Now nested wins, top-level falls back as legacy. ⚠️ **Historical impact**: any tunable_cc simulation created before this fix that requested non-monomer seeds actually ran as monomers — the persisted `Simulation.seed_type` shows `"monomers"` while `Simulation.parameters.seed_type` shows the requested value. Re-run if you depend on that data.
- **Ballistic merge_trace `required_distance` always 0.0** (`aglogen_core/engine/src/simulation/tunable_cc.rs`): The ballistic fallback branch hardcoded `required_distance: 0.0` in the trace entry, hiding what the CC formula asked for in the cases that fell back. Now calls `calculate_com_distance` and stores the actual target; degenerate inputs fall back to 0.0 with a stderr warning.

### Fixed (incidental)

- `backend/apps/accounts/migrations/0003_fix_legacy_user_fk.py`: PostgreSQL-only DDL replaced with vendor-aware `RunPython` to unblock SQLite test runner.

### Closes

- Jira **PYA-14**: CC tunable seed_type + ballistic required_distance (Phase 2 — algorithmic fix).

## cc-tunable-merge-trace (unreleased)

### Added

- **Per-step merge diagnostic trace** for CC tunable algorithm. `SimulationResult` and `Simulation.metrics` JSONField gain `merge_trace`: list of dicts with 10 fields per merge step (step, n1, n2, required_distance, actual_distance, rg_after, rg_target, merge_type tunable|ballistic, retries, bounding_check_passed).
- **Drill-down API** returns merge_trace transparently when present (no serializer change needed — `metrics` is JSONField).
- Foundation for PYA-14 Phase 2 (algorithmic fix). The trace lets us choose between Path B "adaptive d" and Path D "smart pair selection" with evidence.

### Changed

- `SimulationResult` (engine) gains `merge_trace: Vec<MergeTraceEntry>` field. Default empty for non-CC algorithms.
- `tasks.py::run_simulation_task` extracts `merge_trace` from engine result into `Simulation.metrics`.
- Python binding (`PySimulationResult`) exposes `merge_trace` as `PyList[PyDict]`.

### Migration

NO migration. Trace lives inside existing JSONField.

### Backward compatibility

- Legacy `Simulation` documents without `merge_trace` in metrics: API returns metrics dict without the key (treat as empty list).
- Existing engine callers without trace handling: receive empty list (never None).
- Storage: ~80 bytes per merge entry × N merges. Document as known overhead for large simulations.

### NOT closed

- Jira **PYA-14** stays OPEN. This cycle is Phase 1 (instrumentation). Phase 2 (algorithmic fix) is a separate cycle that will close the bug.

### Known limitations

- Trace not yet exposed in CSV export. Defer to follow-up.
- No frontend visualisation. Defer to Phase 2.
- For very large N (>1000), trace size grows linearly. Acceptable for current use cases.

## parametric-values-dpo-and-kf (unreleased)

### Added

- **Polidispersión de `dpo` y `target_kf`**: cada uno acepta 3 modos independientes — Determinista (valor fijo, comportamiento actual), Normal (μ, σ con truncado a ±3σ), Uniforme [min, max].
- **`DistributionSelector` reusable component** en frontend con dropdown de modo + inputs condicionales.
- **`DistributionField` DRF custom field** en backend con validación per-mode.
- **`expand_distribution_kwargs` helper** en tasks.py para expandir config de distribución a kwargs del engine.
- **`DpoDistribution` y `TargetKfDistribution` enums** en engine Rust con `.sample(&mut Rng)` method (truncated Normal, retries, mean fallback).
- **Result fields `dpo_used` y `target_kf_used`** propagados engine → binding → backend → API → CSV. Útil para estudios paramétricos.

### Changed

- **`run_tunable_cc` Python binding** acepta 12 nuevos kwargs opcionales (6 por param: mode, value, mean, std, min, max). Cuando ausentes, fallback a scalar legacy.
- **`SimulationSerializer`** acepta `dpo_distribution` y `target_kf_distribution` (opcionales). Validación per-mode.
- **`TunableCcParams`** gana fields `dpo_distribution` y `target_kf_distribution` (Default Fixed con valores legacy → backward compat).
- **`run_tunable_cc_internal`** samples ONCE al inicio del run usando el seeded RNG (reproducibilidad garantizada).

### Migration

No DB migration. Distribution configs viven dentro del JSONField `parameters` de Simulation.

### Backward compatibility

- Payload sin `dpo_distribution` / `target_kf_distribution` → scalar fallback (legacy).
- `mode=fixed` produce resultados bit-for-bit identical al pre-frente-13.
- Result fields `dpo_used` / `target_kf_used` son siempre populated en CC tunable.

### Closes

- Jira **PYA-15**: feature pedido por el usuario para estudios paramétricos.

### Known limitations

- Per-particle polydispersity NO implementada — sampling es monodisperse-per-run (un valor por simulación).
- Polidispersión solo en CC tunable. Otros algoritmos (ballistic, DLA, etc.) que usan radii mantienen dpo determinista.

## fraktal-bisection-ux (unreleased)

### Added

- **3 distinguishable failure categories** for FRAKTAL bisection: `no_sign_change` (limitación física del modelo Granulated 2012), `kf_negative` (resultado no físico), `iteration_limit` (ruido o calidad de imagen).
- **4 quality states** per analyzed image: `converged` 🟢, `approximate` 🟡 (residual 0.1-1.0, Df reportado con warning), `excluded` ⚪ (residual >1.0 o no_sign_change), `failed` 🔴.
- **Per-image diagnostic data** persisted on `FraktalBatchImage`: `bisection_iterations`, `bisection_residual`, `failure_reason`, `df_estimate`, `quality`.
- **Per-batch quality counters**: `n_converged`, `n_approximate`, `n_excluded`, `n_failed` in batch detail response.
- **`mean_df_inclusive`** (and equivalents para kf, rg, npo) — mean computed over converged + approximate.
- **5 new columns in CSV exports** (single-image and batch): `quality`, `bisection_iterations`, `bisection_residual`, `failure_reason`, `df_estimate`. Appended at end (backwards-compatible with parsers that ignore unknown columns). Locale-aware formatting for floats.
- **Frontend `<QualityBadge>`** reusable component (4 colored states).
- **Distinguished drill-down UI** per quality category con mensajes específicos.
- **Quality column** sortable en results table.
- **Yellow overlay** para approximate values en distribution histograms.
- **Dual-mean display**: muestra `mean_df` (primary) + `mean_df_inclusive` (secondary) cuando difieren.
- **Quality count subtitle** en histograms ("X converged · Y approximate").

### Changed

- **`mean_df` semantic shift** (BREAKING para consumidores externos): ahora cuenta SOLO converged. Antes contaba todos los exitosos (lo que ahora sería converged + approximate). Para el comportamiento legacy usar `mean_df_inclusive`.
- **Drill-down detail response** gains 5 new diagnostic fields.
- **Voxel 2018** algorithm también recibe el surfacing pattern (parity con granulated_2012).

### Migration

- `python manage.py migrate fractal_analysis 0011` después del deploy. Additive nullable, reversible. Legacy rows default a `quality="converged"` (asunción optimista).

### Backward compatibility

- Legacy `FraktalBatchImage` rows: 5 nuevos campos NULL/default; CSV exporta vacíos; frontend renderiza como `converged` (sin badge).
- External CSV parsers que ignoran columnas desconocidas siguen funcionando (5 columnas appended at end).
- Engine results sin los 5 campos manejados por backend safety net (`error → quality=failed` override en `persist_batch_results`).

### Closes

- Jira **PYA-13**: FRAKTAL bisección UX (cycle B post-PYA-9). Distinguishes failure categories, allows graceful degradation, exposes diagnostic data.

### Known limitations

- Algorithmic improvements (search range expansion para `no_sign_change` cases) deferred a un futuro cycle.
- Geometric domain limitation del modelo Granulated 2012 permanece: vistas extremas de aggregates planares fundamentalmente fuera del dominio solvable.
- `EXCLUDED_RESIDUAL_THRESHOLD = 1.0` es teórico; puede necesitar tuning empírico post-deploy.
- Per-bucket quality split en histograms implementado a nivel chart-level (subtitle), no per-bucket.

## sintering-cc-fix (unreleased)

### Fixed

- **CC tunable + sintering collapse**: when sintering_coeff < 1.0, the CC tunable algorithm produced single-monomer aggregates (`n_particles=1`, `Rg=0`) regardless of the requested `n_particles`. Three bugs were responsible:
  - `calculate_com_distance` (introduced by frente 10) ignored `sintering_coeff`, so the fractal-law required position fell outside the sintered contact zone and every tunable merge was rejected.
  - `select_contact_particles` used bare contact distance (`r1 + r2`) for validation, applying the same incorrect threshold.
  - `merge_ballistic`'s march step (hardcoded `min_radius * 0.5`) was tuned for the bare contact window and skipped through the narrower sintered snap window — 0/200 ballistic merges succeeded at coeff=0.9.
- All three fixes share the same principle: `rp_eff = rp · sintering_coeff` (linear scaling of contact distance).

### Changed

- `calculate_com_distance` signature gains `sintering_coeff: f64`. Math identity at coeff=1.0 (bitwise-equivalent regression test).
- `merge_ballistic` march step now derives from the snap window width: `step = max(contact_dist · 0.055, min_radius · 0.05)`. Strictly finer than the old 0.5 at coeff=1.0 (no regression).

### Migration

- No DB migration required. `sintering_coeff` was already wired through `Simulation` model and serializer prior to this cycle.

### Backward compatibility

- Aggregates generated with `sintering_coeff=1.0` are bitwise-identical to the frente 10 baseline (verified by `test_sintering_e2e_coeff_1_0_identical_to_baseline` regression test).
- All existing simulation results remain valid.

### Closes

- Jira **PYA-11**: CC tunable + sintering collapses to single sphere.

### Known limitations

- For target Df < 1.8, the iterative-drift caveat from PYA-14 still applies regardless of sintering. This fix only addresses the sintering-specific bug.

## cc-tunable-formula-fix (unreleased)

### Fixed

- **CC tunable Df/kf convergence**: corrected 3 bugs in `calculate_com_distance` (wrong leading factor, single-cluster term, spurious 3/5 constant) that caused systematic bias toward the ballistic limit (Df≈1.91 regardless of target). Empirical pre-fix: target Df=1.6 produced Df 1.87-2.07. Post-fix: convergence within ±5% Df / ±10% kf for Df≥1.8 targets; low-Df targets (1.6) still affected by excessive ballistic fallback (known limitation, needs algorithmic follow-up).

### Added

- **`seed_type` field on Simulation model** with choices `monomers` (default), `dimers`, `trimers`. Configurable via simulation creation form and API.
- **Two-rotation positioning** in CC tunable algorithm (uniform spherical sampling, was single-axis).
- **Retry policy** for geometric merge failures: up to `max_merge_retries` attempts (default 100) with new sub-cluster pair selection per retry; ballistic fallback only after exhaustion.
- **Diagnostic metadata** in simulation result: `tunable_merges`, `ballistic_merges`, `max_retries_per_merge`.

### Changed

- `SeedStrategy::TunablePc` marked `#[deprecated]` (preserved for backward compat with legacy `seed_cluster_size` Python binding callers; new code should use `seed_type` directly).

### Migration

- Run `python manage.py migrate simulations 0006` after deploy. Additive nullable, reversible.

### Backward compatibility

- Existing simulations untouched.
- Legacy API callers without `seed_type` default to `monomers`.
- Legacy Python binding callers via `seed_cluster_size` still work (mapped to `Monomers` via deprecated path).

### Closes

- Jira **PYA-10**: CC tunable does not converge to target Df/kf (formula portion).

### Known limitations

- **Target Df < 1.8**: even with the formula fix, low-Df targets (e.g. Df=1.6) still produce mean Df ≈ 2.0 across all seed types. Diagnostic shows `seed_type=Dimers` raises tunable merge success from 21% to 78%, but Df stays near 2.0 → root cause is iterative invariant drift in `position_clusters_for_contact`, NOT the formula. Tracked separately as Jira **PYA-14**. Workaround until PYA-14 lands: target Df ≥ 1.8 or use a different algorithm.

## fraktal-batch-distributions-and-entry (unreleased)

### Added

- **`rg_nm`** (radius of gyration in nm) on per-image batch results: the engine `BatchImageResult` surfaces `rg_nm` from the underlying `FraktalResult.rg`, the binding exposes it in both `analyze_fraktal_batch` and `analyze_fraktal_batch_per_image_scale`, and the backend persists it on `FraktalBatchImage.rg_nm` (additive nullable migration `0010`).
- **Aggregate stats per metric** in batch detail response: `stats.df`, `stats.kf`, `stats.rg`, `stats.npo` each carry `{mean, std, median, min, max}`. Computed at request time, excludes failed images. Legacy `mean_df`/`std_df`/etc. fields preserved for backward compat.
- **`FraktalBatchDistributions`** component: 4 Plotly histograms (Df, kf, Rg, npo) in a responsive 2×2 grid. Sturges' rule bucket count clamped to [3, 30]. Per-metric "Not enough data" placeholder for < 5 successes; global "No data" card when all images failed. Mounted in `FraktalBatchSummaryPage` between header and table — distributions are now persistent on every revisit (was "fresh-only" before).
- **Rg column** in `FraktalBatchResultsView` (sortable, between kf and R²): format `fmt(rg_nm, 1)` decimals nm, null → "—".
- **"Analyze projections" button** (BarChart3 icon) in `SimulationDetailPage` action bar, visible when `simulation.status === 'completed'`. Click navigates to `/projects/{id}/fraktal/batch?origin=simulation&sim_id={simId}`, finally surfacing the sim-origin Path A pre-fill that frente 8 P5 implemented but left unreachable.

### Changed

- `FraktalBatchPage` (batch upload route) reads `useSearchParams()` and, when `origin=simulation` + `sim_id` are present, fetches the simulation and propagates `origin`/`simulation` props to `FraktalBatchUpload`. Soft fallback to external mode on sim 404 with a warning banner (does NOT block the user).

### Migration

- Run `python manage.py migrate fractal_analysis 0010` after deploy. Additive, nullable, reversible.

### Backward compatibility

- Legacy DB rows without `rg_nm`: API returns `rg_nm: null`; table shows "—"; histograms exclude the row.
- Legacy server responses without `stats.{kf,rg,npo}`: frontend computes stats client-side as fallback.
- External ZIP uploads keep prior behavior — `autocalibrate=ON` default, manual dpo input.

### Closes

- Frente 8 P5 reachability gap (sim-origin Path A pre-fill was implemented but had no UI trigger).
- User-reported "Df distribution disappears when I navigate back" — now persistent in the route-driven summary view.

### Known limitations

- Pure binary 2D projections fed through `input_variants=["scientific"]` may produce `n_particles_counted=1` and identical `rg_nm` across different geometries (engine detector behavior on bypass-Otsu binary inputs). Does NOT affect production pipelines on real projection PNGs. Tracked in engram backlog.

## fraktal-detector-fix (unreleased)

### Added

- **`analysis_input_variant`** field on `FraktalBatchImage`: records whether `"scientific"` or `"presentation"` PNG was fed to the FRAKTAL engine for each image.
- **`origin`** field on `FraktalBatch`: tracks batch provenance (`"simulation"` or `"external"`).
- **`?origin=simulation&sim_dpo_nm=X`** params on batch upload endpoint: sim-origin batches default to `autocalibrate=OFF` with known dpo.
- **Toggle UI** for sim-origin batches in upload form: "Using known dpo = X nm from simulation. Override?"
- **Badge** in drill-down showing analysis input variant ("Scientific (binary)" or "Presentation").

### Changed

- **NMS radius factor 2.0 → 1.0**: resolves packed primaries at delta=1.1 separation that were fused into single peaks.
- **Peak radius via median over ALL peaks** (was top-30%): eliminates upward bias from fused outliers.
- **Detector accepts pre-thresholded scientific PNG as input**: when available, skips Otsu segmentation and uses binary image directly (no AA halo).
- **Sim-origin batches default to `autocalibrate=OFF`**: uses `dpo` from simulation parameters instead of running the detector.

### Migration

- Run `python manage.py migrate fractal_analysis 0008 0009` after deploy.

### Backward compatibility

- Legacy ZIPs without scientific PNGs fall back to presentation (with NMS=1.0 + median, still more accurate than before).
- External ZIP uploads keep `autocalibrate=ON` default.
- Legacy batch rows: `analysis_input_variant` defaults to `"presentation"`, `origin` defaults to `"external"`.

### Closes

- Jira **PYA-9**: FRAKTAL detector dpo overestimation (~2-3x) caused by AA halo + NMS fusion + top-30% selection bias.
- Mitigates **PYA-13** (bisection failures on Df<2 geometries) but does NOT fully resolve — separate cycle pending for graceful degradation.

## projection-scale-and-render-modes (unreleased)

### Added

- **Per-image `pixels_per_100nm`** in `metadata.json`: each projection direction now stamps its own scale computed from the 2D projected bounding box via `compute_2d_bbox` (Rust). Formula: `pixels_per_100nm = (100 * img_size) / (max(bbox_2d_w, bbox_2d_h) * 1.04)`.
- **Dual PNG render**: each direction produces both a presentation PNG (red fill, black edge, alpha 1.0 — aglogen3D MATLAB parity) and a scientific PNG (solid black, no edge, post-render binary threshold `>127→255, ≤127→0`).
- **`?variant=` query param** on PNG endpoint: `GET .../images/{i}/png/?variant=presentation|scientific`. Default is presentation; scientific falls back to presentation when `png_scientific_bytes` is NULL.
- **`has_scientific_png`** flag in drill-down detail response.
- **Frontend toggle UI**: Presentation/Scientific radio buttons in drill-down, disabled when `has_scientific_png=false`.
- Cross-cutting integration test covering full pipeline from ZIP build through PNG variant endpoints.
- User guide at `docs/projection-scale-and-render-modes.md`.

### Changed

- **Presentation render** now matches aglogen3D MATLAB parity: `edgecolor=black` (was `darkred`), `alpha=1.0` (was `0.9`).
- **Celery projection task** reordered: render ALL → measure per-image scale → stamp `metadata.json` ONCE at end. Per-direction inline stamping removed.

### Migration

- Run `python manage.py migrate fractal_analysis 0007` after deploy to add `png_scientific_bytes` column (additive, nullable, no data loss).

### Backward compatibility

- Legacy single-PNG ZIPs and legacy single-scale metadata still work via broadcast + endpoint fallback.
- Existing `FraktalBatchImage` rows have `png_scientific_bytes=NULL` and the endpoint falls back to presentation.

### Closes

- Jira **PYA-8**: rasterizer 1.43× inflation root cause (3D AABB ≠ 2D projected bbox) + per-image scale fix.

## 2026-04-24 — Hotfix: FRAKTAL + Legacy ZIP metadata

### Fixed

- **FRAKTAL single-image from simulation**: the task path previously raised `TypeError: project_to_2d() got an unexpected keyword argument 'resolution'` because the call site passed `resolution=...` / `format="raw"` kwargs that the Rust binding doesn't accept, then tried to read a non-existent `.image` attribute. The path now calls `project_to_2d` with supported kwargs only and rasterizes the geometric projection to a grayscale `uint8` array via a new `_rasterize_projection_to_grayscale` helper — identical shape to what the batch FRAKTAL path feeds the analyzer after PIL decoding.
- **TIFF/BMP preview in FraktalAnalysisForm**: browsers can't natively decode TIFF or BMP, so the old `<img src={blobURL}>` just rendered a broken-image icon. The form now detects the MIME type and shows an informative placeholder (filename, format, size) for non-renderable formats while still accepting them for analysis.

### Changed (additive, backwards-compatible)

- **Projection ZIP exports in legacy mode** now include a `metadata.json` file with `parameters.pixels_per_100nm`, bringing legacy mode to parity with `grid`/`fibonacci` modes for FRAKTAL batch auto-calibration. Existing consumers that iterate PNG files are unaffected — PNG filenames and bytes are preserved (R3).
- **R3 spec clause** softened: `metadata.json` MAY be present in legacy ZIPs as an additive file. Pre-existing parsers that ignore unknown ZIP entries continue to work.

## fraktal-drilldown-and-csv (unreleased)

### Added

- **Drill-down route**: `/projects/{id}/fraktal/batch/{batchId}/image/{index}` — per-image detail with PNG preview, metrics cards, prev/next navigation (← → keyboard shortcuts).
- **Per-image PNG endpoint**: `GET /api/v1/projects/{pk}/fraktal/batches/{batchId}/images/{index}/png/` — streams DB-persisted PNG bytes. `Cache-Control: public, max-age=31536000, immutable`.
- **Re-analyze endpoint**: `POST .../images/{index}/reanalyze/` — creates a persistent `FraktalAnalysis` row from cached PNG + inherited batch dpo (no fresh autocalibrate). Multiple re-analyses create independent rows.
- **Delete batch endpoint**: `DELETE /api/v1/projects/{pk}/fraktal/batches/{batchId}/` — cascade deletes batch + images; any re-analyzed `FraktalAnalysis` rows survive.
- **CSV export (single-image)**: `GET /api/v1/projects/{pk}/fraktal/{analysisId}/csv/` — header + 1 data row, locale-aware (decimal/delimiter from user prefs).
- **CSV export (batch)**: `GET .../batches/{batchId}/csv/` — header + N image rows + blank line + SUMMARY row with mean/std/median/min/max + sim comparison columns. Locale-aware.
- `batch_id` (uuid) added to polling SUCCESS payload (`GET /api/v1/fraktal-status/{job_id}/`).
- `batch_id` added to sync batch 200 response.
- Project-scoped batch endpoint: `POST /api/v1/projects/{pk}/fraktal/analyze-batch/`.
- User guide at `docs/fraktal-drilldown-csv.md`.

### Changed

- **FRAKTAL batch results now DB-backed**: `FraktalBatch` + `FraktalBatchImage` models replace JSON-on-disk (`fraktal_batches/*.json`). Old batch JSON files are no longer written by the Celery task. New batches use DB persistence exclusively.
- **`analyzeBatch` migrated to project-scoped URL**: `POST /api/v1/projects/{pk}/fraktal/analyze-batch/` (old global URL still works but is deprecated).
- **Polling response gains `batch_id`**: on `status: "done"`, the payload includes `batch_id` (uuid) and `results_url` pointing at the DB-backed batch detail endpoint.
- **csv_locale helpers hoisted to `apps/core/services/`**: `get_user_csv_locale` and `write_localized_row` moved from `apps/simulations/views.py` to `apps/core/services/csv_locale.py`. Backward-compatible aliases remain.

### Deprecated

- **`var/batch_results/` JSON-on-disk directory**: no longer written. Manual cleanup recommended after confirming no in-flight jobs reference old files.

### Migration notes

- Run `python manage.py migrate fractal_analysis` after deploy to create `FraktalBatch` and `FraktalBatchImage` tables.

## fraktal-batch-analysis (unreleased)

### Added

- **Batch FRAKTAL analysis** — upload a projection ZIP, analyze all images at once.
- **Auto-calibration** from `metadata.parameters.pixels_per_100nm` when the ZIP comes from the pyaglogen3D projection export. Automatic fallback to manual scale for legacy/external uploads.
- **One-shot dpo** autocalibrate: analyze image[0] once, reuse for all N images (with image[N/2] retry on failure). Saves 4× Rust calls.
- **Async execution** for N > 30 images via Celery, with per-stage progress reporting (autocalibrate → analyzing → aggregating).
- **Results UI**: batch summary card, sortable per-image table, Df histogram (Freedman-Diaconis ≥10, Sturges 5–9, hidden <5), Sorensen comparison card linking FRAKTAL batch mean Df + simulation target_df + simulation 3D box-counting Df.
- **Comparison card** auto-links ZIP filename (`{uuid}_projections.zip`) to the source Simulation; manual `sim_id` override supported.
- New endpoints:
  - `POST /api/v1/fraktal/analyze-batch/` (multipart ZIP)
  - `GET /api/v1/fraktal-status/{job_id}/` (polling)
  - `GET /api/v1/fraktal-status/{job_id}/results/` (download)
- New Rust module `aglogen_core::fractal::fraktal::batch` with `analyze_batch` orchestrator.
- New Python binding `aglogen_core.analyze_fraktal_batch`.
- New component `FraktalBatchUpload` with client-side metadata detection via JSZip.
- New component `FraktalBatchResultsView` with Plotly histogram.
- New component `FraktalComparisonCard` with fixed Sorensen 1992 note.
- New routes: `/projects/{id}/fraktal/batch` and `/projects/{id}/fraktal/batch/{jobId}`.
- CTA link on the single-image FRAKTAL page.
- User guide at `docs/fraktal-batch.md`.

### Unchanged

- Legacy single-image FRAKTAL endpoint and UI — byte-for-byte backwards compatible.

### Dependencies

- Frontend: `jszip ^3.10.1` (client-side metadata pre-parse).

## projections-export-fix (unreleased)

### Added

- **Grid mode** — uniform azimuth × elevation sampling with automatic pole deduplication. Emits exactly `n_az * (n_el − 2) + 2` projections.
- **Fibonacci lattice mode** — exact N uniform projections via golden-angle spiral. Mathematically optimal sphere coverage.
- **metadata.json** inside every export ZIP with per-projection `{index, filename, azimuth, elevation}` records.
- **Async Celery path** for N > 200 projections: endpoint returns `202 {job_id}`, frontend polls `/projections-status/{job_id}/` and downloads when ready.
- User guide at `docs/projections-export.md`.

### Changed — silent projection drops FIXED

- The old export silently emitted fewer projections than the UI promised (e.g., "generate 24" but ZIP contained 19). Root cause: a half-baked pole dedup in `projection/mod.rs` only fired when elevations landed exactly on ±90° AND skipped non-first azimuths — partial, fragile, and mismatched with the UI count formula.
- Fix: dedicated `generate_direction_grid` (Rust) with correct pole math + frontend preview formula that matches backend output exactly.

### Fixed

- Matplotlib figure leak risk in large batches (N > 200) — single rendering helper with `plt.close(fig)` in `finally`.

### Infrastructure

- New Rust module `aglogen_core::projection::directions` with `Direction` struct + `generate_grid` + `generate_fibonacci`.
- Python bindings: `aglogen_core.generate_direction_grid(n_az, n_el)`, `aglogen_core.generate_direction_fibonacci(n)`, `aglogen_core.project_directions(coords, radii, directions)`.
- Backend service `apps.simulations.services.projections` (pure Python) for ZIP + metadata assembly.
- Endpoints: extended `POST /projection/batch/` with `mode` dispatch; new `GET /projections-status/{job_id}/` polling + `/projections-status/{job_id}/download/` streaming.
- Celery task `build_projections_zip_task` with progress reporting every 10 projections.
- 50 new tests: 7 Rust unit (directions.rs), 28 backend (services + integration + polling), 20 frontend (ProjectionControls + api polling).

## visualize-multiple (unreleased)

### Added

- **Compare multiple aggregates** — new `/projects/[id]/compare?sims=...` route
- **Checkbox selection** on project page simulation list (2–9 sims) + sticky "Compare" button
- **Grid mode** (default): responsive grid of 3D viewers (1×2 → 3×3) with synchronised cameras
- **Overlay mode**: all aggregates merged into single scene with CoM alignment + distinct colors
- **Synchronised cameras**: rotating one viewer rotates all (toggle to independent)
- **Metrics comparison table**: Df / Kf / Rg (nm) / N particles / Algorithm per sim
- **Multi-series Rg evolution chart**: log-log, one series per sim, missing data noted
- **Deterministic color palette** (Tableau10) assigned by sorted sim ID
- **Missing-sim banner** for 404/403 sims in shared URLs (renders survivors)
- **Processing banner** for sims whose geometry is still being computed
- `docs/visualize-multiple.md` user guide

### Changed

- `viewerStore.ts` — camera state scoped by key (`"single"` default + compare session scopes), preserving single-sim backwards compat via write-through mirror
- `Particles.tsx` — new optional `uniformColor` prop (default preserves existing behavior)
- `AgglomerateViewer.tsx` — new optional `colorOverride` + `cameraSource` props
- `RgEvolutionChart.tsx` — accepts alternative `series` prop shape for multi-series rendering (single-series API unchanged)

### Infrastructure

- New `frontend/src/components/compare/` module (7 files + tests)
- New `frontend/src/lib/compare-utils.ts` with palette, layout, URL parse helpers
- 53 new frontend tests (73 → 126)
# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to conventional commits.

## import-aggregate (unreleased)

### Added
- **"Import Aggregate" button** on project pages — top-level action alongside "New Simulation".
- **MATLAB `.mat` importer** (single-agglomerate, v7 or earlier). Multi-agglomerate files rejected.
- **CSV metadata lines**: `#key=value` preamble for unit, source, explicit diameter, generated_at.
- **CSV locale auto-detection**: decimal (`.`/`,`) and delimiter (`,`/`;`) detected from first 5 data rows. Manual override in upload dialog.
- **CSV export locale preferences**: new fields on user profile (Settings → CSV Export Preferences).
- **`radius_nm` column** on CSV exports, alongside existing (unitless) `radius`.
- `docs/import-aggregate.md` user-facing guide.

### Changed — IMPORT METRICS CORRECTNESS
- **CSV/MATLAB imports** now compute fractal dimension via **box-counting**, not via the CSV row order power-law fit. The previous implementation silently used deposition order — unreliable for static geometries. **Historical imports will have stale/incorrect `fractal_dimension` values until re-computed.** A `recompute metrics` action is out of scope for this release.
- Imports now stamp `parameters.primary_particle_diameter_nm` (honoring the `rg-unit-contract` from verify-rg). CSV exports of imports use the correct diameter instead of silently defaulting to 25 nm.
- `.dat` file extension explicitly rejected on upload with a clear error (previously they would be parsed as plain text and produce garbage metrics).
- Minimum particles for box-counting Df: **50**. Below this, `fractal_dimension` is `null` with a note.

### Removed
- `metrics.sequential_df` / `metrics.sequential_kf` / `metrics.rg_evolution` for imported simulations (order-dependent, misleading for static data).

### Tests
- Backend: +36 tests (CSV contract, box-counting fixtures, .mat parser, locale import/export). Total 83 simulation tests.
- Frontend: +22 tests (csv-locale lib, ImportAggregateDialog). Total 57 frontend tests.
- Engine: unchanged at 165.

## verify-rg (unreleased)

### Changed — UNIT CONVENTION UPDATED (observable to all users)

- Rg values displayed in the UI and CSV exports are now in **nm**, scaled
  from the dimensionless engine value by `primary_particle_diameter_nm / 2`.
- CSV exports: single-sim export uses `Unit = "nm"` (was `"particle radii"`);
  batch export renames the `Rg` column to `Rg_nm`.
- Simulations previously displayed had Rg at **2×** the correct nm value
  due to a long-standing naming bug (field called "radius" stored as diameter).
  **Stored data is unchanged**; only the display scaling is corrected.

### Added

- `parameters_schema_version` field on `Simulation.parameters` (`"v1"` legacy,
  `"v2"` current). Read-side shim handles both; writes always use `v2`.
- UnitConventionBanner on simulation detail and project list pages for
  legacy (v1) simulations. Dismissable per-user.
- `docs/unit-convention.md` — contributor reference.

### Fixed

- Rg display inconsistency across 5 surfaces (detail page, project page,
  AI sidebar, batch table, evolution chart).
- RgEvolutionChart axis label now reads `log10(Rg/nm)` (was `log10(Rg)`).

### Tests

- 5 engine Rg correctness tests (scaling, translation, dimer, chain, hex).
- 25 Python shim + 32 TypeScript shim tests (byte-for-byte parity).
- 6 serializer + 3 tasks.py mapping + 4 CSV export integration tests.
- 6 UnitConventionBanner component tests.

Total: ~81 new tests.
