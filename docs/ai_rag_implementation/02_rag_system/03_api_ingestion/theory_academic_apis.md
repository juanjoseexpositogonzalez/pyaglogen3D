# Theory: Academic APIs

Automating paper ingestion from arXiv and Semantic Scholar.

---

## Why API Ingestion?

Manual PDF upload is tedious. Academic APIs provide:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    API Ingestion Benefits                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ✓ Discover papers by topic                                         │
│  ✓ Get structured metadata (title, authors, year)                   │
│  ✓ Download PDFs automatically                                      │
│  ✓ Follow citation networks                                         │
│  ✓ Keep knowledge base updated                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## arXiv API

### Overview

- Free, no authentication required
- Rate limit: 1 request per 3 seconds
- Returns XML (Atom feed)
- Direct PDF access

### Search Endpoint

```python
import arxiv

def search_arxiv(query: str, max_results: int = 10):
    """Search arXiv for papers."""
    search = arxiv.Search(
        query=query,
        max_results=max_results,
        sort_by=arxiv.SortCriterion.Relevance
    )

    papers = []
    for result in search.results():
        papers.append({
            "arxiv_id": result.entry_id.split("/")[-1],
            "title": result.title,
            "authors": [a.name for a in result.authors],
            "abstract": result.summary,
            "published": result.published,
            "pdf_url": result.pdf_url,
            "categories": result.categories,
        })

    return papers
```

### Query Syntax

```python
# Topic search
"fractal dimension aggregation"

# Author search
"au:Witten AND au:Sander"

# Category filter
"cat:cond-mat.soft AND fractal"

# Date range
"submittedDate:[2020 TO 2024]"

# Combined
"(fractal OR aggregation) AND cat:physics"
```

### Download PDF

```python
def download_arxiv_pdf(arxiv_id: str, output_path: str):
    """Download PDF from arXiv."""
    paper = next(arxiv.Search(id_list=[arxiv_id]).results())
    paper.download_pdf(filename=output_path)
```

---

## Semantic Scholar API

### Overview

- Free tier: 100 requests/5 min (authenticated: 1 request/sec)
- Returns JSON
- Rich metadata (citations, references, topics)
- No direct PDF (links only)

### Paper Search

```python
import requests

S2_API_BASE = "https://api.semanticscholar.org/graph/v1"

def search_semantic_scholar(query: str, limit: int = 10):
    """Search Semantic Scholar."""
    response = requests.get(
        f"{S2_API_BASE}/paper/search",
        params={
            "query": query,
            "limit": limit,
            "fields": "title,authors,abstract,year,citationCount,openAccessPdf"
        }
    )

    papers = []
    for paper in response.json().get("data", []):
        papers.append({
            "s2_id": paper["paperId"],
            "title": paper.get("title"),
            "authors": [a["name"] for a in paper.get("authors", [])],
            "abstract": paper.get("abstract"),
            "year": paper.get("year"),
            "citation_count": paper.get("citationCount"),
            "pdf_url": paper.get("openAccessPdf", {}).get("url"),
        })

    return papers
```

### Get Paper Details

```python
def get_paper_details(paper_id: str):
    """Get detailed paper info including references."""
    response = requests.get(
        f"{S2_API_BASE}/paper/{paper_id}",
        params={
            "fields": "title,authors,abstract,year,references,citations"
        }
    )
    return response.json()
```

### Citation Network

```python
def get_citations(paper_id: str, limit: int = 50):
    """Get papers that cite this paper."""
    response = requests.get(
        f"{S2_API_BASE}/paper/{paper_id}/citations",
        params={
            "limit": limit,
            "fields": "title,authors,year"
        }
    )
    return response.json().get("data", [])

def get_references(paper_id: str, limit: int = 50):
    """Get papers this paper references."""
    response = requests.get(
        f"{S2_API_BASE}/paper/{paper_id}/references",
        params={
            "limit": limit,
            "fields": "title,authors,year"
        }
    )
    return response.json().get("data", [])
```

---

## API Comparison

| Feature | arXiv | Semantic Scholar |
|---------|-------|------------------|
| Auth required | No | Optional (higher limits) |
| Rate limit | 1/3s | 100/5min |
| PDF access | Direct download | Links only |
| Metadata | Basic | Rich (citations) |
| Coverage | Physics, CS, Math | Broad academic |
| Citation data | No | Yes |

---

## Implementation Strategy

### Unified Paper Interface

```python
@dataclass
class Paper:
    source: str  # arxiv, semantic_scholar
    source_id: str
    title: str
    authors: list[str]
    abstract: str | None
    year: int | None
    pdf_url: str | None
    metadata: dict

class PaperSource(ABC):
    @abstractmethod
    def search(self, query: str, limit: int) -> list[Paper]:
        pass

    @abstractmethod
    def get_paper(self, paper_id: str) -> Paper:
        pass

    @abstractmethod
    def download_pdf(self, paper: Paper, output_path: str) -> bool:
        pass
```

### Rate Limiting

```python
import time
from functools import wraps

def rate_limited(max_per_second: float):
    """Decorator for rate limiting API calls."""
    min_interval = 1.0 / max_per_second
    last_called = [0.0]

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            elapsed = time.time() - last_called[0]
            if elapsed < min_interval:
                time.sleep(min_interval - elapsed)
            last_called[0] = time.time()
            return func(*args, **kwargs)
        return wrapper
    return decorator

@rate_limited(0.33)  # 1 request per 3 seconds
def call_arxiv_api(...):
    ...
```

### Caching

```python
from django.core.cache import cache

def get_paper_cached(source: str, paper_id: str):
    """Get paper with caching."""
    cache_key = f"paper:{source}:{paper_id}"
    paper = cache.get(cache_key)

    if not paper:
        paper = fetch_paper(source, paper_id)
        cache.set(cache_key, paper, timeout=86400)  # 24h

    return paper
```

---

## Ingestion Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    API Ingestion Workflow                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Admin searches: "fractal aggregation DLA"                       │
│         │                                                           │
│         ▼                                                           │
│  2. Query arXiv + Semantic Scholar                                  │
│         │                                                           │
│         ▼                                                           │
│  3. Display results with "Import" buttons                           │
│         │                                                           │
│         ▼                                                           │
│  4. Admin selects papers to import                                  │
│         │                                                           │
│         ▼                                                           │
│  5. For each selected paper:                                        │
│     a. Create Document record                                       │
│     b. Download PDF (if available)                                  │
│     c. Queue ingestion task                                         │
│         │                                                           │
│         ▼                                                           │
│  6. Background: Extract text, chunk, embed, store                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Handling Missing PDFs

Not all papers have accessible PDFs:

```python
def ingest_paper(paper: Paper):
    """Ingest paper, handling missing PDFs."""

    # Create document record
    document = Document.objects.create(
        title=paper.title,
        authors=paper.authors,
        abstract=paper.abstract,
        year=paper.year,
        source=paper.source,
        source_id=paper.source_id,
        url=paper.pdf_url,
        status="pending"
    )

    if paper.pdf_url:
        # Try to download PDF
        try:
            pdf_path = download_pdf(paper.pdf_url)
            document.file = pdf_path
            document.save()
            ingest_document_task.delay(document.id)
        except DownloadError:
            # Fall back to abstract-only
            ingest_abstract_only(document)
    else:
        # No PDF available - index abstract only
        ingest_abstract_only(document)

def ingest_abstract_only(document: Document):
    """Create chunks from abstract when PDF unavailable."""
    if document.abstract:
        chunk = DocumentChunk.objects.create(
            document=document,
            content=document.abstract,
            chunk_index=0,
            section="abstract"
        )
        embed_and_store([chunk])
        document.status = "ready"
        document.save()
```

---

## Scheduled Updates

Keep knowledge base fresh:

```python
from celery import shared_task
from celery.schedules import crontab

@shared_task
def update_knowledge_base():
    """Weekly task to find new papers."""

    # Get recent papers in our topics
    topics = [
        "fractal aggregation",
        "DLA simulation",
        "nanoparticle aerosol"
    ]

    for topic in topics:
        papers = search_arxiv(topic, max_results=20)
        for paper in papers:
            if not Document.objects.filter(source_id=paper["arxiv_id"]).exists():
                # New paper - queue for review
                PendingPaper.objects.create(
                    source="arxiv",
                    source_id=paper["arxiv_id"],
                    title=paper["title"],
                    metadata=paper
                )

# Schedule: Every Sunday at 2am
# config/celery.py
app.conf.beat_schedule = {
    'update-knowledge-base': {
        'task': 'apps.rag.tasks.update_knowledge_base',
        'schedule': crontab(hour=2, minute=0, day_of_week=0),
    },
}
```

---

## Key Takeaways

1. **Use both APIs**: arXiv for physics/CS, Semantic Scholar for broader
2. **Rate limit requests**: Respect API limits
3. **Cache responses**: Avoid redundant API calls
4. **Handle missing PDFs**: Fall back to abstract indexing
5. **Automate updates**: Scheduled discovery of new papers
6. **Admin approval**: Review before full ingestion

---

## Further Reading

- [arXiv API Documentation](https://info.arxiv.org/help/api/index.html)
- [Semantic Scholar API](https://www.semanticscholar.org/product/api)
- [arxiv Python Package](https://github.com/lukasschwab/arxiv.py)
