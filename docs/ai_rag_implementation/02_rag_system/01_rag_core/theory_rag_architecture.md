# Theory: RAG Architecture

Understanding Retrieval-Augmented Generation for scientific literature.

---

## What is RAG?

RAG (Retrieval-Augmented Generation) enhances LLM responses with relevant external knowledge:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RAG Pipeline                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User Query                                                         │
│  "What's the expected Df for DLA aggregates?"                       │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Retrieval Step                            │   │
│  │  1. Embed query → vector                                     │   │
│  │  2. Search vector database                                   │   │
│  │  3. Find relevant document chunks                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  Retrieved Context                           │   │
│  │  "Witten & Sander (1981) showed that DLA produces             │   │
│  │   aggregates with fractal dimension Df ≈ 1.71..."            │   │
│  │  "Meakin (1984) found Df = 1.78 ± 0.05 for 3D DLA..."        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   Augmented Prompt                           │   │
│  │  System: You are an AI assistant with access to these        │   │
│  │          scientific papers: [retrieved context]              │   │
│  │  User: What's the expected Df for DLA aggregates?            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   LLM Generation                             │   │
│  │  "Based on the scientific literature, DLA aggregates         │   │
│  │   typically have a fractal dimension of 1.71-1.78.           │   │
│  │   [Witten & Sander, 1981; Meakin, 1984]"                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Why RAG for Scientific Applications?

### Problem: LLM Limitations

| Issue | Example |
|-------|---------|
| Knowledge cutoff | Doesn't know papers published after training |
| Hallucination | May invent citation details |
| No domain depth | General knowledge, not specialized |
| No source verification | Can't point to specific papers |

### Solution: RAG Benefits

| Benefit | How |
|---------|-----|
| Current knowledge | Add recent papers to knowledge base |
| Grounded responses | Cite actual documents |
| Domain expertise | Curated scientific literature |
| Verifiable | Users can check cited sources |

---

## RAG Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                      RAG System Components                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    Document Store                              │ │
│  │  - Raw documents (PDFs, papers)                                │ │
│  │  - Metadata (title, authors, year)                             │ │
│  │  - Storage: PostgreSQL + file storage                          │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                           │                                         │
│                           ▼                                         │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                  Chunking Pipeline                             │ │
│  │  - Split documents into chunks                                 │ │
│  │  - Preserve semantic meaning                                   │ │
│  │  - Maintain metadata                                           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                           │                                         │
│                           ▼                                         │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                  Embedding Model                               │ │
│  │  - Convert chunks to vectors                                   │ │
│  │  - Models: OpenAI, Sentence Transformers                       │ │
│  │  - Vector dimension: 768-3072                                  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                           │                                         │
│                           ▼                                         │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                  Vector Database                               │ │
│  │  - Store embeddings with metadata                              │ │
│  │  - Efficient similarity search                                 │ │
│  │  - Options: ChromaDB, pgvector, Weaviate                       │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                           │                                         │
│                           ▼                                         │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                  Retrieval Engine                              │ │
│  │  - Query embedding                                             │ │
│  │  - Similarity search                                           │ │
│  │  - Reranking (optional)                                        │ │
│  │  - Context formatting                                          │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Ingestion Pipeline

### Step 1: Document Acquisition

```python
# Sources
- PDF upload (manual)
- arXiv API (automated)
- Semantic Scholar API (automated)
```

### Step 2: Text Extraction

```python
# Extract text from PDF
def extract_text(pdf_path: str) -> str:
    # Handle:
    # - Multi-column layouts
    # - Tables
    # - Equations (as text or images)
    # - References section
```

### Step 3: Chunking

```python
# Split into semantic chunks
def chunk_document(text: str, metadata: dict) -> list[Chunk]:
    # Strategies:
    # - Fixed size with overlap
    # - Paragraph-based
    # - Section-based (headers)
```

### Step 4: Embedding

```python
# Generate embeddings
def embed_chunks(chunks: list[Chunk]) -> list[Vector]:
    # Use embedding model
    # Batch for efficiency
```

### Step 5: Storage

```python
# Store in vector database
def store_embeddings(vectors: list[Vector], metadata: list[dict]):
    # ChromaDB / pgvector / Weaviate
```

---

## Retrieval Pipeline

### Step 1: Query Processing

```python
def process_query(query: str) -> str:
    # Optional: Query expansion
    # Optional: Keyword extraction
    return processed_query
```

### Step 2: Query Embedding

```python
def embed_query(query: str) -> Vector:
    # Same model as document embedding
    return embedding_model.encode(query)
```

### Step 3: Similarity Search

```python
def search(query_vector: Vector, k: int = 5) -> list[Chunk]:
    # Vector similarity (cosine, dot product)
    # Return top-k chunks
    return vector_db.query(query_vector, top_k=k)
```

### Step 4: Reranking (Optional)

```python
def rerank(query: str, chunks: list[Chunk]) -> list[Chunk]:
    # Use cross-encoder for better relevance
    # More accurate but slower
    return reranker.rerank(query, chunks)
```

### Step 5: Context Formatting

```python
def format_context(chunks: list[Chunk]) -> str:
    # Format for LLM prompt
    # Include source citations
    return formatted_context
```

---

## Prompt Engineering for RAG

### System Prompt Template

```
You are a scientific research assistant with access to a knowledge base
of academic papers about fractal aggregates, aerosol science, and
nanoparticle simulation.

When answering questions:
1. Base your answers on the provided context
2. Cite sources using [Author, Year] format
3. If the context doesn't contain relevant information, say so
4. Don't make up citations or facts

Context from knowledge base:
{retrieved_context}
```

### Context Formatting

```markdown
## Retrieved Documents

### Source 1: [Witten & Sander, 1981]
Title: Diffusion-Limited Aggregation, a Kinetic Critical Phenomenon
"Diffusion-limited aggregation produces fractal clusters with a
characteristic dimension d ≈ 1.71 in two dimensions..."

### Source 2: [Meakin, 1984]
Title: Formation of Fractal Clusters and Networks by Irreversible
       Diffusion-Limited Aggregation
"For three-dimensional DLA, we find Df = 1.78 ± 0.05..."
```

---

## Quality Metrics

### Retrieval Quality

| Metric | Description |
|--------|-------------|
| Precision@k | Relevant docs in top-k results |
| Recall@k | Fraction of relevant docs retrieved |
| MRR | Mean Reciprocal Rank of first relevant |
| NDCG | Normalized Discounted Cumulative Gain |

### Generation Quality

| Metric | Description |
|--------|-------------|
| Faithfulness | Response grounded in context |
| Relevance | Answers the user's question |
| Citation accuracy | Correct source attribution |

---

## Common RAG Patterns

### Basic RAG

```
Query → Embed → Search → Augment → Generate
```

Simple, works for most cases.

### Multi-Query RAG

```
Query → Generate variants → Search each → Merge → Generate
```

Better coverage for complex queries.

### Recursive RAG

```
Query → Search → Generate → If incomplete → Search again → Generate
```

For questions requiring multiple lookups.

### Agentic RAG

```
Query → Agent decides → Search OR Calculate OR Both → Generate
```

AI decides when and what to retrieve.

---

## Considerations for Scientific RAG

### Domain-Specific Challenges

1. **Technical vocabulary**: "aggregation" means different things
2. **Mathematical notation**: Equations may not embed well
3. **Figure/table references**: Text may reference visuals
4. **Citation chains**: Papers cite other papers

### Mitigation Strategies

1. **Domain-specific embeddings**: Fine-tune on scientific text
2. **Structured extraction**: Parse equations separately
3. **Metadata enrichment**: Store figure captions
4. **Reference expansion**: Follow citation chains

---

## Key Takeaways

1. **RAG = Retrieval + Generation**: Ground LLM in real documents
2. **Pipeline stages**: Ingest → Chunk → Embed → Store → Retrieve
3. **Quality depends on**: Chunking, embeddings, retrieval, prompts
4. **Scientific needs**: Citations, accuracy, domain vocabulary
5. **Evaluate continuously**: Measure retrieval and generation quality

---

## Further Reading

- [RAG Survey Paper](https://arxiv.org/abs/2312.10997)
- [LangChain RAG Guide](https://python.langchain.com/docs/tutorials/rag/)
- [Anthropic RAG Best Practices](https://docs.anthropic.com/claude/docs/retrieval-augmented-generation)
