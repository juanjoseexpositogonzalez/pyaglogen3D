# Importing Aggregates

pyaglogen3D supports importing pre-existing aggregates from CSV and MATLAB `.mat` files,
so you can validate the simulator against geometries from other tools or published data.

## Supported formats

### CSV

Required header: `x,y,z,radius` (case-insensitive, any order).
Per-particle coordinates in nm.

Optional `#key=value` metadata lines before the header:

```csv
# unit=nm
# primary_particle_diameter_nm=25.0
# source=matlab-agloGen3D
# generated_at=2026-04-21T10:00:00Z
x,y,z,radius
0.0,0.0,0.0,12.5
25.0,0.0,0.0,12.5
```

Supported metadata keys:
- `unit` — `nm` (default) or `dimensionless`
- `primary_particle_diameter_nm` — explicit override (otherwise computed as 2×mean(radius))
- `source` — free-form provenance string
- `generated_at` — ISO-8601 datetime

### MATLAB (.mat)

MATLAB `save` files (format v7 or earlier — **v7.3/HDF5 not supported**).
Single-agglomerate only. The parser looks for:
- `clusters` (preferred) — (N, 4) matrix with columns [x, y, z, radius]
- `part` — same shape, used if `clusters` not present

Multi-agglomerate files (`part` + `NofPart` with length > 1) are rejected.

### Not supported: .dat

The `.dat` format from Box-Counter contains tessellated surface points, not
per-particle coordinates. These files are rejected on upload.

## Locale handling (CSV)

The parser auto-detects decimal separator (`.` vs `,`) and column delimiter
(`,` vs `;`) from the first 5 data rows. If the file is smaller than 5 rows
or the format is ambiguous, the upload dialog shows the detected format with
a manual override option.

Your CSV export preferences (decimal + delimiter) are configured in
[Settings → CSV Export Preferences](/settings).

## How to import

1. Go to your project page
2. Click **Import Aggregate** (next to "New Simulation")
3. Choose the CSV or MATLAB tab
4. Select your file (max 10 MB)
5. Review the detected metadata + locale; override if needed
6. Click **Import**

The imported aggregate appears as a Simulation with `algorithm=imported`.

## Metrics computed on import

All geometric metrics are computed from the static data:
- **Radius of gyration** (mass-weighted, using radius³ as mass)
- **Porosity**, **coordination**, **principal moments**, **anisotropy**, **asphericity**

**Fractal dimension** is computed via **box-counting** (independent of
deposition order). Requires **N ≥ 50 particles**. For smaller aggregates,
`fractal_dimension` is set to `null` with a note in the metrics.

> Note: imports do NOT compute an Rg-evolution curve. The curve requires
> knowing the deposition order of particles, which is not preserved by
> static geometry formats.

## Size limits

- Per file: 10 MB
- Per aggregate: 100,000 particles
