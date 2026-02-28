# Theory: Conversation Management

Managing multi-turn AI conversations with context and history.

---

## Conversation Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Conversation Structure                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Conversation                          │   │
│  │  - id: UUID                                              │   │
│  │  - user: FK(User)                                        │   │
│  │  - project: FK(Project) [optional]                       │   │
│  │  - title: str                                            │   │
│  │  - created_at, updated_at                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                                                       │
│         │ has_many                                              │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Message                             │   │
│  │  - id: UUID                                              │   │
│  │  - conversation: FK(Conversation)                        │   │
│  │  - role: enum (user, assistant, tool)                    │   │
│  │  - content: text                                         │   │
│  │  - tool_calls: JSON [optional]                           │   │
│  │  - tool_call_id: str [optional]                          │   │
│  │  - created_at                                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Message Types

### User Message

```json
{
    "role": "user",
    "content": "Run a DLA simulation with 1000 particles"
}
```

### Assistant Message (Text Only)

```json
{
    "role": "assistant",
    "content": "I'll run a DLA simulation with 1000 particles for you."
}
```

### Assistant Message (With Tool Call)

```json
{
    "role": "assistant",
    "content": null,
    "tool_calls": [
        {
            "id": "call_abc123",
            "name": "run_dla_simulation",
            "arguments": {"n_particles": 1000}
        }
    ]
}
```

### Tool Result Message

```json
{
    "role": "tool",
    "tool_call_id": "call_abc123",
    "content": "{\"simulation_id\": 456, \"status\": \"queued\"}"
}
```

---

## Conversation Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Conversation Flow                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. User sends message                                               │
│     ↓                                                                │
│  2. Save user message to database                                    │
│     ↓                                                                │
│  3. Build conversation context (history + system prompt)             │
│     ↓                                                                │
│  4. Send to LLM with tools                                           │
│     ↓                                                                │
│  5. LLM response received                                            │
│     ↓                                                                │
│  6. If tool_calls present:                                           │
│     a. Save assistant message with tool_calls                        │
│     b. Execute each tool                                             │
│     c. Save tool result messages                                     │
│     d. Send tool results back to LLM                                 │
│     e. Repeat from step 5 (may trigger more tools)                   │
│     ↓                                                                │
│  7. If no tool_calls (final response):                               │
│     a. Save assistant message                                        │
│     b. Return response to user                                       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Context Window Management

### The Problem

LLMs have limited context windows:
- Claude Sonnet: 200K tokens
- GPT-4o: 128K tokens
- Llama 3.3: 128K tokens

Long conversations can exceed these limits.

### Strategies

#### 1. Sliding Window

Keep only the N most recent messages:

```python
def get_context_messages(conversation: Conversation, max_messages: int = 20):
    messages = conversation.messages.order_by('-created_at')[:max_messages]
    return list(reversed(messages))  # Chronological order
```

**Pros**: Simple, predictable
**Cons**: Loses early context

#### 2. Token-Based Truncation

Keep messages until token limit reached:

```python
def get_context_messages(conversation: Conversation, max_tokens: int = 100000):
    messages = []
    total_tokens = 0

    for msg in conversation.messages.order_by('-created_at'):
        msg_tokens = count_tokens(msg.content)
        if total_tokens + msg_tokens > max_tokens:
            break
        messages.append(msg)
        total_tokens += msg_tokens

    return list(reversed(messages))
```

**Pros**: Maximizes context usage
**Cons**: Requires token counting

#### 3. Summarization

Summarize old messages:

```python
def get_context_with_summary(conversation: Conversation, recent_count: int = 10):
    recent = list(conversation.messages.order_by('-created_at')[:recent_count])
    older = conversation.messages.order_by('-created_at')[recent_count:]

    if older.exists():
        summary = summarize_messages(older)
        return [{"role": "system", "content": f"Earlier context: {summary}"}] + recent

    return recent
```

**Pros**: Preserves key information
**Cons**: May lose details, adds latency

---

## System Prompt Design

### Structure

```python
SYSTEM_PROMPT_TEMPLATE = """
You are an AI research assistant for pyAgloGen3D, a platform for
simulating and analyzing 3D fractal agglomerates used in aerosol
and nanoparticle research.

## Your Capabilities
- Run simulations: DLA, CCA, Ballistic, Eden algorithms
- Analyze results: box-counting, fractal analysis
- Export data: CSV, Word documents, LaTeX reports
- Query data: list simulations, compare results

## Context
Current user: {username}
{project_context}

## Guidelines
1. Always confirm actions before executing simulations
2. Explain results in scientific terms
3. Suggest appropriate parameters based on user goals
4. When uncertain, ask clarifying questions
5. For batch operations, show expected scope before proceeding

## Output Format
- Use markdown for structured responses
- Include relevant metrics with units
- Cite scientific literature when relevant (if RAG is enabled)
"""
```

### Project Context

```python
def build_project_context(project: Project | None) -> str:
    if not project:
        return "No project selected. User will need to specify project for simulations."

    return f"""
Current project: {project.name}
- Simulations: {project.simulations.count()}
- Recent algorithms: {get_recent_algorithms(project)}
- Last activity: {project.updated_at}
"""
```

---

## Persistence Model

### Database Schema

```python
class Conversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    project = models.ForeignKey(Project, null=True, on_delete=models.SET_NULL)
    title = models.CharField(max_length=255, blank=True)
    provider = models.CharField(max_length=50, default="anthropic")
    model = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_archived = models.BooleanField(default=False)

    class Meta:
        ordering = ['-updated_at']


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4)
    conversation = models.ForeignKey(
        Conversation,
        related_name='messages',
        on_delete=models.CASCADE
    )
    role = models.CharField(choices=[
        ('user', 'User'),
        ('assistant', 'Assistant'),
        ('tool', 'Tool'),
        ('system', 'System'),
    ])
    content = models.TextField(null=True, blank=True)
    tool_calls = models.JSONField(null=True, blank=True)
    tool_call_id = models.CharField(max_length=100, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
```

---

## Title Generation

### Auto-Generate from First Message

```python
def generate_conversation_title(first_message: str, ai_service: AIService) -> str:
    prompt = f"""
    Generate a short (3-6 word) title for a conversation that starts with:
    "{first_message[:200]}"

    Return only the title, no quotes or punctuation.
    """

    response = ai_service.complete([{"role": "user", "content": prompt}])
    return response.content.strip()[:100]
```

### Alternative: Rule-Based

```python
def generate_title_from_content(message: str) -> str:
    # Extract key terms
    keywords = ["simulation", "DLA", "CCA", "analysis", "export", "fractal"]

    for keyword in keywords:
        if keyword.lower() in message.lower():
            return f"{keyword.title()} Discussion"

    return f"Chat {datetime.now().strftime('%b %d')}"
```

---

## Error Handling

### Conversation-Level Errors

| Error | Cause | Handling |
|-------|-------|----------|
| Provider unavailable | API down | Show error, allow retry |
| Token limit exceeded | Long conversation | Truncate or summarize |
| Tool execution failed | Tool error | Include error in response |
| Invalid tool call | LLM hallucination | Return error to LLM |

### Message-Level Retries

```python
async def send_message_with_retry(
    conversation: Conversation,
    content: str,
    max_retries: int = 3
) -> Message:
    for attempt in range(max_retries):
        try:
            return await process_message(conversation, content)
        except RateLimitError:
            await asyncio.sleep(2 ** attempt)
        except ProviderError as e:
            if attempt == max_retries - 1:
                raise
            # Try fallback provider
            conversation.provider = get_fallback_provider()
            conversation.save()

    raise MaxRetriesExceeded()
```

---

## Concurrent Access

### Problem

Multiple tabs/devices sending messages simultaneously.

### Solution: Optimistic Locking

```python
class Conversation(models.Model):
    version = models.IntegerField(default=0)

    def save(self, *args, **kwargs):
        if self.pk:
            # Check version hasn't changed
            current = Conversation.objects.get(pk=self.pk)
            if current.version != self.version:
                raise ConcurrentModificationError()
        self.version += 1
        super().save(*args, **kwargs)
```

### Alternative: Queue Messages

```python
def add_message(conversation_id: str, content: str, user_id: str):
    # Add to Redis queue
    redis.lpush(f"conv:{conversation_id}:queue", json.dumps({
        "content": content,
        "user_id": user_id,
        "timestamp": time.time()
    }))

    # Process queue sequentially
    process_message_queue.delay(conversation_id)
```

---

## Key Takeaways

1. **Structured messages**: Store role, content, tool_calls separately
2. **Context management**: Handle long conversations gracefully
3. **System prompt**: Set clear expectations and context
4. **Auto-titles**: Generate meaningful conversation titles
5. **Error resilience**: Handle provider failures, tool errors
6. **Concurrent access**: Prevent race conditions

---

## Further Reading

- [Anthropic Message Structure](https://docs.anthropic.com/claude/reference/messages_post)
- [OpenAI Chat Completions](https://platform.openai.com/docs/guides/text-generation)
- [Context Window Best Practices](https://www.anthropic.com/index/claude-2-1-prompting)
