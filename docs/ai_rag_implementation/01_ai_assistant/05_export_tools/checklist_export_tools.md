# Checklist: Export Tools

**Branch**: `feature/ai-export-tools`
**Depends on**: `feature/ai-tool-registry` merged
**Estimated time**: 1 day

---

## Prerequisites

- [ ] `feature/ai-tool-registry` branch merged to main
- [ ] Dependencies installed: python-docx, pylatex
- [ ] Matplotlib available for plot generation

---

## Backend Implementation

### Export Tool Definitions

- [ ] Create `apps/ai_assistant/tools/export_tools.py`

#### CSV Export Tools

- [ ] Implement `export_simulation_csv` tool:
  - Parameters:
    - simulation_id (required)
    - include_geometry (bool, default False)
  - Handler: Generate CSV with parameters and metrics
  - Return: CSV content (small) or download URL (large)

- [ ] Implement `export_study_csv` tool:
  - Parameters:
    - study_id (required)
    - include_statistics (bool, default True)
  - Handler:
    - Export all simulations in study
    - Add aggregated statistics rows
  - Return: CSV content or download URL

- [ ] Implement `export_comparison_csv` tool:
  - Parameters:
    - simulation_ids (array)
    - metrics (array)
  - Handler: Generate comparison table as CSV

#### DOCX Report Tools

- [ ] Implement `generate_docx_report` tool:
  - Parameters:
    - title (string)
    - simulation_ids or study_id
    - sections (array: summary, methods, results, discussion)
    - include_figures (bool, default True)
    - include_narrative (bool, default True)
  - Handler:
    - Generate report using python-docx
    - Include data tables
    - Include plots if requested
    - Include AI-generated narrative if requested
  - Return: Download URL
  - Async: Yes

- [ ] Implement `generate_quick_summary` tool:
  - Parameters:
    - simulation_id or study_id
  - Handler: Generate 1-page summary document
  - Return: Download URL or inline content

#### LaTeX Export Tools

- [ ] Implement `generate_latex_report` tool:
  - Parameters:
    - title (string)
    - simulation_ids or study_id
    - template (enum: article, report)
    - include_bibliography (bool, default True)
  - Handler:
    - Generate .tex file using pylatex
    - Generate figures as separate files
    - Generate .bib file
    - Package as .zip
  - Return: Download URL
  - Async: Yes

- [ ] Implement `export_latex_table` tool:
  - Parameters:
    - simulation_ids (array)
    - metrics (array)
    - caption (string)
  - Handler: Generate LaTeX table code
  - Return: LaTeX code string (inline)

#### Image Export Tools

- [ ] Implement `generate_plot` tool:
  - Parameters:
    - plot_type (enum: df_vs_n, df_distribution, rg_vs_n, custom)
    - data_source (study_id or simulation_ids)
    - format (enum: png, svg, pdf)
  - Handler: Generate matplotlib plot
  - Return: Image URL or base64 for small images

- [ ] Implement `render_3d_image` tool:
  - Parameters:
    - simulation_id
    - view_angle (enum: iso, front, top, side)
    - resolution (enum: low, medium, high)
  - Handler: Render 3D visualization
  - Return: Image URL
  - Async: Yes for high resolution

---

## Export Service

- [ ] Create `apps/ai_assistant/services/export_service.py`:
  - `ExportService` class
  - `export_csv(data, config) -> ExportResult`
  - `export_docx(data, config) -> ExportResult`
  - `export_latex(data, config) -> ExportResult`
  - `generate_plot(plot_config) -> bytes`

### Content Generation

- [ ] Create `apps/ai_assistant/services/content_generator.py`:
  - `ContentGenerator` class
  - `generate_summary(simulation_or_study) -> str`
  - `generate_methods_section(algorithm) -> str`
  - `generate_results_narrative(metrics) -> str`
  - `generate_discussion(results, literature_context) -> str`

### File Delivery

- [ ] Create `apps/ai_assistant/services/file_delivery.py`:
  - `FileDeliveryService` class
  - `deliver(content, filename, format) -> DeliveryResult`
  - Handle inline (small) vs URL (large) delivery
  - Schedule cleanup for temporary files

### Templates

- [ ] Create `apps/ai_assistant/templates/exports/`:
  - `report_template.docx` (base Word template)
  - `article_template.tex` (LaTeX article)
  - `table_template.tex` (LaTeX table)

---

## Celery Tasks

- [ ] Create export-specific tasks in `apps/ai_assistant/tasks.py`:
  - `generate_docx_report_task(config, user_id)`
  - `generate_latex_report_task(config, user_id)`
  - `render_3d_image_task(simulation_id, config)`
  - `cleanup_export_task(file_path)` (scheduled cleanup)

---

## Storage Configuration

- [ ] Configure temporary export storage:
  ```python
  # config/settings/base.py
  EXPORT_STORAGE_ROOT = "exports/"
  EXPORT_MAX_AGE_HOURS = 24
  EXPORT_MAX_INLINE_SIZE = 50 * 1024  # 50KB
  ```

- [ ] Add cleanup management command:
  ```bash
  python manage.py cleanup_old_exports
  ```

---

## Tool Registration

- [ ] Update `apps/ai_assistant/tools/registration.py`:
  - Import export_tools
  - Register all export tools

---

## Testing

### Unit Tests

- [ ] Create `apps/ai_assistant/tests/test_tools/test_export_tools.py`:
  - Test CSV generation
  - Test DOCX structure
  - Test LaTeX compilation (if LaTeX installed)
  - Test file delivery logic

- [ ] Create `apps/ai_assistant/tests/test_content_generator.py`:
  - Test summary generation
  - Test narrative quality (basic checks)

### Integration Tests

- [ ] Create `apps/ai_assistant/tests/test_export_integration.py`:
  - Test full export flow
  - Test async export with Celery
  - Test file cleanup

### Run Tests

- [ ] All tests pass: `pytest apps/ai_assistant/tests/test_tools/test_export*.py -v`

---

## Tool Summary

| Tool | Category | Async | Description |
|------|----------|-------|-------------|
| `export_simulation_csv` | export | No | Single simulation CSV |
| `export_study_csv` | export | No | Study CSV with stats |
| `export_comparison_csv` | export | No | Comparison table CSV |
| `generate_docx_report` | export | Yes | Word document report |
| `generate_quick_summary` | export | No | 1-page summary |
| `generate_latex_report` | export | Yes | LaTeX/PDF report |
| `export_latex_table` | export | No | LaTeX table code |
| `generate_plot` | export | No | Matplotlib plot |
| `render_3d_image` | export | Yes* | 3D visualization |

*Async for high resolution

---

## AI Response Examples

```
User: "Export my study results to CSV"
→ AI calls export_study_csv(study_id=45)
→ Returns: "Here's your CSV export: [download link]
           Contains 10 simulations with aggregated statistics."

User: "Generate a report of simulations 1-5 for my thesis"
→ AI calls generate_latex_report(
    title="DLA Study Results",
    simulation_ids=[1,2,3,4,5],
    template="article",
    include_bibliography=True
  )
→ Returns: "I've generated a LaTeX report: [download link]
           Includes: main.tex, figures/, references.bib
           Ready for compilation with pdflatex."

User: "Create a plot showing how Df changes with particle count"
→ AI calls generate_plot(
    plot_type="df_vs_n",
    data_source={"study_id": 45}
  )
→ Returns: "Here's your plot: [image]
           Shows Df stabilizing around 1.78 for n > 500."
```

---

## Manual Testing

- [ ] Start Django server: `python manage.py runserver`
- [ ] Start Celery: `celery -A config worker -l info`

- [ ] Test CSV export:
  ```bash
  http POST localhost:8000/api/v1/ai/tools/export_simulation_csv/execute/ \
    Authorization:"Bearer <token>" \
    simulation_id:=1
  ```

- [ ] Test DOCX report:
  ```bash
  http POST localhost:8000/api/v1/ai/tools/generate_docx_report/execute/ \
    Authorization:"Bearer <token>" \
    title="Test Report" \
    simulation_ids:='[1, 2]' \
    sections:='["summary", "results"]'
  ```

- [ ] Verify download URLs work
- [ ] Verify files are cleaned up after expiry

---

## Git

- [ ] Ensure on latest main: `git checkout main && git pull`
- [ ] Create branch: `git checkout -b feature/ai-export-tools`
- [ ] Commit each tool separately
- [ ] Push: `git push -u origin feature/ai-export-tools`
- [ ] Create PR to main

---

## Definition of Done

- [ ] All export tools implemented
- [ ] CSV, DOCX, LaTeX working
- [ ] Plot generation working
- [ ] Async exports functional
- [ ] File delivery and cleanup working
- [ ] All tests passing
- [ ] Manual testing successful
- [ ] PR reviewed and approved
- [ ] Merged to main
