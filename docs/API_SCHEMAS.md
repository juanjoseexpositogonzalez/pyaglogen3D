# API Schemas - pyAgloGen3D

## Base URL

```
Production: https://api.pyaglogen3d.com/api/v1
Development: http://localhost:8000/api/v1
```

## Authentication

```http
Authorization: Bearer <jwt_token>
```

---

## Projects

### List Projects

```http
GET /projects/
```

**Response 200:**
```json
{
  "count": 15,
  "next": "/api/v1/projects/?page=2",
  "previous": null,
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Tesis Cap. 4 - DLA Study",
      "description": "Estudio parametrico de DLA variando sticking probability",
      "simulation_count": 24,
      "analysis_count": 8,
      "created_at": "2026-02-15T10:30:00Z",
      "updated_at": "2026-02-17T14:22:00Z"
    }
  ]
}
```

### Create Project

```http
POST /projects/
Content-Type: application/json
```

**Request:**
```json
{
  "name": "New Research Project",
  "description": "Optional project description"
}
```

**Response 201:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "New Research Project",
  "description": "Optional project description",
  "simulation_count": 0,
  "analysis_count": 0,
  "created_at": "2026-02-17T15:00:00Z",
  "updated_at": "2026-02-17T15:00:00Z"
}
```

### Get Project Detail

```http
GET /projects/{id}/
```

**Response 200:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Tesis Cap. 4 - DLA Study",
  "description": "Estudio parametrico de DLA variando sticking probability",
  "simulation_count": 24,
  "analysis_count": 8,
  "recent_simulations": [
    {"id": "...", "algorithm": "dla", "status": "completed", "created_at": "..."}
  ],
  "recent_analyses": [
    {"id": "...", "method": "box_counting", "status": "completed", "created_at": "..."}
  ],
  "created_at": "2026-02-15T10:30:00Z",
  "updated_at": "2026-02-17T14:22:00Z"
}
```

---

## Simulations

### Simulation Algorithms (Enum)

| Value | Description |
|-------|-------------|
| `dla` | Diffusion-Limited Aggregation |
| `cca` | Cluster-Cluster Aggregation |
| `ballistic` | Ballistic Aggregation |
| `tunable` | Tunable Sticking Probability DLA |

### Simulation Status (Enum)

| Value | Description |
|-------|-------------|
| `queued` | En cola de ejecucion |
| `running` | Ejecutandose |
| `completed` | Completada exitosamente |
| `failed` | Error durante ejecucion |
| `cancelled` | Cancelada por usuario |

### List Simulations

```http
GET /projects/{project_id}/simulations/
```

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `algorithm` | string | Filtrar por algoritmo |
| `status` | string | Filtrar por estado |
| `df_min` | float | Dimension fractal minima |
| `df_max` | float | Dimension fractal maxima |
| `created_after` | datetime | Creadas despues de |
| `created_before` | datetime | Creadas antes de |
| `ordering` | string | `-created_at`, `fractal_dimension`, etc. |
| `page` | int | Numero de pagina |
| `page_size` | int | Items por pagina (max 100) |

**Response 200:**
```json
{
  "count": 24,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "algorithm": "dla",
      "status": "completed",
      "parameters": {
        "n_particles": 5000,
        "sticking_probability": 1.0,
        "lattice_size": 500
      },
      "seed": 42,
      "metrics": {
        "fractal_dimension": 1.78,
        "prefactor": 1.23,
        "radius_of_gyration": 145.6
      },
      "execution_time_ms": 28500,
      "created_at": "2026-02-17T10:30:00Z",
      "completed_at": "2026-02-17T10:30:28Z"
    }
  ]
}
```

### Create Simulation

```http
POST /projects/{project_id}/simulations/
Content-Type: application/json
```

**Request - DLA:**
```json
{
  "algorithm": "dla",
  "parameters": {
    "n_particles": 5000,
    "sticking_probability": 1.0,
    "lattice_size": 500,
    "seed_radius": 1.0
  },
  "seed": 42
}
```

**Request - CCA:**
```json
{
  "algorithm": "cca",
  "parameters": {
    "n_particles": 2000,
    "initial_clusters": 50,
    "interaction_radius": 2.5,
    "concentration": 0.01
  },
  "seed": 123
}
```

**Request - Ballistic:**
```json
{
  "algorithm": "ballistic",
  "parameters": {
    "n_particles": 3000,
    "velocity": 1.0,
    "incidence_angle_distribution": "uniform",
    "particle_size_distribution": {
      "type": "monodisperse",
      "radius": 1.0
    }
  },
  "seed": 456
}
```

**Response 201:**
```json
{
  "id": "770e8400-e29b-41d4-a716-446655440000",
  "algorithm": "dla",
  "status": "queued",
  "parameters": {...},
  "seed": 42,
  "metrics": null,
  "execution_time_ms": null,
  "created_at": "2026-02-17T15:30:00Z",
  "completed_at": null
}
```

### Get Simulation Detail

```http
GET /projects/{project_id}/simulations/{id}/
```

**Response 200 (completed):**
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440000",
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "algorithm": "dla",
  "status": "completed",
  "parameters": {
    "n_particles": 5000,
    "sticking_probability": 1.0,
    "lattice_size": 500,
    "seed_radius": 1.0
  },
  "seed": 42,
  "metrics": {
    "fractal_dimension": 1.78,
    "fractal_dimension_std": 0.02,
    "prefactor": 1.23,
    "radius_of_gyration": 145.6,
    "porosity": 0.82,
    "coordination": {
      "mean": 2.4,
      "std": 1.1,
      "histogram": [0, 1250, 2100, 1200, 350, 80, 15, 5]
    },
    "rdf": {
      "r": [1.0, 2.0, 3.0, 4.0, 5.0, ...],
      "g_r": [2.1, 1.8, 1.4, 1.2, 1.1, ...]
    },
    "rg_evolution": {
      "n": [10, 50, 100, 500, 1000, 2000, 5000],
      "rg": [3.2, 12.5, 22.1, 68.4, 102.3, 125.7, 145.6]
    }
  },
  "geometry_url": "/api/v1/simulations/660e.../geometry/",
  "execution_time_ms": 28500,
  "engine_version": "0.1.0",
  "created_at": "2026-02-17T10:30:00Z",
  "completed_at": "2026-02-17T10:30:28Z"
}
```

### Download Geometry

```http
GET /simulations/{id}/geometry/
Accept: application/octet-stream
```

**Response 200:**
Binary NumPy array file (.npy) containing:
- Shape: `(N, 4)` where columns are `[x, y, z, radius]`

### Export Simulation

```http
GET /simulations/{id}/export/{format}/
```

**Formats:**
| Format | Content-Type | Description |
|--------|--------------|-------------|
| `csv` | text/csv | Coordenadas x,y,z,radius |
| `stl` | application/octet-stream | Mesh 3D para impresion |
| `obj` | text/plain | Wavefront OBJ |
| `ply` | application/octet-stream | Stanford PLY con colores |

---

## Image Analyses

### Analysis Methods (Enum)

| Value | Description |
|-------|-------------|
| `box_counting` | Box-Counting dimension |
| `sandbox` | Sandbox method |
| `correlation` | Correlation dimension |
| `lacunarity` | Lacunarity analysis |
| `multifractal` | Multifractal Dq spectrum |

### Threshold Methods (Enum)

| Value | Description |
|-------|-------------|
| `otsu` | Otsu automatic threshold |
| `manual` | Manual threshold value |
| `adaptive` | Adaptive local threshold |
| `isodata` | ISODATA/IJ threshold |

### Upload Image

```http
POST /upload/
Content-Type: multipart/form-data
```

**Request:**
```
file: <binary image data>
```

**Response 201:**
```json
{
  "image_path": "/uploads/2026/02/17/abc123.png",
  "filename": "microscopy_sample.png",
  "size_bytes": 2457600,
  "dimensions": {
    "width": 2048,
    "height": 2048
  },
  "format": "PNG"
}
```

### Create Analysis

```http
POST /projects/{project_id}/analyses/
Content-Type: application/json
```

**Request - Box Counting:**
```json
{
  "image_path": "/uploads/2026/02/17/abc123.png",
  "preprocessing_params": {
    "threshold_method": "otsu",
    "threshold_value": null,
    "invert": false,
    "remove_small_objects": 50,
    "fill_holes": true,
    "gaussian_blur_sigma": 0
  },
  "method": "box_counting",
  "method_params": {
    "min_box_size": 2,
    "max_box_size": 512,
    "num_scales": 20
  }
}
```

**Request - Sandbox:**
```json
{
  "image_path": "/uploads/2026/02/17/abc123.png",
  "preprocessing_params": {...},
  "method": "sandbox",
  "method_params": {
    "num_seeds": 100,
    "seed_selection": "random",
    "min_radius": 2,
    "max_radius": 256,
    "num_scales": 15
  }
}
```

**Request - Multifractal:**
```json
{
  "image_path": "/uploads/2026/02/17/abc123.png",
  "preprocessing_params": {...},
  "method": "multifractal",
  "method_params": {
    "q_values": [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5],
    "min_box_size": 2,
    "max_box_size": 256,
    "num_scales": 15
  }
}
```

**Response 201:**
```json
{
  "id": "880e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "method": "box_counting",
  "created_at": "2026-02-17T16:00:00Z"
}
```

### Get Analysis Detail

```http
GET /projects/{project_id}/analyses/{id}/
```

**Response 200 (Box Counting completed):**
```json
{
  "id": "880e8400-e29b-41d4-a716-446655440000",
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "original_image_url": "/media/uploads/2026/02/17/abc123.png",
  "processed_image_url": "/media/processed/2026/02/17/abc123_binary.png",
  "preprocessing_params": {
    "threshold_method": "otsu",
    "threshold_value": 127,
    "invert": false,
    "remove_small_objects": 50,
    "fill_holes": true
  },
  "method": "box_counting",
  "method_params": {
    "min_box_size": 2,
    "max_box_size": 512,
    "num_scales": 20
  },
  "results": {
    "fractal_dimension": 1.65,
    "r_squared": 0.9987,
    "std_error": 0.012,
    "confidence_interval_95": [1.626, 1.674],
    "log_sizes": [0.693, 1.099, 1.386, 1.609, 1.792, ...],
    "log_counts": [8.294, 7.901, 7.521, 7.163, 6.832, ...],
    "residuals": [-0.002, 0.005, -0.003, 0.001, ...]
  },
  "execution_time_ms": 3200,
  "engine_version": "0.1.0",
  "created_at": "2026-02-17T16:00:00Z",
  "completed_at": "2026-02-17T16:00:03Z"
}
```

**Response 200 (Multifractal completed):**
```json
{
  "id": "990e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "method": "multifractal",
  "results": {
    "q_values": [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5],
    "dq_spectrum": [2.1, 2.0, 1.95, 1.88, 1.78, 1.65, 1.52, 1.45, 1.40, 1.38, 1.36],
    "tau_q": [-8.5, -6.0, -3.85, -1.76, 0.22, 1.65, 2.52, 3.35, 4.20, 5.14, 6.16],
    "alpha": [2.5, 2.3, 2.1, 1.95, 1.78, 1.65, 1.52, 1.42, 1.35, 1.30, 1.28],
    "f_alpha": [0.5, 0.8, 1.1, 1.35, 1.55, 1.65, 1.55, 1.40, 1.20, 0.95, 0.70],
    "spectrum_width": 1.22,
    "asymmetry": 0.15
  },
  "execution_time_ms": 8500
}
```

---

## Parametric Studies

### Create Study

```http
POST /projects/{project_id}/studies/
Content-Type: application/json
```

**Request:**
```json
{
  "name": "DLA Sticking Probability Study",
  "description": "Analisis del efecto de sticking probability en Df",
  "base_algorithm": "dla",
  "base_parameters": {
    "lattice_size": 500,
    "seed_radius": 1.0
  },
  "parameter_grid": {
    "n_particles": [100, 500, 1000, 5000],
    "sticking_probability": [0.1, 0.5, 1.0]
  },
  "seeds_per_combination": 3
}
```

**Response 201:**
```json
{
  "id": "aa0e8400-e29b-41d4-a716-446655440000",
  "name": "DLA Sticking Probability Study",
  "status": "running",
  "total_simulations": 36,
  "completed_simulations": 0,
  "created_at": "2026-02-17T17:00:00Z"
}
```

### Get Study Results

```http
GET /projects/{project_id}/studies/{id}/results/
```

**Response 200:**
```json
{
  "id": "aa0e8400-e29b-41d4-a716-446655440000",
  "name": "DLA Sticking Probability Study",
  "status": "completed",
  "results_table": [
    {
      "n_particles": 100,
      "sticking_probability": 0.1,
      "df_mean": 2.12,
      "df_std": 0.08,
      "kf_mean": 1.45,
      "kf_std": 0.12,
      "simulation_ids": ["...", "...", "..."]
    },
    {
      "n_particles": 100,
      "sticking_probability": 0.5,
      "df_mean": 1.92,
      "df_std": 0.05
    }
  ],
  "export_urls": {
    "csv": "/api/v1/studies/aa0e.../export/csv/",
    "latex": "/api/v1/studies/aa0e.../export/latex/"
  }
}
```

---

## Error Responses

### 400 Bad Request

```json
{
  "error": "validation_error",
  "details": {
    "n_particles": ["Ensure this value is greater than or equal to 10."],
    "sticking_probability": ["Ensure this value is less than or equal to 1.0."]
  }
}
```

### 404 Not Found

```json
{
  "error": "not_found",
  "message": "Simulation with id 'xyz' not found"
}
```

### 500 Internal Server Error

```json
{
  "error": "simulation_failed",
  "message": "Rust engine error: Memory allocation failed",
  "simulation_id": "...",
  "logs_url": "/api/v1/simulations/.../logs/"
}
```

---

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `POST /simulations/` | 10/minute |
| `POST /analyses/` | 10/minute |
| `POST /studies/` | 2/minute |
| `GET /*` | 100/minute |

**Headers:**
```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1708185600
```
