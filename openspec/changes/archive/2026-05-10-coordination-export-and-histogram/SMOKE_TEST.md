# Smoke Test: coordination-export-and-histogram

## Pre-conditions

- Backend deployed (no migration needed — JSONField is additive)
- At least one legacy simulation exists (pre-deploy, has only `{mean, std}` in coordination)

---

## Step 1: Verify new metrics on fresh simulation

Create a new simulation (UI or API), wait for completion.

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.pyaglogen3d.com/api/v1/projects/$PROJECT_ID/simulations/$SIM_ID/ \
  | jq '.metrics.coordination'
```

**Expected**: JSON object with 6 fields:
```json
{
  "mean": 1.33,
  "std": 0.47,
  "per_particle": [
    {"particle_id": 0, "n_contacts": 1, "contact_neighbors": [1]},
    ...
  ],
  "distribution": {"0": 0, "1": 2, "2": 1},
  "threshold_strategy": "unified_r_sum_with_tolerance",
  "tolerance": 0.01
}
```
- `per_particle` array length == N (number of particles)
- `sum(distribution.values()) == N`
- `threshold_strategy` == `"unified_r_sum_with_tolerance"`
- `tolerance` == `0.01`

---

## Step 2: Per-simulation CSV export

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.pyaglogen3d.com/api/v1/projects/$PROJECT_ID/simulations/$SIM_ID/export/ \
  -o sim_export.csv
```

**Verify**:
- File contains `# section: coordination_per_particle` header row
- Followed by `particle_id,n_contacts,contact_neighbors` header
- Followed by N data rows (one per particle)
- File contains `# section: coordination_distribution` header row
- Followed by `coordination,count` header
- Followed by data rows (one per coordination number 0..max)

```bash
grep "# section: coordination" sim_export.csv
# Expected:
# # section: coordination_per_particle
# # section: coordination_distribution
```

---

## Step 3: Parametric study batch CSV export

Create a parametric study with ≥2 completed simulations.

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.pyaglogen3d.com/api/v1/projects/$PROJECT_ID/studies/$STUDY_ID/export/ \
  -o batch_export.csv
```

**Verify**:
- Header row contains `Coord_Mode` and `Coord_Max` columns (appended at end)
- Each data row has values in those columns
- `Coord_Mode` = most common coordination number (smallest if tie)
- `Coord_Max` = highest coordination number observed

```bash
head -1 batch_export.csv | tr ',' '\n' | grep -n Coord
# Expected:
# N:Coord_Mean
# N+1:Coord_Std
# N+2:Coord_Mode
# N+3:Coord_Max
```

---

## Step 4: Legacy simulation compatibility

Fetch a simulation that was created **before** this deploy:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.pyaglogen3d.com/api/v1/projects/$PROJECT_ID/simulations/$LEGACY_SIM_ID/ \
  | jq '.metrics.coordination'
```

**Expected**: Only `{mean, std}` — no `per_particle`, no `distribution`.

**Frontend check**: Navigate to both old and new simulation pages in the UI:
- Old sim: should display coordination mean/std card without errors
- New sim: should display coordination mean/std card without errors
- No console errors in browser DevTools

---

## Step 5: neighbor-graph endpoint

### Fresh sim (cache hit path):

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.pyaglogen3d.com/api/v1/projects/$PROJECT_ID/simulations/$SIM_ID/neighbor-graph/ \
  | jq '.stats'
```

**Expected**: Valid `{nodes, edges, stats}` response. Stats include `n_particles`, `n_edges`, `avg_coordination`, `is_connected`.

### Legacy sim (fallback path):

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.pyaglogen3d.com/api/v1/projects/$PROJECT_ID/simulations/$LEGACY_SIM_ID/neighbor-graph/ \
  | jq '.stats'
```

**Expected**: Same response structure (computed from geometry on the fly).

### Verify identical results:

For a fresh sim, the coordination numbers from neighbor-graph nodes should match the `per_particle.n_contacts` values from the simulation metrics.
