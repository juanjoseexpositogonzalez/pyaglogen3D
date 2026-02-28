# Theory: Embedding Models

Understanding vector embeddings for semantic search.

---

## What are Embeddings?

Embeddings convert text into numerical vectors that capture semantic meaning:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Text → Embedding → Vector                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  "Fractal dimension of DLA aggregates"                              │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Embedding Model                                 │   │
│  │  (Transformer-based neural network)                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  [0.023, -0.156, 0.891, ..., 0.234]  (768-3072 dimensions)         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Property: Semantic Similarity

Similar texts have similar vectors:

```
"Fractal dimension of DLA"  ←→  "Df of diffusion-limited aggregates"
       Vector A             ~         Vector B
                    Cosine similarity ≈ 0.92
```

---

## Embedding Model Options

### OpenAI Embeddings

```python
from openai import OpenAI

client = OpenAI()
response = client.embeddings.create(
    model="text-embedding-3-small",
    input="Fractal dimension analysis"
)
vector = response.data[0].embedding  # 1536 dimensions
```

| Model | Dimensions | Context | Cost |
|-------|------------|---------|------|
| text-embedding-3-small | 1536 | 8191 | $0.02/1M |
| text-embedding-3-large | 3072 | 8191 | $0.13/1M |
| text-embedding-ada-002 | 1536 | 8191 | $0.10/1M |

### Sentence Transformers (Open Source)

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')
vector = model.encode("Fractal dimension analysis")  # 384 dimensions
```

| Model | Dimensions | Quality | Speed |
|-------|------------|---------|-------|
| all-MiniLM-L6-v2 | 384 | Good | Fast |
| all-mpnet-base-v2 | 768 | Better | Medium |
| BAAI/bge-large-en-v1.5 | 1024 | Best | Slow |

### Cohere Embeddings

```python
import cohere

co = cohere.Client()
response = co.embed(
    texts=["Fractal dimension analysis"],
    model="embed-english-v3.0",
    input_type="search_document"
)
vector = response.embeddings[0]  # 1024 dimensions
```

---

## Choosing an Embedding Model

### Factors to Consider

| Factor | Consideration |
|--------|---------------|
| **Quality** | How well it captures semantic similarity |
| **Dimensions** | More = more nuanced, but slower search |
| **Context length** | Max tokens per embedding |
| **Speed** | Inference time per embedding |
| **Cost** | API costs or compute requirements |
| **Domain fit** | General vs scientific text |

### Recommendation for pyAgloGen3D

**Development**: `all-MiniLM-L6-v2` (Sentence Transformers)
- Free, local, fast
- Good enough for development

**Production**: `text-embedding-3-small` (OpenAI)
- Excellent quality
- Reasonable cost
- Simple API

---

## Embedding Scientific Text

### Challenges

1. **Technical terms**: "DLA", "fractal dimension", "box-counting"
2. **Equations**: $D_f = \lim_{\epsilon \to 0} \frac{\log N(\epsilon)}{\log(1/\epsilon)}$
3. **Abbreviations**: "Df", "Rg", "kf"
4. **Formulas**: May not embed semantically

### Strategies

#### 1. Preprocessing

```python
def preprocess_scientific_text(text: str) -> str:
    # Expand abbreviations
    text = text.replace("Df", "fractal dimension")
    text = text.replace("Rg", "radius of gyration")

    # Convert simple equations to text
    text = re.sub(r'\$D_f\$', 'fractal dimension', text)

    return text
```

#### 2. Metadata Enrichment

```python
chunk = {
    "text": "The Df values ranged from 1.7 to 1.9...",
    "metadata": {
        "concepts": ["fractal dimension", "DLA"],
        "equations": ["D_f = 1.78"],
        "keywords": ["aggregation", "simulation"]
    }
}
```

#### 3. Hybrid Search

Combine semantic and keyword search:

```python
def hybrid_search(query: str, k: int = 10):
    # Semantic search
    semantic_results = vector_db.similarity_search(query, k=k)

    # Keyword search
    keyword_results = full_text_search(query, k=k)

    # Merge and rerank
    return rerank(query, semantic_results + keyword_results)
```

---

## Batch Embedding

For efficiency, embed in batches:

```python
def embed_documents(chunks: list[str], batch_size: int = 100):
    embeddings = []

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        batch_embeddings = embedding_model.encode(batch)
        embeddings.extend(batch_embeddings)

    return embeddings
```

### Rate Limits

| Provider | Rate Limit | Recommendation |
|----------|------------|----------------|
| OpenAI | 3000 RPM | Batch with delays |
| Cohere | 100 calls/min | Async batching |
| Local | No limit | Max batch by RAM |

---

## Embedding Storage

### Alongside Chunks

```python
class DocumentChunk(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE)
    content = models.TextField()
    embedding = ArrayField(models.FloatField())  # pgvector
    metadata = models.JSONField()
```

### In Vector Database

```python
# ChromaDB
collection.add(
    ids=["chunk_1", "chunk_2"],
    embeddings=[[0.1, 0.2, ...], [0.3, 0.4, ...]],
    documents=["Text 1", "Text 2"],
    metadatas=[{"source": "paper_1"}, {"source": "paper_2"}]
)
```

---

## Similarity Metrics

### Cosine Similarity

```
similarity = (A · B) / (||A|| × ||B||)
```

Most common, range [-1, 1] (normalized: [0, 1])

### Dot Product

```
similarity = A · B
```

Faster, but requires normalized vectors

### Euclidean Distance

```
distance = √(Σ(Ai - Bi)²)
```

Smaller = more similar

### Recommendation

Use **cosine similarity** for most cases:
- Handles different vector magnitudes
- Standard in semantic search
- Well-supported by all vector DBs

---

## Embedding Drift

### Problem

If you change embedding models, old vectors become incompatible.

### Solution

Track embedding model version:

```python
class DocumentChunk(models.Model):
    embedding = ArrayField(models.FloatField())
    embedding_model = models.CharField()  # "openai/text-embedding-3-small"
    embedding_version = models.CharField()  # "2024-01"
```

### Migration Strategy

1. Add new column for new embeddings
2. Re-embed all documents with new model
3. Switch search to new column
4. Drop old column

---

## Key Takeaways

1. **Embeddings capture meaning**: Similar text = similar vectors
2. **Model choice matters**: Quality vs speed vs cost tradeoffs
3. **Scientific text needs preprocessing**: Handle equations, abbreviations
4. **Batch for efficiency**: Don't embed one at a time
5. **Track versions**: Embedding model changes require re-embedding
6. **Cosine similarity**: Standard metric for semantic search

---

## Further Reading

- [Sentence Transformers Documentation](https://www.sbert.net/)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard) (embedding benchmarks)
