# Projection Export

Export 2D projections of a simulated aggregate from arbitrary viewing
directions as a ZIP of PNGs with an accompanying `metadata.json`.

## How to export

1. Open a simulation detail page
2. Scroll to the **Projections** section
3. Choose a **sampling mode** (Grid / Fibonacci / Legacy)
4. Fill in the mode-specific parameters
5. Click **Download projections**

## Sampling modes

### Grid (recommended for parametric studies)

Samples directions on a regular azimuth × elevation grid with automatic
pole deduplication.

Parameters:

- `n_az`: number of azimuth samples (≥ 1)
- `n_el`: number of elevation samples (≥ 2, includes both poles)

Total projections emitted: `n_az * (n_el − 2) + 2`

The formula accounts for the fact that ±90° elevation are single points
on the sphere, so only ONE projection is emitted at each pole regardless
of `n_az`. Intermediate elevations emit `n_az` projections each.

Examples:

- `n_az=10, n_el=5` → `10×3 + 2 = 32` projections
- `n_az=6, n_el=3` → `6×1 + 2 = 8` projections
- `n_az=1, n_el=2` → 2 projections (poles only)

### Fibonacci lattice (recommended for integration / uniform sampling)

Distributes exactly N projections uniformly over the sphere using the
golden-angle spiral. No clustering at the poles, no duplicate coverage.

Parameters:

- `n`: number of projections (1 ≤ n ≤ 10000)

This is the mathematically optimal sphere-sampling strategy for
integrating scalar quantities over viewing directions.

### Legacy (backwards compatible)

The original 6-input azimuth/elevation sweep is preserved for existing
scripts. Use Grid or Fibonacci for new work.

## Output format

ZIP archive containing:

- PNG files named `proj_{idx:03d}_Az{AAA}_El{±EEE}.png`
  - `idx`: zero-padded 3-digit index (sorted)
  - `Az`: zero-padded 3-digit azimuth in `[000, 360)`
  - `El`: signed 3-digit elevation in `[-090, +090]`
- `metadata.json` at the ZIP root with:

  ```json
  {
    "mode": "grid" | "fibonacci" | "legacy",
    "n_requested": 32,
    "n_generated": 32,
    "parameters": { "img_size": 512, "n_az": 10, "n_el": 5 },
    "directions": [
      {"index": 0, "filename": "proj_000_Az000_El-090.png", "azimuth": 0.0, "elevation": -90.0}
    ]
  }
  ```

## Sync vs async

- **≤ 200 projections**: the endpoint responds synchronously with the
  ZIP (typically < 30 s)
- **> 200 projections**: the request is queued; the UI polls a status
  endpoint and downloads the ZIP when it's ready

## Related specs

- `openspec/specs/projection-export-contract.md` — the observable contract
- `openspec/changes/archive/projections-export-fix-2026-04-22/` — change history
