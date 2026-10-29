# Theory: Similarity Search

Finding relevant documents through vector similarity.

---

## How Similarity Search Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Similarity Search Flow                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Query: "What is the fractal dimension of DLA aggregates?"          │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Embed Query                                     │   │
│  │  [0.12, -0.45, 0.78, ..., 0.23]                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Vector Database                                 │   │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                    │   │
│  │  │Chunk│ │Chunk│ │Chunk│ │Chunk│ │Chunk│  (1000s of chunks) │   │
│  │  │  1  │ │  2  │ │  3  │ │  4  │ │  N  │                    │   │
│  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Compute Similarities                            │   │
│  │  cosine(query, chunk_1) = 0.89  ← Most similar              │   │
│  │  cosine(query, chunk_2) = 0.72                              │   │
│  │  cosine(query, chunk_3) = 0.68                              │   │
│  │  ...                                                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  Top-K Results: Chunks 1, 2, 3 (sorted by similarity)               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Similarity Metrics

### Cosine Similarity

```
similarity = (A · B) / (||A|| × ||B||)

Range: [-1, 1] or [0, 1] if normalized
1 = identical direction
0 = orthogonal
-1 = opposite direction
```

**Use when**: Vectors not normalized, most common choice

### Dot Product

```
similarity = A · B = Σ(Ai × Bi)

Faster than cosine (no normalization)
Requires pre-normalized vectors
```

**Use when**: Speed matters, vectors already normalized

### Euclidean Distance

```
distance = √(Σ(Ai - Bi)²)

Smaller = more similar
Need to convert to similarity: 1 / (1 + distance)
```

**Use when**: Absolute differences matter

---

## Search Strategies

### Pure Vector Search

```python
def vector_search(query: str, k: int = 10) -> list[Chunk]:
    query_embedding = embed(query)
    results = vector_db.search(query_embedding, top_k=k)
    return results
```

**Pros**: Semantic understanding
**Cons**: May miss exact keyword matches

### Keyword Search (BM25)

```python
def keyword_search(query: str, k: int = 10) -> list[Chunk]:
    # Full-text search using BM25 algorithm
    results = text_index.search(query, top_k=k)
    return results
```

**Pros**: Exact match, handles rare terms
**Cons**: No semantic understanding

### Hybrid Search (Recommended)

```python
def hybrid_search(query: str, k: int = 10, alpha: float = 0.7):
    """
    Combine vector and keyword search.
    alpha = weight for vector search (0.7 = 70% vector, 30% keyword)
    """
    vector_results = vector_search(query, k=k*2)
    keyword_results = keyword_search(query, k=k*2)

    # Reciprocal Rank Fusion
    combined = reciprocal_rank_fusion(vector_results, keyword_results)

    return combined[:k]

def reciprocal_rank_fusion(lists: list[list], k: int = 60):
    """Merge ranked lists using RRF."""
    scores = {}
    for ranked_list in lists:
        for rank, item in enumerate(ranked_list):
            if item not in scores:
                scores[item] = 0
            scores[item] += 1 / (k + rank + 1)

    return sorted(scores.keys(), key=lambda x: scores[x], reverse=True)
```

**Pros**: Best of both worlds
**Cons**: More complex, slightly slower

---

## Metadata Filtering

Narrow results before or after vector search:

### Pre-Filtering (Filter then Search)

```python
# Search only papers from 2020+
results = vector_db.search(
    query_embedding,
    filter={"year": {"$gte": 2020}},
    top_k=10
)
```

**Pros**: Faster, fewer comparisons
**Cons**: May miss relevant older papers

### Post-Filtering (Search then Filter)

```python
# Search, then filter results
results = vector_db.search(query_embedding, top_k=100)
filtered = [r for r in results if r.metadata["year"] >= 2020][:10]
```

**Pros**: Better recall
**Cons**: Slower, may need to over-fetch

---

## Query Expansion

Improve retrieval by expanding the query:

### Synonym Expansion

```python
def expand_query(query: str) -> str:
    expansions = {
        "Df": "fractal dimension",
        "DLA": "diffusion limited aggregation",
        "Rg": "radius of gyration"
    }
    for abbrev, full in expansions.items():
        if abbrev in query:
            query += f" {full}"
    return query
```

### Multi-Query

```python
def multi_query_search(query: str, k: int = 10):
    """Generate multiple query variants and merge results."""
    # Generate variants using LLM
    variants = [
        query,
        rephrase_query(query),
        extract_keywords(query)
    ]

    all_results = []
    for variant in variants:
        results = vector_search(variant, k=k)
        all_results.extend(results)

    # Deduplicate and rerank
    return dedupe_and_rank(all_results)[:k]
```

---

## Score Normalization

Raw similarity scores vary by query. Normalize for consistency:

```python
def normalize_scores(results: list[SearchResult]) -> list[SearchResult]:
    """Normalize scores to [0, 1] range."""
    if not results:
        return results

    scores = [r.score for r in results]
    min_score, max_score = min(scores), max(scores)
    range_score = max_score - min_score

    if range_score == 0:
        return results

    for r in results:
        r.normalized_score = (r.score - min_score) / range_score

    return results
```

---

## Performance Optimization

### Approximate Nearest Neighbors (ANN)

Exact search is O(n). ANN indexes make it O(log n):

| Index | Use Case | Trade-off |
|-------|----------|-----------|
| Flat | < 10K vectors | Exact but slow |
| IVF | 10K-1M vectors | ~95% recall |
| HNSW | > 100K vectors | Best accuracy/speed |

### Caching

```python
from functools import lru_cache

@lru_cache(maxsize=1000)
def cached_embed(query: str) -> list[float]:
    """Cache query embeddings."""
    return embedding_model.encode(query)
```

### Batch Queries

```python
def batch_search(queries: list[str], k: int = 10):
    """Search multiple queries efficiently."""
    embeddings = embedding_model.encode(queries)  # Batch embedding
    results = []
    for emb in embeddings:
        results.append(vector_db.search(emb, top_k=k))
    return results
```

---

## Result Quality

### Relevance Threshold

```python
def filter_by_relevance(results: list[SearchResult], threshold: float = 0.7):
    """Remove results below relevance threshold."""
    return [r for r in results if r.score >= threshold]
```

### Diversity

Avoid returning very similar chunks:

```python
def diversify_results(results: list[SearchResult], min_distance: float = 0.1):
    """Remove near-duplicate results."""
    diverse = [results[0]]
    for r in results[1:]:
        is_diverse = all(
            cosine_distance(r.embedding, d.embedding) > min_distance
            for d in diverse
        )
        if is_diverse:
            diverse.append(r)
    return diverse
```

---

## Key Takeaways

1. **Cosine similarity**: Standard metric for semantic search
2. **Hybrid search**: Combine vector + keyword for best results
3. **Metadata filters**: Narrow results by attributes
4. **Query expansion**: Handle abbreviations, synonyms
5. **ANN indexes**: Essential for scale
6. **Relevance thresholds**: Filter low-quality matches

---

## Further Reading

- [FAISS Library](https://faiss.ai/)
- [Hybrid Search Explained](https://www.pinecone.io/learn/hybrid-search-intro/)
- [BM25 Algorithm](https://en.wikipedia.org/wiki/Okapi_BM25)
