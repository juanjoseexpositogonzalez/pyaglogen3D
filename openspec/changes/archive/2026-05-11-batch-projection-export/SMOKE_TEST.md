# Smoke Test: batch-projection-export

## Pre-conditions

- Deploy backend + frontend (no migration required)
- At least one project with a parametric study containing ≥ 2 completed simulations
- Authenticated user with study access

## Step 1: Trigger batch export via API

```bash
# Replace {p}, {s} with real project/study IDs
# Replace TOKEN with a valid JWT access token
curl -X POST \
  https://api.pyaglogen3d.com/api/v1/projects/{p}/studies/{s}/export-projections/ \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "simulation_ids": ["<uuid-1>", "<uuid-2>"],
    "mode": "grid",
    "config": {"az_step": 30, "el_step": 30}
  }'
```

**Expected**: HTTP 202, body `{"job_id": "<uuid>", "status": "queued", "total_sims": 2}`

## Step 2: Poll until completion

```bash
# Use the job_id from step 1
curl -s \
  https://api.pyaglogen3d.com/api/v1/projections-status/{job_id}/ \
  -H "Authorization: Bearer ${TOKEN}" | python3 -m json.tool
```

**Expected progression**:
1. `{"status": "processing", "progress": 0.0, "current": 0, "total": 2}`
2. `{"status": "processing", "progress": 0.5, "current": 1, "total": 2, "current_sim_id": "<uuid-1>"}`
3. `{"status": "done", "download_url": "/api/v1/projections-status/{job_id}/download/"}`

## Step 3: Download and inspect ZIP

```bash
curl -o projections.zip \
  https://api.pyaglogen3d.com/api/v1/projections-status/{job_id}/download/ \
  -H "Authorization: Bearer ${TOKEN}"

unzip -l projections.zip
```

**Expected ZIP structure**:
```
sim_<uuid-1>/sim_<short>_Az000_El000.png
sim_<uuid-1>/sim_<short>_Az030_El000.png
...
sim_<uuid-2>/sim_<short>_Az000_El000.png
...
manifest.json
```

**Inspect manifest**:
```bash
unzip -p projections.zip manifest.json | python3 -m json.tool
```

Should contain: `export_id`, `study_id`, `study_name`, `exported_at`, `mode`, `config`, `simulations` array with `sim_id`, `sim_name`, `projection_count`, `status`.

## Step 4: UI walkthrough

1. Open a parametric study with ≥ 2 completed simulations
2. Scroll down — the **"Export Projections"** panel should be visible below the results table
3. Click **"Select all"** → all checkboxes checked, counter shows "N of N selected"
4. Verify mode selector defaults to "Grid (Az × El)"
5. Click **"Generate & Export"** → button disables, progress bar appears
6. Observe "Processing simulation X of Y" text updating
7. On completion, ZIP automatically downloads
8. Verify the downloaded ZIP name matches `study_<id>_projections_<date>.zip`

## Step 5: Efficiency test (render-or-reuse)

1. Run the exact same export from Step 1 a second time
2. Note the duration of the first vs second run
3. **Expected**: Second run should be significantly faster (>50% reduction) because existing PNGs are reused

## Step 6: Error paths

### Invalid mode
```bash
curl -X POST .../export-projections/ \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"simulation_ids": ["<uuid>"], "mode": "spherical", "config": {}}'
```
**Expected**: HTTP 400

### Foreign sim_id
```bash
curl -X POST .../export-projections/ \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"simulation_ids": ["<uuid-from-different-study>"], "mode": "grid", "config": {"az_step": 30, "el_step": 30}}'
```
**Expected**: HTTP 400 with detail about sim not belonging to study

### Exceeds 50-sim limit
```bash
# POST with 51 simulation_ids
curl -X POST .../export-projections/ \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"simulation_ids": ["id1", "id2", ..., "id51"], "mode": "grid", "config": {"az_step": 30, "el_step": 30}}'
```
**Expected**: HTTP 400 with "Maximum 50 simulations per batch export"
