# Proposal: Batch CC Tunable — Parameter Grid Parity

## Intent

The batch (ParametricStudy) form only exposes scalar grid parameters (n_particles, target_df, target_kf). The single-sim form offers kf distribution, particle radius/polydispersity, sintering distribution, and seed type — but none of these can be varied across a batch. A student doing their TFM reported this gap. This change adds the 4 missing parameters to the batch parameter_grid, achieving feature parity with the single-sim CC tunable form. It also fixes latent bug #634 (batch `create_simulation()` ignores seed_type model field).

## Scope

### In Scope
1. **4 new `parameter_grid` keys**: `kf_distribution`, `particle_radius_config`, `sintering_config`, `seed_type` — accepted in grid validation and task expansion
2. **Backend task expansion**: extract distribution objects and seed_type from grid, pass to child sim params / model field
3. **Fix bug #634**: `create_simulation()` in `views.py:1784-1792` must pop `seed_type` from params and set it on the Simulation model
4. **Frontend batch form**: 4 new "parameter to vary" dropdown options + appropriate input UI per type
5. **Extract `<DistributionGridInput>`**: wraps N `<DistributionSelector>` instances with add/remove for batch grid entries
6. **UX safety**: warn when projected batch size > 200, hard cap at 1000
7. **Tests**: serializer validation, task expansion, seed_type model field, DistributionSelector grid, batch form integration

### Out of Scope
- New distribution types beyond fixed/uniform/normal
- Generic distribution support for arbitrary other params (target_df, target_kf scalar)
- Backend-side distribution sampling (engine does it natively per #633)
- Migration of historical batches (backward compat: missing keys = old behavior)
- Engine changes (none needed)
- F4 batch stats — separate cycle

## Capabilities

### New Capabilities
- None (no new standalone spec files — this extends existing batch + CC tunable behavior)

### Modified Capabilities
- `cc-tunable-aggregation`: R17 (seed_type routing) now applies to batch-created sims — `create_simulation()` must set the model field from grid or base_parameters. Delta: batch seed_type handling.

## Approach

**Backend (~80 lines + tests)**:
- Add `validate_parameter_grid()` to `ParametricStudySerializer` — type-check new keys (distribution objects, seed_type enum) while preserving backward compat with scalar arrays
- Modify `create_simulation()` in `views.py`: pop `seed_type` from `sim_params` → pass as model kwarg (fixes #634); handle distribution objects passed through to child params
- Handle sintering grid override: if grid combo has `sintering_config` entry → skip study-level `apply_sintering_config` for that combo

**Frontend (~200-300 lines + tests)**:
- Create `<DistributionGridInput>` — N rows of `<DistributionSelector>` with add/remove
- Wire into `BatchSimulationForm`: distribution params → `DistributionGridInput`; seed_type → multi-select chips
- Combinatorial size warning toast when total > 200

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/apps/simulations/serializers.py:255-384` | Modified | Add `validate_parameter_grid` for new key shapes |
| `backend/apps/simulations/views.py:1761-1802` | Modified | `create_simulation()` — seed_type model field + distribution passthrough + sintering grid override |
| `frontend/src/components/batch/BatchSimulationForm.tsx` | Modified | New dropdown options + input modes for distribution/seed_type grid entries |
| `frontend/src/components/forms/DistributionGridInput.tsx` | New | Array-of-distributions input component |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Sintering grid override complexity — study-level vs grid-level precedence | Med | Document precedence rule in spec: grid entry overrides study-level per combo |
| Combinatorial explosion (1000+ sims) | Low | UX warning at >200, hard cap at 1000 |
| Latent bug #634 fix scope creep | Low | Fix is 3-line change inside the same function being modified; document in CHANGELOG |

## Rollback Plan

No DB migration. Revert merge commit. Existing batches without new keys behave identically. Bug #634 fix is independent and could be split as a hotfix if needed.

## Dependencies

- Existing `<DistributionSelector>` component (129 lines, already standalone)
- Engine samples distributions internally (#633) — no engine changes needed

## Success Criteria

- [ ] Batch form has 4 new "parameter to vary" options
- [ ] Grid like `kf_distribution: [normal(1.2,0.05), normal(1.3,0.05)] × seed_type: [dimers, trimers]` → correct child sims
- [ ] Each child sim has correct params + correct seed_type model field
- [ ] Warning shown when total sim count > 200
- [ ] All tests green, no regressions
- [ ] Historical batches still work (backward compat)
