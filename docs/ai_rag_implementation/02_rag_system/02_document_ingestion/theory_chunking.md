# Theory: Text Chunking

Splitting documents into optimal chunks for retrieval.

---

## Why Chunk?

LLMs have context limits. Embedding models have token limits. We need to split documents:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      The Chunking Problem                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Document (50 pages, ~50,000 tokens)                                │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Can't embed whole document (model limit: 8192 tokens)       │   │
│  │ Can't search whole document (too coarse)                    │   │
│  │ Can't fit in LLM context with other content                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  Split into chunks (300-1000 tokens each)                           │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Chunk 1: Abstract + intro (500 tokens)                      │   │
│  │ Chunk 2: Methods section (450 tokens)                       │   │
│  │ Chunk 3: Results part 1 (600 tokens)                        │   │
│  │ ...                                                         │   │
│  │ Chunk N: References (400 tokens)                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Chunking Strategies

### Fixed Size Chunking

```python
def fixed_size_chunks(text: str, chunk_size: int = 500, overlap: int = 50):
    """Split text into fixed-size chunks with overlap."""
    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]

        # Try to end at a sentence boundary
        if end < len(text):
            last_period = chunk.rfind('.')
            if last_period > chunk_size * 0.8:
                end = start + last_period + 1
                chunk = text[start:end]

        chunks.append(chunk)
        start = end - overlap

    return chunks
```

**Pros**: Simple, predictable size
**Cons**: May break mid-sentence, mid-thought

### Sentence-Based Chunking

```python
import nltk
nltk.download('punkt')

def sentence_chunks(text: str, max_chunk_size: int = 500):
    """Group sentences into chunks."""
    sentences = nltk.sent_tokenize(text)
    chunks = []
    current_chunk = []
    current_size = 0

    for sentence in sentences:
        sentence_size = len(sentence)

        if current_size + sentence_size > max_chunk_size and current_chunk:
            chunks.append(' '.join(current_chunk))
            current_chunk = []
            current_size = 0

        current_chunk.append(sentence)
        current_size += sentence_size

    if current_chunk:
        chunks.append(' '.join(current_chunk))

    return chunks
```

**Pros**: Preserves sentences
**Cons**: Variable chunk sizes

### Semantic Chunking

```python
def semantic_chunks(text: str, max_chunk_size: int = 500):
    """Split at semantic boundaries (paragraphs, sections)."""
    # Split by double newlines (paragraphs)
    paragraphs = text.split('\n\n')

    chunks = []
    current_chunk = []
    current_size = 0

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        para_size = len(para)

        if current_size + para_size > max_chunk_size and current_chunk:
            chunks.append('\n\n'.join(current_chunk))
            current_chunk = []
            current_size = 0

        current_chunk.append(para)
        current_size += para_size

    if current_chunk:
        chunks.append('\n\n'.join(current_chunk))

    return chunks
```

**Pros**: Preserves meaning better
**Cons**: Needs clean paragraph structure

### Section-Based Chunking

```python
import re

def section_chunks(text: str, max_chunk_size: int = 1000):
    """Split by section headers."""
    # Find section headers
    sections = re.split(
        r'\n(?=[A-Z][A-Z\s]+\n|(?:\d+\.?\s+)?(?:Introduction|Methods|Results|Discussion|Conclusion))',
        text
    )

    chunks = []
    for section in sections:
        section = section.strip()
        if not section:
            continue

        if len(section) <= max_chunk_size:
            chunks.append(section)
        else:
            # Further split large sections
            sub_chunks = semantic_chunks(section, max_chunk_size)
            chunks.extend(sub_chunks)

    return chunks
```

**Pros**: Best semantic preservation
**Cons**: Requires header detection

---

## Overlap Strategy

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Why Use Overlap?                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Without overlap:                                                   │
│  ┌──────────────┐┌──────────────┐┌──────────────┐                  │
│  │   Chunk 1    ││   Chunk 2    ││   Chunk 3    │                  │
│  │ "...studied" ││ "aggregates" ││ "showed..."  │                  │
│  └──────────────┘└──────────────┘└──────────────┘                  │
│  ▲                                                                  │
│  │ Information lost at boundaries!                                  │
│                                                                     │
│  With overlap:                                                      │
│  ┌──────────────────┐                                              │
│  │      Chunk 1     │                                              │
│  │ "...studied DLA  │                                              │
│  │  aggregates..."  │                                              │
│  └──────────────────┘                                              │
│           ┌──────────────────┐                                     │
│           │      Chunk 2     │                                     │
│           │ "DLA aggregates  │                                     │
│           │  showed that..." │                                     │
│           └──────────────────┘                                     │
│  ▲                                                                  │
│  │ Overlap preserves context!                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Overlap

| Chunk Size | Overlap | Overlap % |
|------------|---------|-----------|
| 500 chars | 50-100 | 10-20% |
| 1000 chars | 100-200 | 10-20% |
| 2000 chars | 200-400 | 10-20% |

---

## Chunk Size Considerations

### Too Small (< 200 chars)

```
"Fractal dimension"
"was measured"
"to be 1.78"
```
- Loses context
- Many irrelevant matches
- Higher storage/search cost

### Too Large (> 2000 chars)

```
"[Entire methods section including all details about equipment,
procedures, calculations, and references...]"
```
- Dilutes relevance
- May exceed embedding limits
- Uses too much LLM context

### Just Right (400-800 chars)

```
"We measured the fractal dimension of DLA aggregates using the
box-counting method. Simulations were run with particle counts
ranging from 100 to 10,000. The resulting Df values averaged
1.78 ± 0.05, consistent with theoretical predictions."
```
- Enough context
- Specific enough for relevance
- Fits in embedding models

---

## Metadata Preservation

Each chunk should carry metadata:

```python
@dataclass
class Chunk:
    content: str
    metadata: dict

# Example chunk with metadata
chunk = Chunk(
    content="The fractal dimension was measured...",
    metadata={
        "document_id": "doc_123",
        "document_title": "DLA Study 2024",
        "page_number": 5,
        "section": "Results",
        "chunk_index": 12,
        "total_chunks": 45,
        "authors": ["Smith", "Jones"],
        "year": 2024
    }
)
```

---

## Implementation

```python
from dataclasses import dataclass
from typing import Generator

@dataclass
class ChunkConfig:
    chunk_size: int = 500
    overlap: int = 50
    strategy: str = "semantic"  # fixed, sentence, semantic, section

class Chunker:
    def __init__(self, config: ChunkConfig):
        self.config = config

    def chunk_document(
        self,
        text: str,
        document_metadata: dict
    ) -> Generator[Chunk, None, None]:
        """Generate chunks from document text."""

        if self.config.strategy == "semantic":
            raw_chunks = self._semantic_chunk(text)
        elif self.config.strategy == "sentence":
            raw_chunks = self._sentence_chunk(text)
        else:
            raw_chunks = self._fixed_chunk(text)

        for i, chunk_text in enumerate(raw_chunks):
            yield Chunk(
                content=chunk_text,
                metadata={
                    **document_metadata,
                    "chunk_index": i,
                    "total_chunks": len(raw_chunks)
                }
            )

    def _semantic_chunk(self, text: str) -> list[str]:
        # Implementation from above
        ...

    def _sentence_chunk(self, text: str) -> list[str]:
        # Implementation from above
        ...

    def _fixed_chunk(self, text: str) -> list[str]:
        # Implementation from above
        ...
```

---

## Quality Metrics

### Chunk Quality Checks

```python
def assess_chunk_quality(chunk: str) -> dict:
    """Evaluate chunk quality."""
    issues = []

    # Too short
    if len(chunk) < 100:
        issues.append("too_short")

    # Too long
    if len(chunk) > 2000:
        issues.append("too_long")

    # Starts mid-sentence
    if chunk[0].islower():
        issues.append("starts_mid_sentence")

    # Ends mid-sentence
    if chunk[-1] not in '.!?':
        issues.append("ends_mid_sentence")

    # Contains mostly references
    ref_count = chunk.count('[') + chunk.count(']')
    if ref_count > len(chunk) / 50:
        issues.append("mostly_references")

    return {
        "length": len(chunk),
        "word_count": len(chunk.split()),
        "issues": issues,
        "quality": "good" if not issues else "needs_review"
    }
```

---

## Key Takeaways

1. **Match chunk size to use case**: 400-800 chars works well
2. **Use overlap**: 10-20% prevents boundary issues
3. **Prefer semantic boundaries**: Paragraphs > fixed size
4. **Preserve metadata**: Track source, position, section
5. **Quality check chunks**: Filter out bad splits
6. **Test with real queries**: Adjust based on retrieval quality

---

## Further Reading

- [LangChain Text Splitters](https://python.langchain.com/docs/how_to/recursive_text_splitter/)
- [Chunking Strategies Comparison](https://www.pinecone.io/learn/chunking-strategies/)
- [NLTK Sentence Tokenization](https://www.nltk.org/api/nltk.tokenize.html)
