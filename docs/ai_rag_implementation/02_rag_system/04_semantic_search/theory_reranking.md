# Theory: Reranking

Improving retrieval quality with second-stage ranking.

---

## Why Rerank?

First-stage retrieval is fast but imprecise. Reranking refines results:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Two-Stage Retrieval                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Stage 1: Fast Retrieval (Bi-encoder)                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Query embedding ──► Vector search ──► Top 100 candidates   │   │
│  │  Speed: ~10ms                                               │   │
│  │  Precision: ~70%                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  Stage 2: Reranking (Cross-encoder)                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  For each candidate:                                        │   │
│  │    score = reranker(query + candidate)                      │   │
│  │  Re-sort by new scores ──► Top 10 results                   │   │
│  │  Speed: ~100ms                                              │   │
│  │  Precision: ~90%                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Bi-Encoder vs Cross-Encoder

### Bi-Encoder (First Stage)

```
Query: "fractal dimension"  ──► Encoder ──► [0.1, 0.2, ...]
                                              │
                                              │ Compare
                                              ▼
Doc: "Df is measured..."    ──► Encoder ──► [0.15, 0.18, ...]
```

- Encodes query and documents separately
- Pre-compute document embeddings
- Fast: O(1) comparison
- Less accurate: no cross-attention

### Cross-Encoder (Reranking)

```
┌──────────────────────────────────────────────────┐
│  Input: "fractal dimension [SEP] Df is measured" │
│                       │                          │
│                       ▼                          │
│                   Encoder                        │
│                       │                          │
│                       ▼                          │
│              Relevance Score: 0.92               │
└──────────────────────────────────────────────────┘
```

- Processes query and document together
- Full cross-attention
- Slower: must run for each candidate
- More accurate: sees full context

---

## Reranking Models

### Sentence Transformers Cross-Encoders

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')

def rerank(query: str, documents: list[str]) -> list[tuple[int, float]]:
    """Rerank documents by relevance to query."""
    pairs = [[query, doc] for doc in documents]
    scores = reranker.predict(pairs)

    # Return (index, score) sorted by score
    ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
    return ranked
```

### Cohere Rerank

```python
import cohere

co = cohere.Client()

def rerank_cohere(query: str, documents: list[str], top_n: int = 10):
    response = co.rerank(
        query=query,
        documents=documents,
        model="rerank-english-v3.0",
        top_n=top_n
    )
    return response.results
```

### Model Comparison

| Model | Speed | Quality | Cost |
|-------|-------|---------|------|
| cross-encoder/ms-marco-MiniLM-L-6-v2 | Fast | Good | Free |
| cross-encoder/ms-marco-MiniLM-L-12-v2 | Medium | Better | Free |
| Cohere rerank-english-v3.0 | API | Best | $1/1000 |

---

## Implementation

### Basic Reranker Service

```python
class RerankerService:
    def __init__(self, model_name: str = None):
        if model_name:
            self.model = CrossEncoder(model_name)
        else:
            self.model = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')

    def rerank(
        self,
        query: str,
        results: list[SearchResult],
        top_k: int = 10
    ) -> list[SearchResult]:
        """Rerank search results."""
        if not results:
            return []

        # Prepare pairs
        documents = [r.content for r in results]
        pairs = [[query, doc] for doc in documents]

        # Score
        scores = self.model.predict(pairs)

        # Update results with rerank scores
        for result, score in zip(results, scores):
            result.rerank_score = float(score)

        # Sort by rerank score
        reranked = sorted(results, key=lambda x: x.rerank_score, reverse=True)

        return reranked[:top_k]
```

### Integrated Search + Rerank

```python
class SearchService:
    def __init__(self):
        self.embedding_service = EmbeddingService()
        self.vector_store = get_vector_store()
        self.reranker = RerankerService()

    def search(
        self,
        query: str,
        k: int = 10,
        rerank: bool = True,
        retrieval_k: int = 100
    ) -> list[SearchResult]:
        """Search with optional reranking."""

        # Stage 1: Vector retrieval
        query_embedding = self.embedding_service.embed_text(query)
        candidates = self.vector_store.search(query_embedding, k=retrieval_k)

        if not rerank:
            return candidates[:k]

        # Stage 2: Reranking
        reranked = self.reranker.rerank(query, candidates, top_k=k)

        return reranked
```

---

## Performance Considerations

### When to Rerank

| Scenario | Rerank? | Reason |
|----------|---------|--------|
| Critical queries | Yes | Quality matters |
| High-volume search | Maybe | Balance quality/cost |
| Simple lookups | No | Overkill |
| < 10 candidates | No | Not enough benefit |

### Batching

```python
def batch_rerank(
    queries: list[str],
    documents_per_query: list[list[str]],
    batch_size: int = 32
) -> list[list[float]]:
    """Rerank multiple queries efficiently."""
    all_pairs = []
    boundaries = []

    for query, docs in zip(queries, documents_per_query):
        boundaries.append(len(all_pairs))
        for doc in docs:
            all_pairs.append([query, doc])

    # Batch scoring
    all_scores = []
    for i in range(0, len(all_pairs), batch_size):
        batch = all_pairs[i:i+batch_size]
        scores = reranker.predict(batch)
        all_scores.extend(scores)

    # Reshape by query
    results = []
    for i, boundary in enumerate(boundaries):
        end = boundaries[i+1] if i+1 < len(boundaries) else len(all_scores)
        results.append(all_scores[boundary:end])

    return results
```

### Caching

```python
from functools import lru_cache

@lru_cache(maxsize=1000)
def cached_rerank_score(query: str, document: str) -> float:
    """Cache rerank scores for repeated queries."""
    return reranker.predict([[query, document]])[0]
```

---

## Quality Evaluation

### Metrics

| Metric | Measures |
|--------|----------|
| MRR | Position of first relevant result |
| NDCG@k | Ranking quality with graded relevance |
| Precision@k | Relevant items in top k |

### A/B Testing

```python
def search_with_ab_test(query: str, k: int = 10, user_id: str = None):
    """Run A/B test on reranking."""
    # Assign user to group
    use_rerank = hash(user_id) % 2 == 0 if user_id else random.random() > 0.5

    results = search_service.search(query, k=k, rerank=use_rerank)

    # Log for analysis
    log_search_event(
        query=query,
        rerank=use_rerank,
        results=[r.id for r in results]
    )

    return results
```

---

## Key Takeaways

1. **Two stages**: Fast retrieval + accurate reranking
2. **Cross-encoders**: More accurate than bi-encoders
3. **Trade-off**: Quality vs latency
4. **Batch when possible**: Amortize model loading
5. **Evaluate continuously**: Measure impact on quality
6. **Start simple**: Add reranking only when needed

---

## Further Reading

- [Sentence Transformers Cross-Encoders](https://www.sbert.net/examples/applications/cross-encoder/README.html)
- [Cohere Rerank](https://docs.cohere.com/docs/reranking)
- [MS MARCO Dataset](https://microsoft.github.io/msmarco/)
