# Theory: Document Generation

Creating research-ready exports from simulation data.

---

## Export Formats

### CSV: Data Analysis

```
┌────────────────────────────────────────────────────────────┐
│                      CSV Export                             │
├────────────────────────────────────────────────────────────┤
│  Purpose: Data import to Excel, Python, R, MATLAB          │
│                                                            │
│  Content:                                                  │
│  - Simulation parameters                                   │
│  - Computed metrics (Df, Rg, kf, etc.)                     │
│  - Statistical summaries for studies                       │
│                                                            │
│  Format:                                                   │
│  simulation_id, algorithm, n_particles, df, rg, kf         │
│  1, DLA, 500, 1.78, 45.2, 1.23                             │
│  2, DLA, 1000, 1.82, 89.1, 1.19                            │
└────────────────────────────────────────────────────────────┘
```

### DOCX: Reports

```
┌────────────────────────────────────────────────────────────┐
│                     Word Document                           │
├────────────────────────────────────────────────────────────┤
│  Purpose: Quick reports, client deliverables               │
│                                                            │
│  Sections:                                                 │
│  1. Executive Summary                                      │
│  2. Methodology                                            │
│  3. Results (tables + figures)                             │
│  4. Discussion                                             │
│  5. References                                             │
│                                                            │
│  Features:                                                 │
│  - Professional formatting                                 │
│  - Embedded images (3D renders, plots)                     │
│  - Data tables with styling                                │
│  - Auto-generated captions                                 │
└────────────────────────────────────────────────────────────┘
```

### LaTeX: Academic Publication

```
┌────────────────────────────────────────────────────────────┐
│                      LaTeX Export                           │
├────────────────────────────────────────────────────────────┤
│  Purpose: Journal submissions, thesis chapters             │
│                                                            │
│  Output:                                                   │
│  - main.tex (document)                                     │
│  - figures/ (plots, renders)                               │
│  - tables/ (data tables)                                   │
│  - references.bib (bibliography)                           │
│                                                            │
│  Templates:                                                │
│  - Generic article                                         │
│  - Specific journal formats (optional)                     │
│                                                            │
│  Features:                                                 │
│  - Proper math formatting                                  │
│  - Figure/table references                                 │
│  - BibTeX citations                                        │
│  - Compile-ready                                           │
└────────────────────────────────────────────────────────────┘
```

---

## Content Generation

### AI-Assisted Writing

The AI can help generate narrative content:

```
User: "Export my DLA study results to a Word report"

AI generates:
- Summary of study parameters
- Key findings narrative
- Interpretation of Df trends
- Comparison with literature values
- Conclusions

Example text:
"A parametric study was conducted varying the number of
particles from 100 to 1000. The fractal dimension showed
a consistent value of Df = 1.78 ± 0.03, in agreement with
theoretical predictions for DLA (Witten & Sander, 1981)."
```

### Template-Based Generation

For consistency, use templates:

```python
REPORT_TEMPLATE = """
# {study_name} - Results Report

## Study Parameters
- Algorithm: {algorithm}
- Variable: {variable_parameter}
- Range: {min_value} to {max_value}
- Total simulations: {n_simulations}

## Key Results
{results_summary}

## Conclusions
{conclusions}

## Data Tables
{tables}
"""
```

---

## Python Libraries

### CSV: Built-in `csv` module

```python
import csv

def export_to_csv(simulations: list[Simulation]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        'id', 'algorithm', 'n_particles', 'df', 'rg', 'kf'
    ])
    writer.writeheader()
    for sim in simulations:
        writer.writerow({
            'id': sim.id,
            'algorithm': sim.algorithm,
            'n_particles': sim.n_particles,
            'df': sim.metrics.get('df'),
            'rg': sim.metrics.get('rg'),
            'kf': sim.metrics.get('kf'),
        })
    return output.getvalue()
```

### DOCX: python-docx

```python
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH

def create_report(title: str, sections: list[dict]) -> Document:
    doc = Document()

    # Title
    title_para = doc.add_heading(title, 0)
    title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER

    for section in sections:
        # Section heading
        doc.add_heading(section['title'], level=1)

        # Content
        if section['type'] == 'text':
            doc.add_paragraph(section['content'])

        elif section['type'] == 'table':
            add_table(doc, section['data'], section['headers'])

        elif section['type'] == 'image':
            doc.add_picture(section['path'], width=Inches(5))
            doc.add_paragraph(section['caption'], style='Caption')

    return doc
```

### LaTeX: pylatex

```python
from pylatex import Document, Section, Subsection, Table, Figure
from pylatex.utils import NoEscape

def create_latex_report(title: str, data: dict) -> Document:
    doc = Document()

    doc.preamble.append(NoEscape(r'\title{' + title + '}'))
    doc.preamble.append(NoEscape(r'\author{pyAgloGen3D}'))
    doc.preamble.append(NoEscape(r'\date{\today}'))
    doc.append(NoEscape(r'\maketitle'))

    with doc.create(Section('Methods')):
        doc.append(data['methods_text'])

    with doc.create(Section('Results')):
        with doc.create(Table(position='htbp')) as table:
            # Add table content
            pass

        with doc.create(Figure(position='htbp')) as fig:
            fig.add_image(data['figure_path'], width='0.8\\textwidth')
            fig.add_caption(data['figure_caption'])

    return doc
```

---

## Export Tool Design

### Single Simulation Export

```python
{
    "name": "export_simulation",
    "description": "Export a single simulation's results",
    "parameters": {
        "simulation_id": {"type": "integer"},
        "format": {
            "type": "string",
            "enum": ["csv", "json", "summary"]
        },
        "include_geometry": {
            "type": "boolean",
            "default": False,
            "description": "Include 3D coordinates (large file)"
        }
    }
}
```

### Study Export

```python
{
    "name": "export_study",
    "description": "Export a parametric study's results",
    "parameters": {
        "study_id": {"type": "integer"},
        "format": {
            "type": "string",
            "enum": ["csv", "docx", "latex"]
        },
        "include_plots": {
            "type": "boolean",
            "default": True
        },
        "include_narrative": {
            "type": "boolean",
            "default": True,
            "description": "Include AI-generated analysis text"
        }
    }
}
```

### Custom Report

```python
{
    "name": "generate_report",
    "description": "Generate a custom report with selected content",
    "parameters": {
        "title": {"type": "string"},
        "simulation_ids": {
            "type": "array",
            "items": {"type": "integer"}
        },
        "format": {
            "type": "string",
            "enum": ["docx", "latex"]
        },
        "sections": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["summary", "methods", "results", "discussion", "references"]
            },
            "default": ["summary", "methods", "results"]
        },
        "include_figures": {"type": "boolean", "default": True}
    }
}
```

---

## File Delivery

### Options

1. **Direct download URL**: Generate file, return temporary URL
2. **Inline content**: For small files (CSV), return content directly
3. **Email delivery**: For large reports, email with attachment

### Implementation

```python
def deliver_export(content: bytes, filename: str, format: str) -> dict:
    if len(content) < 50_000:  # < 50KB
        # Return inline
        return {
            "delivery": "inline",
            "content": base64.b64encode(content).decode(),
            "filename": filename
        }
    else:
        # Store and return URL
        path = f"exports/{uuid4()}/{filename}"
        default_storage.save(path, ContentFile(content))
        url = default_storage.url(path)

        # Schedule cleanup
        cleanup_export.apply_async(args=[path], countdown=3600)  # 1 hour

        return {
            "delivery": "url",
            "url": url,
            "expires_in": 3600,
            "filename": filename
        }
```

---

## Plot Generation

### Matplotlib for Scientific Plots

```python
import matplotlib.pyplot as plt
import numpy as np

def create_df_vs_n_plot(study_results: dict) -> bytes:
    fig, ax = plt.subplots(figsize=(8, 6))

    n_values = list(study_results.keys())
    df_means = [r['mean_df'] for r in study_results.values()]
    df_stds = [r['std_df'] for r in study_results.values()]

    ax.errorbar(n_values, df_means, yerr=df_stds, fmt='o-', capsize=5)
    ax.set_xlabel('Number of particles (N)')
    ax.set_ylabel('Fractal dimension (Df)')
    ax.set_title('Fractal Dimension vs. Particle Count')
    ax.grid(True, alpha=0.3)

    # Save to bytes
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    buf.seek(0)
    plt.close(fig)

    return buf.getvalue()
```

### 3D Visualization

```python
def render_3d_aggregate(geometry: np.ndarray) -> bytes:
    """Render 3D view of aggregate using existing Three.js viewer."""
    # Option 1: Server-side rendering with PyVista
    # Option 2: Return geometry data for client-side render
    # Option 3: Capture screenshot from headless browser

    # For simplicity, use PyVista
    import pyvista as pv

    plotter = pv.Plotter(off_screen=True)
    plotter.add_mesh(create_spheres(geometry))
    plotter.camera_position = 'iso'

    return plotter.screenshot()
```

---

## Async Export for Large Files

### When to Use Async

| Content | Size Estimate | Async? |
|---------|--------------|--------|
| Single simulation CSV | < 10KB | No |
| Study CSV (100 sims) | < 100KB | No |
| DOCX with images | 1-10MB | Yes |
| LaTeX with figures | 5-50MB | Yes |
| Full geometry export | 100MB+ | Yes |

### Async Pattern

```python
@celery_app.task
def generate_report_task(report_config: dict, user_id: int):
    # Generate report (slow)
    content = generate_full_report(report_config)

    # Store file
    filename = f"report_{report_config['study_id']}.docx"
    path = save_to_storage(content, filename)

    # Notify user
    notify_user_report_ready(user_id, path)

    return {"path": path, "filename": filename}
```

---

## Key Takeaways

1. **Multiple formats**: CSV for data, DOCX for reports, LaTeX for publication
2. **AI-assisted content**: Generate narrative text, not just data
3. **Templates**: Ensure consistent, professional output
4. **Async for large files**: Don't block the user
5. **Temporary storage**: Clean up exports after delivery
6. **Plots included**: Scientific figures enhance reports

---

## Further Reading

- [python-docx Documentation](https://python-docx.readthedocs.io/)
- [PyLaTeX Documentation](https://jeltef.github.io/PyLaTeX/)
- [Matplotlib for Scientific Visualization](https://matplotlib.org/stable/gallery/index.html)
