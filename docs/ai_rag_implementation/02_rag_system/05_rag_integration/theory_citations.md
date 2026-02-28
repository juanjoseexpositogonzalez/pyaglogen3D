# Theory: Citation Generation

Adding verifiable references to AI responses.

---

## Why Citations Matter

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Without Citations                                 │
├─────────────────────────────────────────────────────────────────────┤
│  "DLA aggregates typically have a fractal dimension of 1.78."      │
│                                                                     │
│  ❓ Is this accurate?                                               │
│  ❓ Where does this come from?                                      │
│  ❓ Can I verify this?                                              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    With Citations                                    │
├─────────────────────────────────────────────────────────────────────┤
│  "DLA aggregates typically have a fractal dimension of 1.78         │
│   [Meakin, 1984]."                                                  │
│                                                                     │
│  ✓ Source identified                                                │
│  ✓ Verifiable claim                                                 │
│  ✓ Builds trust                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Citation Strategies

### Strategy 1: Inline Citations

Embed citations directly in response:

```
The fractal dimension of DLA aggregates has been studied extensively.
Witten and Sander [1] found Df ≈ 1.71 for 2D systems, while Meakin [2]
reported Df = 1.78 ± 0.05 for 3D aggregates.

References:
[1] Witten, T.A. & Sander, L.M. (1981). Physical Review Letters.
[2] Meakin, P. (1984). Physical Review A.
```

### Strategy 2: Footnote Citations

```
The fractal dimension is approximately 1.78¹.

---
¹ Meakin, P. (1984). "Formation of Fractal Clusters..." Physical Review A.
```

### Strategy 3: Linked Citations

For web interfaces:

```html
The fractal dimension is approximately 1.78
<a href="/documents/doc_123" title="Meakin 1984">[Meakin, 1984]</a>.
```

---

## Implementation

### Prompt Engineering for Citations

```python
CITATION_SYSTEM_PROMPT = """
You are a scientific research assistant with access to a knowledge base.

When citing sources:
1. Use [Author, Year] format inline
2. Only cite sources provided in the context
3. If multiple sources support a claim, cite all relevant ones
4. Include a "Sources" section at the end listing full references

Example:
"Studies show Df ≈ 1.78 for 3D DLA [Meakin, 1984]. This is consistent
with theoretical predictions [Witten & Sander, 1981]."

Sources:
- Meakin, P. (1984). Physical Review A.
- Witten, T.A. & Sander, L.M. (1981). Physical Review Letters.
"""
```

### Citation Extraction

```python
import re
from dataclasses import dataclass

@dataclass
class Citation:
    author: str
    year: int
    document_id: str | None
    full_reference: str

def extract_citations(response: str) -> list[Citation]:
    """Extract citations from LLM response."""
    # Pattern: [Author, Year] or [Author & Author, Year]
    pattern = r'\[([^,\]]+(?:\s*&\s*[^,\]]+)?),\s*(\d{4})\]'
    matches = re.findall(pattern, response)

    citations = []
    for author, year in matches:
        citations.append(Citation(
            author=author.strip(),
            year=int(year),
            document_id=None,
            full_reference=""
        ))

    return citations
```

### Citation Verification

```python
def verify_citations(
    citations: list[Citation],
    context: list[SearchResult]
) -> list[Citation]:
    """Verify citations match provided context."""
    verified = []

    for citation in citations:
        # Find matching document
        for result in context:
            doc = result.document
            # Check author match
            author_match = any(
                citation.author.lower() in author.lower()
                for author in doc.authors
            )
            # Check year match
            year_match = doc.year == citation.year

            if author_match and year_match:
                citation.document_id = doc.id
                citation.full_reference = format_reference(doc)
                citation.verified = True
                break
        else:
            citation.verified = False

        verified.append(citation)

    return verified

def format_reference(doc: Document) -> str:
    """Format full reference."""
    authors = ", ".join(doc.authors[:3])
    if len(doc.authors) > 3:
        authors += " et al."
    return f"{authors} ({doc.year}). {doc.title}."
```

### Adding Citation Links

```python
def add_citation_links(
    response: str,
    verified_citations: list[Citation]
) -> str:
    """Replace citations with links."""
    for citation in verified_citations:
        if citation.document_id:
            pattern = rf'\[{re.escape(citation.author)},\s*{citation.year}\]'
            link = f'[{citation.author}, {citation.year}](/documents/{citation.document_id})'
            response = re.sub(pattern, link, response)

    return response
```

---

## Citation Quality

### Hallucination Prevention

```python
def check_citation_quality(
    response: str,
    context: list[SearchResult]
) -> dict:
    """Check for citation issues."""
    citations = extract_citations(response)
    verified = verify_citations(citations, context)

    issues = []

    # Check for unverified citations
    unverified = [c for c in verified if not c.verified]
    if unverified:
        issues.append({
            "type": "unverified_citation",
            "citations": [f"{c.author}, {c.year}" for c in unverified]
        })

    # Check for claims without citations
    # (Heuristic: sentences with numbers should have citations)
    sentences = response.split('.')
    for sentence in sentences:
        has_number = bool(re.search(r'\d+\.\d+', sentence))
        has_citation = bool(re.search(r'\[[^\]]+\]', sentence))
        if has_number and not has_citation:
            issues.append({
                "type": "missing_citation",
                "sentence": sentence.strip()
            })

    return {
        "total_citations": len(citations),
        "verified": len([c for c in verified if c.verified]),
        "issues": issues
    }
```

---

## Response Post-Processing

```python
class ResponseProcessor:
    def __init__(self, context: list[SearchResult]):
        self.context = context

    def process(self, response: str) -> ProcessedResponse:
        """Process response for citations."""
        # Extract citations
        citations = extract_citations(response)

        # Verify against context
        verified = verify_citations(citations, self.context)

        # Add links
        linked_response = add_citation_links(response, verified)

        # Generate references section
        references = self.generate_references(verified)

        # Check quality
        quality = check_citation_quality(response, self.context)

        return ProcessedResponse(
            content=linked_response,
            citations=verified,
            references=references,
            quality=quality
        )

    def generate_references(self, citations: list[Citation]) -> str:
        """Generate references section."""
        unique = {c.document_id: c for c in citations if c.verified}
        refs = sorted(unique.values(), key=lambda c: (c.year, c.author))

        lines = ["\n## References\n"]
        for i, citation in enumerate(refs, 1):
            lines.append(f"[{i}] {citation.full_reference}")

        return "\n".join(lines)
```

---

## Frontend Display

```tsx
interface Citation {
    author: string;
    year: number;
    documentId: string;
    fullReference: string;
}

function CitationLink({ citation }: { citation: Citation }) {
    return (
        <Tooltip content={citation.fullReference}>
            <Link
                href={`/documents/${citation.documentId}`}
                className="text-primary hover:underline"
            >
                [{citation.author}, {citation.year}]
            </Link>
        </Tooltip>
    );
}

function ResponseWithCitations({
    content,
    citations
}: {
    content: string;
    citations: Citation[];
}) {
    // Replace citation markers with links
    let processed = content;
    for (const citation of citations) {
        const pattern = `[${citation.author}, ${citation.year}]`;
        processed = processed.replace(
            pattern,
            `<CitationLink id="${citation.documentId}" />`
        );
    }

    return <Markdown components={{ CitationLink }}>{processed}</Markdown>;
}
```

---

## Key Takeaways

1. **Prompt for citations**: Instruct LLM to cite sources
2. **Verify citations**: Check against actual context
3. **Link to documents**: Make citations clickable
4. **Quality checks**: Detect hallucinated citations
5. **Reference section**: Include full references

---

## Further Reading

- [Grounding LLM Responses](https://www.anthropic.com/research/grounding)
- [Citation Styles](https://www.scribbr.com/citing-sources/citation-styles/)
