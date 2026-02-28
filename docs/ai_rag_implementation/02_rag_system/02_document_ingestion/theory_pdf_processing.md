# Theory: PDF Processing

Extracting text from scientific PDFs for RAG systems.

---

## The PDF Challenge

Scientific PDFs are complex:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Scientific PDF Structure                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Multi-column layouts                                       │   │
│  │  ┌──────────────┐  ┌──────────────┐                         │   │
│  │  │  Column 1    │  │  Column 2    │                         │   │
│  │  │  Text flows  │  │  Continues   │                         │   │
│  │  │  here...     │  │  here...     │                         │   │
│  │  └──────────────┘  └──────────────┘                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Embedded elements                                          │   │
│  │  • Equations: $D_f = \lim_{\epsilon \to 0}...$              │   │
│  │  • Tables: Structured data                                  │   │
│  │  • Figures: Images with captions                            │   │
│  │  • Citations: Reference markers [1], [2]                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Metadata                                                   │   │
│  │  • Title, Authors, Abstract                                 │   │
│  │  • References section                                       │   │
│  │  • Page numbers, headers, footers                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## PDF Processing Libraries

### pdfplumber (Recommended)

```python
import pdfplumber

def extract_with_pdfplumber(pdf_path: str) -> str:
    text = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            # Extract text maintaining layout
            page_text = page.extract_text()
            if page_text:
                text.append(page_text)

            # Extract tables separately
            tables = page.extract_tables()
            for table in tables:
                text.append(format_table(table))

    return "\n\n".join(text)
```

**Pros**: Good layout handling, table extraction, accurate
**Cons**: Slower than alternatives

### pypdf

```python
from pypdf import PdfReader

def extract_with_pypdf(pdf_path: str) -> str:
    reader = PdfReader(pdf_path)
    text = []
    for page in reader.pages:
        text.append(page.extract_text())
    return "\n".join(text)
```

**Pros**: Fast, simple
**Cons**: Less accurate layout handling

### pymupdf (fitz)

```python
import fitz

def extract_with_pymupdf(pdf_path: str) -> str:
    doc = fitz.open(pdf_path)
    text = []
    for page in doc:
        text.append(page.get_text())
    return "\n".join(text)
```

**Pros**: Very fast, handles images
**Cons**: C dependency

### Docling (Advanced)

```python
from docling.document_converter import DocumentConverter

converter = DocumentConverter()
result = converter.convert(pdf_path)

# Returns structured document with:
# - Sections
# - Tables
# - Figures
# - Equations
```

**Pros**: Best structure preservation, ML-based
**Cons**: Heavier, requires more setup

---

## Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PDF Processing Pipeline                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Load PDF                                                        │
│     └── Handle encrypted, corrupted files                           │
│                                                                     │
│  2. Extract Metadata                                                │
│     └── Title, authors, creation date                               │
│                                                                     │
│  3. Process Each Page                                               │
│     ├── Extract text                                                │
│     ├── Extract tables                                              │
│     ├── Identify figures/captions                                   │
│     └── Track page numbers                                          │
│                                                                     │
│  4. Identify Sections                                               │
│     ├── Abstract                                                    │
│     ├── Introduction                                                │
│     ├── Methods                                                     │
│     ├── Results                                                     │
│     ├── Discussion                                                  │
│     └── References                                                  │
│                                                                     │
│  5. Clean Text                                                      │
│     ├── Remove headers/footers                                      │
│     ├── Fix hyphenation                                             │
│     ├── Normalize whitespace                                        │
│     └── Handle special characters                                   │
│                                                                     │
│  6. Output Structured Document                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Handling Common Issues

### Multi-Column Layout

```python
def extract_columns(page) -> str:
    # Get page dimensions
    width = page.width
    mid = width / 2

    # Extract left column
    left_bbox = (0, 0, mid, page.height)
    left_text = page.within_bbox(left_bbox).extract_text()

    # Extract right column
    right_bbox = (mid, 0, width, page.height)
    right_text = page.within_bbox(right_bbox).extract_text()

    return left_text + "\n" + right_text
```

### Hyphenation

```python
def fix_hyphenation(text: str) -> str:
    # Fix word breaks across lines
    import re
    # "agglo-\nmerate" -> "agglomerate"
    return re.sub(r'(\w+)-\n(\w+)', r'\1\2', text)
```

### Headers and Footers

```python
def remove_headers_footers(pages: list[str]) -> list[str]:
    # Find repeated lines across pages
    from collections import Counter

    all_lines = []
    for page in pages:
        lines = page.split('\n')
        all_lines.extend(lines[:3])  # First 3 lines
        all_lines.extend(lines[-3:])  # Last 3 lines

    repeated = [line for line, count in Counter(all_lines).items()
                if count > len(pages) * 0.5]

    # Remove repeated lines
    cleaned = []
    for page in pages:
        lines = [l for l in page.split('\n') if l not in repeated]
        cleaned.append('\n'.join(lines))

    return cleaned
```

### Tables

```python
def format_table(table: list[list[str]]) -> str:
    """Convert table to markdown format."""
    if not table:
        return ""

    lines = []
    # Header
    lines.append("| " + " | ".join(table[0]) + " |")
    lines.append("| " + " | ".join(["---"] * len(table[0])) + " |")
    # Rows
    for row in table[1:]:
        lines.append("| " + " | ".join(row) + " |")

    return "\n".join(lines)
```

---

## Metadata Extraction

### From PDF Properties

```python
def extract_metadata(pdf_path: str) -> dict:
    reader = PdfReader(pdf_path)
    meta = reader.metadata

    return {
        "title": meta.title if meta else None,
        "author": meta.author if meta else None,
        "subject": meta.subject if meta else None,
        "creation_date": meta.creation_date if meta else None,
    }
```

### From Document Content

```python
def extract_title_from_content(text: str) -> str | None:
    """Extract title from first page content."""
    lines = text.split('\n')

    # Usually the largest/first text is the title
    for line in lines[:10]:
        line = line.strip()
        if len(line) > 10 and len(line) < 200:
            if not line.startswith('Abstract'):
                return line

    return None
```

### Abstract Extraction

```python
def extract_abstract(text: str) -> str | None:
    """Extract abstract section."""
    import re

    # Look for Abstract section
    match = re.search(
        r'Abstract[:\s]*\n?(.*?)(?=\n\n|Introduction|Keywords)',
        text,
        re.IGNORECASE | re.DOTALL
    )

    if match:
        return match.group(1).strip()

    return None
```

---

## Quality Checks

### Extraction Quality

```python
def assess_extraction_quality(text: str) -> dict:
    """Check if extraction was successful."""
    issues = []

    # Check for common problems
    if len(text) < 1000:
        issues.append("Very short extraction")

    if text.count('�') > 10:
        issues.append("Encoding issues")

    # Check word density (vs garbage)
    words = text.split()
    avg_word_len = sum(len(w) for w in words) / max(len(words), 1)
    if avg_word_len < 3 or avg_word_len > 15:
        issues.append("Unusual word lengths")

    return {
        "char_count": len(text),
        "word_count": len(words),
        "issues": issues,
        "quality": "good" if not issues else "needs_review"
    }
```

---

## Async Processing

For large PDFs, process asynchronously:

```python
from celery import shared_task

@shared_task
def process_pdf_task(document_id: int):
    document = Document.objects.get(id=document_id)
    document.status = "processing"
    document.save()

    try:
        # Extract text
        text = extract_with_pdfplumber(document.file.path)

        # Extract metadata
        metadata = extract_metadata(document.file.path)

        # Update document
        document.abstract = extract_abstract(text)
        document.metadata = metadata
        document.status = "ready"
        document.save()

        # Trigger chunking
        chunk_document_task.delay(document_id, text)

    except Exception as e:
        document.status = "failed"
        document.metadata["error"] = str(e)
        document.save()
```

---

## Key Takeaways

1. **Use pdfplumber**: Best balance of accuracy and features
2. **Handle layout**: Multi-column, tables, figures
3. **Clean aggressively**: Remove headers, fix hyphenation
4. **Extract metadata**: Title, authors, abstract
5. **Quality check**: Verify extraction succeeded
6. **Process async**: Large PDFs in background

---

## Further Reading

- [pdfplumber Documentation](https://github.com/jsvine/pdfplumber)
- [pypdf Documentation](https://pypdf.readthedocs.io/)
- [Docling by DS4SD](https://github.com/DS4SD/docling)
