# Theory: Analysis Automation

Automating fractal analysis workflows through AI-driven tools.

---

## Analysis Types in pyAgloGen3D

### 3D Analysis: Box-Counting

```
┌────────────────────────────────────────────────────────┐
│                 Box-Counting Method                     │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Input: 3D point cloud (simulation geometry)           │
│                                                        │
│  Process:                                              │
│  1. Cover space with boxes of size ε                   │
│  2. Count boxes N(ε) containing points                 │
│  3. Repeat for multiple ε values                       │
│  4. Fit: log(N) vs log(1/ε)                            │
│                                                        │
│  Output:                                               │
│  - Df: Fractal dimension (slope of fit)                │
│  - R²: Fit quality                                     │
│  - Scaling range: Valid ε range                        │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 2D Analysis: Fraktal Analysis

```
┌────────────────────────────────────────────────────────┐
│                 Fraktal Analysis                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Input: 2D projection image (from simulation or upload)│
│                                                        │
│  Methods:                                              │
│  - Granulated 2012: Texture-based analysis             │
│  - Voxel 2018: Volumetric projection analysis          │
│                                                        │
│  Output:                                               │
│  - Df: Fractal dimension                               │
│  - Rg: Radius of gyration                              │
│  - kf: Fractal prefactor                               │
│  - Npo: Number of primary particles                    │
│  - ap: Primary particle size                           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## Analysis Pipeline

### Standard Analysis Flow

```
Simulation       Analysis        Results
    │                │               │
    ▼                ▼               ▼
┌────────┐    ┌───────────┐    ┌──────────┐
│ Run    │───▶│ Box-Count │───▶│ Df, Rg   │
│ DLA    │    │ 3D        │    │ metrics  │
└────────┘    └───────────┘    └──────────┘
                  │
                  ▼
              ┌───────────┐    ┌──────────┐
              │ Project   │───▶│ 2D image │
              │ to 2D     │    └──────────┘
              └───────────┘         │
                                    ▼
                              ┌───────────┐    ┌──────────┐
                              │ Fraktal   │───▶│ Df, Rg   │
                              │ Analysis  │    │ kf, Npo  │
                              └───────────┘    └──────────┘
```

### Batch Analysis

When analyzing a parametric study:

```
Study (10 simulations)
        │
        ▼
┌─────────────────────────────────────────────┐
│              Analysis Queue                  │
├─────────────────────────────────────────────┤
│  Sim 1 ──▶ Box-counting ──▶ Df=1.78        │
│  Sim 2 ──▶ Box-counting ──▶ Df=1.82        │
│  Sim 3 ──▶ Box-counting ──▶ Df=1.75        │
│  ...                                        │
│  Sim 10 ──▶ Box-counting ──▶ Df=1.80       │
└─────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│              Aggregation                     │
├─────────────────────────────────────────────┤
│  Mean Df: 1.79                              │
│  Std Df: 0.03                               │
│  Min: 1.75, Max: 1.82                       │
└─────────────────────────────────────────────┘
```

---

## Tool Design Considerations

### When to Run Analysis Automatically

| Scenario | Auto-Analyze? | Reason |
|----------|---------------|--------|
| Single simulation | No | User may want to inspect first |
| Parametric study | Yes | Expected workflow |
| User requests | Yes | Explicit request |
| Re-run simulation | No | May have existing analysis |

### Analysis Parameters

#### Box-Counting

```python
{
    "min_box_size": {
        "type": "number",
        "description": "Minimum box size (relative to particle radius)",
        "default": 0.5
    },
    "max_box_size": {
        "type": "number",
        "description": "Maximum box size (relative to aggregate size)",
        "default": 2.0
    },
    "n_sizes": {
        "type": "integer",
        "description": "Number of box sizes to test",
        "default": 20
    }
}
```

#### Fraktal Analysis

```python
{
    "method": {
        "type": "string",
        "enum": ["granulated_2012", "voxel_2018"],
        "description": "Analysis algorithm",
        "default": "voxel_2018"
    },
    "projection_axis": {
        "type": "string",
        "enum": ["x", "y", "z", "random"],
        "default": "z"
    }
}
```

---

## Comparison Analysis

### Why Compare?

Researchers need to:
- Validate simulation parameters produce expected Df
- Compare different algorithms
- Assess statistical variability

### Comparison Tool Design

```python
{
    "name": "compare_simulations",
    "description": "Compare fractal properties across multiple simulations",
    "parameters": {
        "simulation_ids": {
            "type": "array",
            "items": {"type": "integer"},
            "minItems": 2,
            "description": "Simulations to compare"
        },
        "metrics": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["df", "rg", "n_particles", "kf"]
            },
            "default": ["df", "rg"]
        }
    }
}
```

### Comparison Output

```json
{
    "comparison": {
        "simulations": [1, 2, 3],
        "metrics": {
            "df": {
                "values": [1.78, 1.82, 1.75],
                "mean": 1.78,
                "std": 0.035,
                "range": [1.75, 1.82]
            },
            "rg": {
                "values": [45.2, 48.1, 43.8],
                "mean": 45.7,
                "std": 2.18
            }
        }
    },
    "correlation": {
        "df_vs_rg": 0.87,
        "interpretation": "Strong positive correlation"
    }
}
```

---

## Error Handling

### Common Analysis Failures

| Error | Cause | Recovery |
|-------|-------|----------|
| No geometry | Simulation not complete | Wait or check status |
| Too few points | Very small simulation | Lower box size bounds |
| Poor fit (R² < 0.95) | Non-fractal structure | Report with warning |
| Timeout | Very large simulation | Use sampling |

### Graceful Degradation

```python
def analyze_with_fallback(simulation_id: int) -> AnalysisResult:
    try:
        # Try full analysis
        return run_full_box_counting(simulation_id)
    except TooManyPointsError:
        # Fall back to sampled analysis
        return run_sampled_box_counting(simulation_id, sample_rate=0.1)
    except TimeoutError:
        # Queue as async task
        task = run_box_counting_async.delay(simulation_id)
        return AnalysisResult(
            status="queued",
            task_id=task.id,
            message="Analysis queued due to size"
        )
```

---

## Analysis Caching

### When to Cache

- Analysis results are deterministic for same input
- Re-running analysis wastes compute

### Cache Strategy

```python
def get_or_compute_analysis(simulation_id: int, params: dict) -> dict:
    cache_key = f"analysis:{simulation_id}:{hash(params)}"

    # Check cache
    cached = cache.get(cache_key)
    if cached:
        return cached

    # Compute
    result = run_analysis(simulation_id, params)

    # Cache for 24 hours
    cache.set(cache_key, result, timeout=86400)

    return result
```

### Invalidation

Cache should be invalidated when:
- Simulation geometry is modified
- Analysis parameters change
- User explicitly requests re-analysis

---

## Scientific Interpretation

### AI-Assisted Interpretation

The AI can help interpret results:

```
User: "What does a Df of 1.78 mean?"

AI: "A fractal dimension of 1.78 for a DLA aggregate indicates
a moderately open structure. For reference:
- Df ≈ 1.8 is typical for diffusion-limited aggregation
- Df ≈ 2.1 would indicate a more compact structure (CCA)
- Df ≈ 2.5+ approaches solid sphere behavior

Your result of 1.78 is consistent with a well-formed DLA
aggregate with typical branching characteristics."
```

### Contextual Knowledge

The AI should know:
- Expected Df ranges for each algorithm
- Physical meaning of metrics
- Common literature values
- Experimental validation ranges

This will be enhanced by RAG with scientific literature.

---

## Key Takeaways

1. **Defer analysis decisions**: Let users trigger or configure auto-analysis
2. **Batch efficiently**: Analyze parametric studies in parallel
3. **Handle errors gracefully**: Fallbacks for large simulations
4. **Cache results**: Avoid redundant computation
5. **Aggregate statistics**: Provide mean, std, ranges for studies
6. **Contextual interpretation**: Help users understand results

---

## Further Reading

- [Box-Counting Dimension](https://en.wikipedia.org/wiki/Box-counting_dimension)
- [Fractal Aggregates in Physics](https://doi.org/10.1016/0378-4371(89)90034-4)
- [DLA Fractal Dimensions](https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.47.1400)
