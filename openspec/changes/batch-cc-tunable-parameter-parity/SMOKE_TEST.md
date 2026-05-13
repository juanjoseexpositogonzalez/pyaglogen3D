# Smoke Test — batch-cc-tunable-parameter-parity

## Pre-conditions

- Deploy backend + frontend (no DB migration needed)
- Have at least one project with a parametric study available

## Steps

### Step 1: Create a batch via UI with new grid keys

1. Navigate to the parametric study form
2. Add `kf_distribution` with two entries: `normal(1.2, 0.05)` and `normal(1.4, 0.05)`
3. Add `seed_type` with two entries: `dimers` and `trimers`
4. Set `seeds_per_combination: 3`
5. Submit the batch

**Expected**: 12 child simulations created (2 kf × 2 seed_type × 3 seeds)

### Step 2: Verify projected sim count indicator

Before submitting in Step 1, check the batch form UI.

**Expected**: "Projected simulation count" indicator shows **12**

### Step 3: Inspect a child simulation

Open any child sim from the batch created in Step 1.

**Expected**:
- `seed_type` field is set to either "dimers" or "trimers" (NOT defaulted to "monomers")
- `parameters.kf_distribution` is a single distribution object (e.g. `{type: "normal", mean: 1.2, std: 0.05}`)

### Step 4: Hard reject at >1000 projected sims

```bash
curl -X POST /api/v1/projects/{p}/studies/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "overflow-test",
    "base_parameters": { ... },
    "parameter_grid": {
      "target_df": [1.8, 1.9, 2.0, 2.1, 2.2],
      "target_kf": [1.2, 1.3, 1.4, 1.5, 1.6],
      "seed_type": ["monomers", "dimers", "trimers"],
      "kf_distribution": [
        {"type": "normal", "mean": 1.2, "std": 0.05},
        {"type": "normal", "mean": 1.4, "std": 0.05},
        {"type": "uniform", "min": 1.0, "max": 1.5}
      ]
    },
    "seeds_per_combination": 5
  }'
```

**Expected**: HTTP 400 with clear error message about exceeding 1000 projected simulations (5 × 5 × 3 × 3 × 5 = 1125)

### Step 5: Warning at >200 projected sims

```bash
curl -X POST /api/v1/projects/{p}/studies/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "warning-test",
    "base_parameters": { ... },
    "parameter_grid": {
      "target_df": [1.8, 1.9, 2.0, 2.1, 2.2],
      "target_kf": [1.2, 1.3, 1.4, 1.5, 1.6]
    },
    "seeds_per_combination": 10
  }'
```

**Expected**: HTTP 201 (created) with a `warning` field in the response body indicating >200 projected simulations (5 × 5 × 10 = 250)

### Step 6: Backward compatibility — old keys only

```bash
curl -X POST /api/v1/projects/{p}/studies/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "backward-compat-test",
    "base_parameters": { ... },
    "parameter_grid": {
      "target_df": [1.8, 2.0],
      "target_kf": [1.2, 1.4]
    },
    "seeds_per_combination": 2
  }'
```

**Expected**: HTTP 201, identical behavior to pre-cycle. No warnings, no new fields in response. 8 child sims created (2 × 2 × 2 seeds).
