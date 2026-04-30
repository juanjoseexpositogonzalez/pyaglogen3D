# Proposal: FRAKTAL Detector Fix (Cycle 8 / PYA-9)

## Intent

The FRAKTAL autocalibrate detector overestimates dpo by ~2-3x (measured: dpo_used=54.6nm vs real 25nm = 2.18x multiplier). Three compounding sources: (1) anti-aliased halo in presentation PNG inflates particle edges, (2) NMS radius=2.0 fuses adjacent peaks into fewer, larger clusters, (3) top-30% peak selection biases toward outliers. Result: Df saturates at ~2.0, ~50% of images fail bisection (17/31 successes in empirical test). This produces invalid scientific results.

## Scope

### In Scope

- **Engine**: NMS radius 2.0 -> 1.0; ALL-peaks median replaces top-30% selection; accept threshold-pre-binarized scientific PNG as detector input
- **Backend**: batch task uses scientific PNG (`png_scientific_bytes`) when available, falls back to presentation PNG for legacy rows; default `autocalibrate=OFF` for batches originating from simulation
- **Frontend**: differentiated upload UX for batch-from-sim vs batch-from-external-zip; manual dpo input shown when `autocalibrate=OFF`, pre-filled with `sim.parameters.dpo` for sim batches
- **Tests**: integration test with synthetic projection of known geometry (dpo=25nm at 80px/100nm -> expected radius 10px +/-10%)

### Out of Scope

- PYA-13: bisection UX improvements (search range expansion, differentiated errors, graceful degradation, "no analizable" badge, Df aproximado con warning) -- separate Cycle B
- PYA-10 + PYA-11: CC tunable algorithm bugs -- separate cycle
- MATLAB-equivalent rewrite of detector -- Rust autocalibrate kept as feature, just fixed

## Capabilities

### New Capabilities

None

### Modified Capabilities

- `fraktal-batch-contract`: R-DELTA -- detector input now accepts scientific PNG; autocalibrate default depends on batch origin (sim -> OFF, external ZIP -> ON)
- `fraktal-batch-persistence`: R-DELTA -- drill-down detail returns `analysis_input_variant: "presentation" | "scientific"` indicating which PNG was used for analysis

## Approach

6 phases, bottom-up (engine -> backend -> frontend):

| Phase | Description | Depends on |
|-------|-------------|------------|
| P1 | Engine: NMS radius 2.0->1.0 + ALL-peaks median + cargo tests | -- |
| P2 | Engine: accept binary-thresholded image input + cargo tests | -- |
| P3 | Backend: batch task selects scientific PNG when available + per-image variant tracking + pytest | P1, P2 |
| P4 | Backend: autocalibrate default logic (sim->OFF, zip->ON) + serializers + pytest | -- |
| P5 | Frontend: upload UX differentiation + manual dpo input + vitest | P3, P4 |
| P6 | Integration tests + docs + CHANGELOG + Jira PYA-9 close | P1-P5 |

P1, P2, P4 are independent (can parallelize). P3 needs P1+P2. P5 needs P3+P4. P6 is tail.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/image_processing.rs` | Modified | NMS radius 2.0->1.0; ALL-peaks median |
| `aglogen_core/engine/src/fraktal/` | Modified | Accept pre-binarized input; skip threshold when input is already binary |
| `backend/apps/fractal_analysis/tasks.py` | Modified | Select scientific PNG; track `analysis_input_variant`; autocalibrate default by batch origin |
| `backend/apps/fractal_analysis/serializers.py` | Modified | Expose `analysis_input_variant` in drill-down |
| `frontend/src/components/fraktal/` | Modified | Differentiated upload UX; manual dpo input when autocalibrate=OFF |
| `aglogen_core/engine/tests/` | New | Integration test with synthetic geometry |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| NMS 1.0 changes scientific results for existing batches | High (all re-runs) | Integration test validates accuracy. Document: re-running prior batches produces slightly different (more accurate) results. |
| Default autocalibrate=OFF for sim batches is UX change | Medium | UI surfaces clearly: "Using known dpo = X nm from simulation. Override?" |
| Scientific PNG fallback for legacy rows | Low | Legacy rows without `png_scientific_bytes` use presentation PNG silently. Document bias for legacy batches. |
| Empirical validation gap | Medium | Pre-fix: 17/31 successes. Target post-fix: >25/31. Remaining failures are model domain limitation (PYA-13 scope). |

## Rollback Plan

1. Engine: revert NMS radius to 2.0 and restore top-30% selection -- two constants.
2. Backend: revert autocalibrate default to ON unconditionally; remove variant tracking from serializer.
3. Frontend: revert upload UX to single mode; hide manual dpo input.

All changes are parameter/logic toggles -- rollback is safe at any phase boundary.

## Dependencies

- Cycle 7 (projection-scale-and-render-modes) MUST be complete: scientific PNG fields and `png_scientific_bytes` column must exist. (Already shipped.)

## Success Criteria

- [ ] Synthetic geometry test: detector output within +/-10% of known dpo (25nm at 80px/100nm -> radius 10px)
- [ ] NMS uses radius 1.0 and ALL-peaks median (no top-30% selection)
- [ ] Batch task uses scientific PNG when `png_scientific_bytes IS NOT NULL`
- [ ] Batches from simulation default to `autocalibrate=OFF` with `sim.parameters.dpo` as manual default
- [ ] Frontend shows differentiated UX for sim-originated vs external-zip batches
- [ ] `analysis_input_variant` exposed in drill-down response
- [ ] All test suites green: `cargo test`, `uv run pytest`, `npm test`
