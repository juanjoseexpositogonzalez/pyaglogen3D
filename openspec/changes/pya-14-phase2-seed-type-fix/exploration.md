# Exploration: PYA-14 Phase 2 — seed_type fix + ballistic required_distance

## Intent

Phase 1 of PYA-14 shipped `merge_trace` instrumentation (archived 2026-05-07), which revealed two bugs that invalidate all prior empirical data comparing seed types. **Bug A** (CRITICAL): the DRF serializer ignores `seed_type` sent by the frontend because it arrives nested inside `parameters` but the serializer only reads it as a top-level field — every simulation requesting dimers/trimers actually ran with monomers. **Bug B**: the ballistic fallback path in the merge trace always records `required_distance: 0.0` instead of computing the power-law target distance, hiding what the algorithm *would have needed* to place clusters via the tunable path. This phase fixes both bugs so we can re-run the seed-type comparison experiments with confidence.

## Bugs

### Bug A — `seed_type` parameter ignored (CRITICAL)

**Root cause**: The frontend (`SimulationForm.tsx:711`) packs `seed_type` inside `algorithmParams`, which becomes `parameters` in the API payload (line 762). The DRF serializer (`serializers.py:41-50`) declares `seed_type` as a top-level field with `default="monomers"`. The `create()` method (lines 97-143) processes `parameters` for other lifts (distribution configs at lines 102-114, schema version at lines 125-141) but **never extracts** `params["seed_type"]` to `validated_data["seed_type"]`. DRF therefore uses the default `"monomers"` every time.

The task layer (`tasks.py:1399`) reads `simulation.seed_type` (the model field, always "monomers") and passes it to the engine. The engine works correctly — it just never receives the right value.

**Evidence**: `serializers.py:97-143` has no mention of `seed_type` inside `create()`. The frontend sends `{parameters: {seed_type: "dimers", ...}}` but the serializer creates the model with `seed_type="monomers"`.

**Fix sketch** (3 lines in `serializers.py:create()`, after distribution lift at line 114):
```python
# Lift seed_type from nested parameters to top-level model field.
params = validated_data.get("parameters")
if isinstance(params, dict) and "seed_type" in params:
    validated_data["seed_type"] = params.pop("seed_type")
```

**Other algorithms NOT affected**: grep confirms `seed_type` is exclusive to `tunable_cc` — no other algorithm (ballistic_cc, dla, fracval, box_rfa, gcca, cca) references it.

### Bug B — Ballistic path doesn't populate `required_distance`

**Root cause**: In `tunable_cc.rs:1121-1135`, the ballistic fallback merge trace entry hardcodes `required_distance: 0.0` with the comment "no power-law target". But the ballistic fallback happens *because* the tunable path failed — there WAS a target distance; it just couldn't be achieved. The `calculate_com_distance` function can still be called with the same `(n1, n2, rp, df, kf, sintering_coeff)` to record what the algorithm was *trying* to achieve before falling back.

**Evidence**: Line 1128: `required_distance: 0.0` — hardcoded zero. The tunable path (line 1061) correctly populates `required_distance` from `calculate_com_distance`.

**Fix sketch**: In the ballistic fallback block (around line 1098-1101), call `calculate_com_distance(ballistic_n1, ballistic_n2, rp, df, kf, sintering_coeff)` and store the result (or 0.0 if `None`) as `required_distance` in the trace entry. Note: the ballistic fallback picks a **fresh random pair** (lines 1083-1086), different from the last failed tunable attempt, so we must compute required_distance for THIS pair specifically.

## Code Locations

### Bug A — serializer seed_type lift

| File | Lines | Role |
|------|-------|------|
| `backend/apps/simulations/serializers.py` | 41-50 | `seed_type` field declaration (top-level, default "monomers") |
| `backend/apps/simulations/serializers.py` | 97-143 | `create()` — **missing seed_type lift** (insert after line ~114) |
| `backend/apps/simulations/models.py` | 80-89 | `seed_type` CharField on model (correct) |
| `backend/apps/simulations/tasks.py` | 1399, 1424 | Reads `simulation.seed_type` and passes to engine (correct) |
| `frontend/src/components/forms/SimulationForm.tsx` | 711 | Packs `seed_type` into `algorithmParams` (nested inside `parameters`) |
| `frontend/src/components/forms/SimulationForm.tsx` | 759-764 | `onSubmit()` sends `{name, algorithm, parameters, seed}` — no top-level `seed_type` |

### Bug B — ballistic required_distance

| File | Lines | Role |
|------|-------|------|
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | 1080-1142 | Ballistic fallback block — hardcodes `required_distance: 0.0` at line 1128 |
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | 339-365 | `calculate_com_distance()` — needs to be called for the ballistic pair too |
| `aglogen_core/engine/src/simulation/tunable_cc.rs` | 1057-1068 | Tunable trace entry — correctly populates `required_distance` |
| `aglogen_core/engine/src/simulation/result.rs` | 1-29 | `MergeTraceEntry` struct definition (no change needed) |

## Test Gaps

### Bug A — serializer seed_type lift

- **`test_seed_type.py:TestSeedTypeSerializer`** (lines 92-162): Tests serializer with `seed_type` as a **top-level** field in the payload. This path works because DRF maps it directly. **NO test sends `seed_type` nested inside `parameters`**, which is the actual frontend path.
- **Missing test**: `test_serializer_lifts_seed_type_from_parameters` — send `{algorithm: "tunable_cc", parameters: {n_particles: 100, seed_type: "dimers"}, seed: 42}` (NO top-level seed_type), assert `sim.seed_type == "dimers"`.
- **Missing test**: `test_serializer_pops_seed_type_from_params` — after lift, `seed_type` should be removed from `simulation.parameters` dict (it's a model field, not a parameter).
- **Missing test**: `test_serializer_top_level_still_works` — backward compat: sending top-level `seed_type` (without nested) still works (existing tests already cover this, but worth an explicit note).

### Bug B — ballistic required_distance

- **`integration_cc_tunable.rs:ballistic_fallback_flagged`** (line 3059): Asserts ballistic entries exist and have `bounding_check_passed=false`, but **does NOT assert** `required_distance > 0.0`.
- **Missing test**: A test that forces ballistic merges (low Df, few retries) and asserts every ballistic entry has `required_distance > 0.0` (or `>= 0.0` if `calculate_com_distance` returns `None` for degenerate pairs).
- **No Python-side test** for merge_trace ballistic entries — `test_merge_trace_persistence.py` tests the persistence plumbing but doesn't assert field values for ballistic entries specifically.

## Validation Plan

After both fixes are deployed:

1. **Unit test**: Run the new serializer test confirming nested `seed_type` is lifted.
2. **Unit test**: Run the new Rust test confirming ballistic `required_distance > 0`.
3. **Regression**: Run all existing test suites (`pytest` backend, `cargo test` engine).
4. **Empirical re-run**: Execute one controlled experiment:
   - **Baseline**: Df=1.8, kf=1.3, N=350, `seed_type=monomers`, 5 seeds → record mean Df, merge_trace stats
   - **Treatment**: Same params, `seed_type=dimers`, 5 seeds → record mean Df, merge_trace stats
   - **Verify**: The two sets should show *different* Df distributions (pre-fix they would have been identical since both ran as monomers)
   - **Verify**: Ballistic entries in merge_trace now have `required_distance > 0.0`
5. **Spot-check**: Confirm `seed_type=trimers` via API and verify `simulation.seed_type` in DB is "trimers" (not "monomers").

## Risks

### R1 — Backward compatibility for seed_type lift (LOW)
The lift logic uses `params.pop("seed_type")` which also removes it from the `parameters` JSON dict. If any downstream code reads `simulation.parameters["seed_type"]`, it would break. **Mitigation**: grep confirms no code reads `parameters["seed_type"]` — the task layer reads `simulation.seed_type` (the model field). The frontend reads from the serializer's `seed_type` output field. Safe to pop.

### R2 — Top-level vs. nested priority (LOW)
If a caller sends BOTH top-level `seed_type` and `parameters.seed_type`, which wins? Current design: DRF processes top-level first (into `validated_data`), then `create()` would overwrite with nested. **Decision needed**: nested should win (it's the intentional value), or top-level should take priority? Recommendation: nested wins (the frontend's actual path), and the top-level field acts as a fallback default.

### R3 — calculate_com_distance returns None for ballistic pair (LOW)
For the ballistic path, `calculate_com_distance` might return `None` (e.g., `d^2 <= 0`). The fix should handle this gracefully by storing `0.0` when `None` (keeping the current behavior for the degenerate case). This is a documentation/semantic question, not a correctness issue.

### R4 — Historical data invalidation (INFORMATIONAL)
All prior simulations labeled `seed_type=dimers` or `seed_type=trimers` actually ran as monomers. The `seed_type` field in the DB is correct (it was set by DRF default), but the **user's intent** was different. Post-fix, we cannot retroactively fix historical data — users need to re-run affected simulations. Consider adding a migration note or admin notification.

## Open Questions

1. **Priority of top-level vs. nested `seed_type`**: When both are present, should nested (from `parameters`) win? Recommendation: yes — the nested value is the user's explicit choice from the form. The top-level field exists for DRF schema but the frontend never sends it there.

2. **Should we add a frontend fix too?** The frontend could be changed to send `seed_type` as a top-level field alongside `parameters` (matching the serializer declaration). This is a cleaner long-term solution but requires frontend + API coordination. **Recommendation**: fix the backend lift NOW (immediate fix, 3 lines), and optionally update the frontend in a follow-up to send it top-level too (defense in depth).

3. **Historical data**: Should we flag affected simulations in the DB? E.g., a migration that sets a boolean `seed_type_was_mislabeled=True` on simulations where `algorithm="tunable_cc"` AND `parameters->>"seed_type" != seed_type`? This helps users identify which results need re-running. **Recommendation**: defer to user — this is a data management decision, not a code bug.

## Affected Areas

- `backend/apps/simulations/serializers.py` — Bug A fix (seed_type lift in `create()`)
- `backend/apps/simulations/tests/test_seed_type.py` — New test for nested seed_type path
- `aglogen_core/engine/src/simulation/tunable_cc.rs` — Bug B fix (ballistic required_distance)
- `aglogen_core/engine/tests/integration_cc_tunable.rs` — New test for ballistic required_distance assertion

## Recommendation

Both fixes are well-scoped, low-risk, and independently verifiable. The serializer fix is 3 lines; the Rust fix is ~5 lines (call `calculate_com_distance` + unwrap-or-default). Proceed directly to **proposal** → **spec** → **tasks** → **apply**. No architecture decisions or alternative approaches needed — these are straightforward bug fixes with clear root causes.

## Ready for Proposal

Yes. Both bugs are root-caused, fixes are sketched, test gaps are identified, and risks are documented. The next phase should produce the proposal with both fixes bundled as a single change.
