# Theory: Vector Databases

Choosing and using vector storage for semantic search.

---

## What is a Vector Database?

A vector database stores and indexes high-dimensional vectors for efficient similarity search:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Vector Database Architecture                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                     Storage Layer                              │ │
│  │  Vectors + Metadata + Documents                                │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                            │                                        │
│                            ▼                                        │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                      Index Layer                               │ │
│  │  HNSW / IVF / Flat (approximate nearest neighbor)              │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                            │                                        │
│                            ▼                                        │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                      Query Layer                               │ │
│  │  Similarity search + Metadata filtering                        │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Vector Database Options

### ChromaDB (Development)

```python
import chromadb

# Create client
client = chromadb.Client()

# Create collection
collection = client.create_collection("scientific_papers")

# Add documents
collection.add(
    ids=["doc1", "doc2"],
    embeddings=[[0.1, 0.2, ...], [0.3, 0.4, ...]],
    documents=["Text of paper 1", "Text of paper 2"],
    metadatas=[{"author": "Smith"}, {"author": "Jones"}]
)

# Query
results = collection.query(
    query_embeddings=[[0.15, 0.25, ...]],
    n_results=5
)
```

**Pros**:
- Simple setup (pip install)
- Good for development
- Built-in persistence
- Python-native

**Cons**:
- Not production-scale
- Single-node only

### pgvector (PostgreSQL Extension)

```sql
-- Enable extension
CREATE EXTENSION vector;

-- Create table
CREATE TABLE chunks (
    id SERIAL PRIMARY KEY,
    content TEXT,
    embedding vector(1536),
    metadata JSONB
);

-- Create index
CREATE INDEX ON chunks USING ivfflat (embedding vector_cosine_ops);

-- Query
SELECT content, metadata
FROM chunks
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 5;
```

**Pros**:
- Uses existing PostgreSQL
- ACID transactions
- Mature, reliable
- Good Django integration

**Cons**:
- Requires PostgreSQL 15+
- Performance limits at scale

### Weaviate (Production)

```python
import weaviate

client = weaviate.Client("http://localhost:8080")

# Define schema
client.schema.create_class({
    "class": "DocumentChunk",
    "vectorizer": "none",
    "properties": [
        {"name": "content", "dataType": ["text"]},
        {"name": "source", "dataType": ["string"]}
    ]
})

# Add data
client.data_object.create(
    {
        "content": "Paper text...",
        "source": "paper_1"
    },
    class_name="DocumentChunk",
    vector=[0.1, 0.2, ...]
)

# Query
result = client.query.get(
    "DocumentChunk", ["content", "source"]
).with_near_vector({"vector": [0.1, 0.2, ...]}).with_limit(5).do()
```

**Pros**:
- Production-ready
- Scalable
- GraphQL API
- Built-in vectorizers

**Cons**:
- Additional infrastructure
- More complex setup

---

## Recommendation for pyAgloGen3D

### Development Phase

**ChromaDB** - Simple, fast to set up:

```python
# config/settings/local.py
VECTOR_DB_BACKEND = "chromadb"
VECTOR_DB_PATH = BASE_DIR / "data" / "chromadb"
```

### Production Phase

**pgvector** - Leverage existing PostgreSQL:

```python
# config/settings/production.py
VECTOR_DB_BACKEND = "pgvector"
# Uses existing DATABASE_URL
```

### Scale-Out Phase (Future)

**Weaviate** - When you need:
- Millions of documents
- Multi-tenant isolation
- Horizontal scaling

---

## Index Types

### Flat (Exact)

```
┌─────────────────────────────────────────┐
│  Compares query to ALL vectors          │
│  O(n) complexity                        │
│  Perfect recall, slow for large data    │
└─────────────────────────────────────────┘
```

Use when: < 10,000 vectors

### IVF (Inverted File Index)

```
┌─────────────────────────────────────────┐
│  Clusters vectors into buckets          │
│  Searches nearest clusters only         │
│  O(n/k) where k = clusters              │
│  Trade accuracy for speed               │
└─────────────────────────────────────────┘
```

Use when: 10k - 1M vectors

### HNSW (Hierarchical Navigable Small World)

```
┌─────────────────────────────────────────┐
│  Graph-based navigation                 │
│  Logarithmic search time                │
│  Best accuracy/speed tradeoff           │
│  More memory usage                      │
└─────────────────────────────────────────┘
```

Use when: > 100k vectors, need high accuracy

---

## Metadata Filtering

Combine vector search with attribute filters:

```python
# ChromaDB
results = collection.query(
    query_embeddings=[query_vector],
    where={"author": "Witten"},
    where_document={"$contains": "DLA"},
    n_results=10
)

# pgvector
SELECT content, embedding <=> query_vector AS distance
FROM chunks
WHERE metadata->>'year' > '2020'
  AND metadata->>'topic' = 'aggregation'
ORDER BY embedding <=> query_vector
LIMIT 10;
```

### Filter Strategies

| Strategy | When to Use |
|----------|-------------|
| Pre-filter | Few matches expected |
| Post-filter | Many matches expected |
| Hybrid | Complex conditions |

---

## Abstraction Layer

Create a unified interface for any vector DB:

```python
from abc import ABC, abstractmethod

class VectorStore(ABC):
    @abstractmethod
    def add(self, chunks: list[Chunk], embeddings: list[Vector]) -> None:
        pass

    @abstractmethod
    def search(
        self,
        query_vector: Vector,
        k: int = 10,
        filters: dict | None = None
    ) -> list[SearchResult]:
        pass

    @abstractmethod
    def delete(self, ids: list[str]) -> None:
        pass


class ChromaStore(VectorStore):
    def __init__(self, collection_name: str):
        self.client = chromadb.Client()
        self.collection = self.client.get_or_create_collection(collection_name)

    def add(self, chunks, embeddings):
        self.collection.add(
            ids=[c.id for c in chunks],
            embeddings=embeddings,
            documents=[c.content for c in chunks],
            metadatas=[c.metadata for c in chunks]
        )

    def search(self, query_vector, k=10, filters=None):
        results = self.collection.query(
            query_embeddings=[query_vector],
            n_results=k,
            where=filters
        )
        return [SearchResult(id=id, score=score, ...)
                for id, score in zip(results['ids'], results['distances'])]


class PgVectorStore(VectorStore):
    # Similar implementation for pgvector
    pass
```

---

## Django Integration

### pgvector with Django

```python
# Install
# pip install pgvector

# models.py
from pgvector.django import VectorField

class DocumentChunk(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE)
    content = models.TextField()
    embedding = VectorField(dimensions=1536)
    metadata = models.JSONField(default=dict)

    class Meta:
        indexes = [
            IvfflatIndex(
                name='chunk_embedding_idx',
                fields=['embedding'],
                lists=100,
                opclasses=['vector_cosine_ops']
            )
        ]

# Querying
from pgvector.django import CosineDistance

similar_chunks = DocumentChunk.objects.annotate(
    distance=CosineDistance('embedding', query_vector)
).order_by('distance')[:10]
```

### ChromaDB with Django

```python
# services/vector_store.py
import chromadb

class VectorStoreService:
    def __init__(self):
        self.client = chromadb.PersistentClient(
            path=str(settings.VECTOR_DB_PATH)
        )
        self.collection = self.client.get_or_create_collection(
            name="documents",
            metadata={"hnsw:space": "cosine"}
        )

    def add_chunk(self, chunk: DocumentChunk, embedding: list[float]):
        self.collection.add(
            ids=[str(chunk.id)],
            embeddings=[embedding],
            documents=[chunk.content],
            metadatas=[chunk.metadata]
        )

    def search(self, query_embedding: list[float], k: int = 10):
        return self.collection.query(
            query_embeddings=[query_embedding],
            n_results=k
        )
```

---

## Performance Considerations

### Index Building

| Scenario | Index Type | Build Time | Search Time |
|----------|------------|------------|-------------|
| < 10K vectors | Flat | Instant | ~10ms |
| 10K-100K | IVF | Seconds | ~5ms |
| > 100K | HNSW | Minutes | ~1ms |

### Memory Usage

```
Vectors: dimensions × 4 bytes × count
Example: 1536 × 4 × 100,000 = 600MB

Index overhead: 1.5-3x raw vectors
Total: ~1-2GB for 100K vectors
```

### Batch Operations

```python
# Slow: Add one by one
for chunk in chunks:
    vector_store.add([chunk], [embedding])

# Fast: Batch add
vector_store.add(chunks, embeddings)
```

---

## Key Takeaways

1. **Start simple**: ChromaDB for development
2. **Use existing infra**: pgvector if you have PostgreSQL
3. **Scale when needed**: Weaviate for production at scale
4. **Abstract the interface**: Easy to swap backends
5. **Choose right index**: Based on dataset size
6. **Filter smartly**: Combine vector search with metadata

---

## Further Reading

- [ChromaDB Documentation](https://docs.trychroma.com/)
- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [Weaviate Documentation](https://weaviate.io/developers/weaviate)
- [ANN Benchmarks](http://ann-benchmarks.com/)
