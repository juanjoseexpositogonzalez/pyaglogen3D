# Theory: Context Injection

Enriching LLM prompts with retrieved knowledge.

---

## The Integration Pattern

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RAG + AI Integration                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User: "What's the expected Df for DLA aggregates?"                 │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  1. Retrieve relevant chunks from knowledge base             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  Retrieved: [Witten 1981: "Df ≈ 1.71", Meakin 1984: "Df = 1.78"]   │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  2. Inject into system prompt                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  System: "You have access to these papers: [context]"               │
│  User: "What's the expected Df for DLA aggregates?"                 │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  3. LLM generates grounded response                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  Response: "Based on the literature, DLA aggregates typically       │
│             have Df ≈ 1.71-1.78 [Witten 1981, Meakin 1984]"         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Context Injection Strategies

### Strategy 1: System Prompt Injection

```python
def build_rag_system_prompt(base_prompt: str, context: list[SearchResult]) -> str:
    context_text = format_context(context)

    return f"""{base_prompt}

## Knowledge Base Context

The following excerpts from scientific papers may be relevant:

{context_text}

When answering:
- Use the provided context when relevant
- Cite sources using [Author, Year] format
- If context doesn't answer the question, say so
"""
```

### Strategy 2: User Message Injection

```python
def augment_user_message(original: str, context: list[SearchResult]) -> str:
    context_text = format_context(context)

    return f"""Context from knowledge base:
{context_text}

User question: {original}

Please answer based on the context above."""
```

### Strategy 3: Separate Context Message

```python
messages = [
    {"role": "system", "content": base_system_prompt},
    {"role": "user", "content": f"[CONTEXT]\n{context_text}"},
    {"role": "assistant", "content": "I'll use this context to help answer your question."},
    {"role": "user", "content": user_question}
]
```

---

## Context Formatting

### Simple Format

```markdown
## Retrieved Documents

### [Witten & Sander, 1981]
"Diffusion-limited aggregation produces fractal clusters with
dimension d ≈ 1.71 in two dimensions..."

### [Meakin, 1984]
"For three-dimensional DLA, we find Df = 1.78 ± 0.05..."
```

### Structured Format

```markdown
## Context from Scientific Literature

**Source 1**: Witten & Sander (1981) - Physical Review Letters
- Section: Results
- Key finding: "DLA produces fractals with d ≈ 1.71 (2D)"
- Relevance score: 0.92

**Source 2**: Meakin (1984) - Physical Review A
- Section: Conclusions
- Key finding: "3D DLA: Df = 1.78 ± 0.05"
- Relevance score: 0.89
```

### Implementation

```python
def format_context(results: list[SearchResult], max_chars: int = 4000) -> str:
    """Format search results for LLM context."""
    formatted = []
    total_chars = 0

    for i, result in enumerate(results):
        # Build source citation
        doc = result.document
        citation = f"{doc.authors[0]} et al." if len(doc.authors) > 1 else doc.authors[0]
        citation += f" ({doc.year})" if doc.year else ""

        # Format chunk
        entry = f"""### Source {i+1}: [{citation}]
Title: {doc.title}
{f"Section: {result.metadata.get('section')}" if result.metadata.get('section') else ""}

"{result.content}"
"""
        # Check length limit
        if total_chars + len(entry) > max_chars:
            break

        formatted.append(entry)
        total_chars += len(entry)

    return "\n".join(formatted)
```

---

## When to Retrieve

### Always Retrieve

```python
def process_with_rag(query: str) -> str:
    context = search_service.search(query, k=5)
    augmented_prompt = inject_context(query, context)
    return llm.complete(augmented_prompt)
```

**Pros**: Simple, consistent
**Cons**: May retrieve for simple questions

### Selective Retrieval

```python
def process_with_selective_rag(query: str) -> str:
    # Check if retrieval would help
    if needs_retrieval(query):
        context = search_service.search(query, k=5)
        return llm.complete(inject_context(query, context))
    else:
        return llm.complete(query)

def needs_retrieval(query: str) -> bool:
    """Heuristics for when to retrieve."""
    # Scientific terms
    scientific_terms = ["df", "fractal", "simulation", "aggregation", "particle"]
    if any(term in query.lower() for term in scientific_terms):
        return True

    # Questions about data/results
    question_words = ["what", "how", "why", "when"]
    if any(query.lower().startswith(w) for w in question_words):
        return True

    return False
```

### LLM-Decided Retrieval

```python
def process_with_llm_decision(query: str) -> str:
    # Ask LLM if retrieval would help
    decision_prompt = f"""
    Should I search the scientific knowledge base to answer this question?
    Question: {query}
    Answer YES or NO.
    """
    decision = llm.complete(decision_prompt).strip().upper()

    if decision == "YES":
        context = search_service.search(query, k=5)
        return llm.complete(inject_context(query, context))
    else:
        return llm.complete(query)
```

---

## Context Budget

LLMs have token limits. Manage context carefully:

```python
def fit_context_to_budget(
    results: list[SearchResult],
    max_tokens: int = 3000,
    min_results: int = 2
) -> list[SearchResult]:
    """Select results that fit in token budget."""
    selected = []
    total_tokens = 0

    for result in results:
        chunk_tokens = count_tokens(result.content)
        overhead = 50  # Citation, formatting

        if total_tokens + chunk_tokens + overhead > max_tokens:
            if len(selected) >= min_results:
                break
            # Truncate this chunk
            max_chunk_tokens = max_tokens - total_tokens - overhead
            result.content = truncate_to_tokens(result.content, max_chunk_tokens)
            chunk_tokens = max_chunk_tokens

        selected.append(result)
        total_tokens += chunk_tokens + overhead

    return selected
```

---

## Handling No Results

```python
def process_with_rag(query: str) -> str:
    context = search_service.search(query, k=5, min_score=0.5)

    if not context:
        # No relevant context found
        prompt = f"""
        Note: No relevant papers were found in the knowledge base for this query.
        Please answer based on general knowledge, or indicate if you need
        specific sources to answer accurately.

        Question: {query}
        """
        return llm.complete(prompt)

    return llm.complete(inject_context(query, context))
```

---

## Key Takeaways

1. **System prompt injection**: Most common, cleanest approach
2. **Format clearly**: Help LLM understand structure
3. **Budget tokens**: Don't exceed context limits
4. **Selective retrieval**: Not every query needs RAG
5. **Handle empty results**: Graceful fallback

---

## Further Reading

- [Anthropic RAG Guide](https://docs.anthropic.com/claude/docs/retrieval-augmented-generation)
- [OpenAI RAG Best Practices](https://platform.openai.com/docs/guides/prompt-engineering)
