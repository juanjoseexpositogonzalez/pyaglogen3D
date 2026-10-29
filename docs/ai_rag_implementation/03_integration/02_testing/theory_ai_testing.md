# Theory: Testing AI/LLM Systems

Strategies for testing non-deterministic AI features.

---

## The Testing Challenge

LLM outputs are non-deterministic. Traditional assertions break:

```python
# This will fail randomly!
def test_ai_response():
    response = ai.complete("What is 2+2?")
    assert response == "4"  # Might say "Four", "2+2=4", etc.
```

---

## Testing Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI System Testing Pyramid                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                         ┌───────────────┐                           │
│                         │   E2E Tests   │  Few, expensive           │
│                         │  (Real APIs)  │                           │
│                         └───────────────┘                           │
│                                                                     │
│                    ┌─────────────────────────┐                      │
│                    │   Integration Tests     │  Some, mocked LLM    │
│                    │   (Tool execution)      │                      │
│                    └─────────────────────────┘                      │
│                                                                     │
│              ┌─────────────────────────────────────┐                │
│              │         Unit Tests                   │  Many, fast   │
│              │  (Parsing, formatting, validation)   │               │
│              └─────────────────────────────────────┘                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Unit Testing (Deterministic)

Test everything around the LLM call:

### Tool Parameter Validation

```python
def test_simulation_tool_validates_particles():
    tool = RunDLASimulationTool()

    # Valid
    result = tool.validate({"n_particles": 500})
    assert result.is_valid

    # Invalid - too small
    result = tool.validate({"n_particles": 5})
    assert not result.is_valid
    assert "minimum" in result.error

    # Invalid - wrong type
    result = tool.validate({"n_particles": "five hundred"})
    assert not result.is_valid
```

### Response Parsing

```python
def test_parse_anthropic_tool_call():
    raw_response = {
        "content": [
            {
                "type": "tool_use",
                "id": "call_123",
                "name": "run_dla_simulation",
                "input": {"n_particles": 500}
            }
        ]
    }

    parsed = parse_anthropic_response(raw_response)

    assert len(parsed.tool_calls) == 1
    assert parsed.tool_calls[0].name == "run_dla_simulation"
    assert parsed.tool_calls[0].arguments == {"n_particles": 500}
```

### Context Building

```python
def test_rag_context_fits_budget():
    chunks = [
        SearchResult(content="A" * 1000, score=0.9),
        SearchResult(content="B" * 1000, score=0.8),
        SearchResult(content="C" * 1000, score=0.7),
    ]

    formatted = format_context(chunks, max_chars=2500)

    # Should include first 2 chunks, skip third
    assert "A" * 100 in formatted
    assert "B" * 100 in formatted
    assert "C" * 100 not in formatted
```

### Citation Extraction

```python
def test_extract_citations():
    response = "Studies show Df = 1.78 [Meakin, 1984] and [Witten, 1981]."

    citations = extract_citations(response)

    assert len(citations) == 2
    assert citations[0].author == "Meakin"
    assert citations[0].year == 1984
```

---

## Integration Testing (Mocked LLM)

Mock the LLM to test the full flow:

### Mocking Strategy

```python
@pytest.fixture
def mock_ai_service(mocker):
    """Mock AI service with predictable responses."""
    mock = mocker.patch('apps.ai_assistant.services.ai_service.AIService')

    mock.return_value.complete_with_tools.return_value = AIResponse(
        content=None,
        tool_calls=[
            ToolCall(
                id="call_123",
                name="run_dla_simulation",
                arguments={"n_particles": 500}
            )
        ],
        stop_reason=StopReason.TOOL_USE
    )

    return mock
```

### Full Chat Flow Test

```python
def test_chat_executes_simulation_tool(mock_ai_service, db):
    user = UserFactory(has_ai_access=True)
    project = ProjectFactory(owner=user)
    conversation = ConversationFactory(user=user, project=project)

    chat_service = ChatService(user)
    response = chat_service.send_message(
        conversation,
        "Run a DLA simulation with 500 particles"
    )

    # Verify simulation was created
    assert Simulation.objects.filter(
        project=project,
        algorithm="DLA",
        parameters__n_particles=500
    ).exists()
```

### RAG Integration Test

```python
def test_chat_retrieves_context(mock_ai_service, mock_search, db):
    # Setup mock search
    mock_search.return_value = [
        SearchResult(
            content="DLA produces Df ≈ 1.78",
            document=DocumentFactory(title="Meakin 1984")
        )
    ]

    # First call: AI requests search
    mock_ai_service.return_value.complete_with_tools.side_effect = [
        AIResponse(content="Based on [Meakin, 1984], Df ≈ 1.78")
    ]

    response = chat_service.send_message(conversation, "What is DLA's Df?")

    # Verify context was retrieved
    mock_search.assert_called_once()
    assert "1.78" in response.content
    assert "Meakin" in response.content
```

---

## E2E Testing (Real APIs)

Occasional tests with real LLMs:

```python
@pytest.mark.slow
@pytest.mark.skipif(
    not os.environ.get("ANTHROPIC_API_KEY"),
    reason="Requires API key"
)
def test_real_ai_response():
    """Test actual LLM behavior. Run sparingly."""
    ai_service = AIService()

    response = ai_service.complete([
        {"role": "user", "content": "Respond with only the word 'hello'"}
    ])

    # Loose assertion
    assert "hello" in response.content.lower()
```

### Property-Based Testing

```python
@pytest.mark.slow
def test_ai_always_returns_valid_json():
    """Verify AI always returns parseable JSON when asked."""
    ai_service = AIService()

    for _ in range(10):
        response = ai_service.complete([
            {"role": "user", "content": "Return a JSON object with keys 'a' and 'b'"}
        ])

        # Should be valid JSON
        data = json.loads(response.content)
        assert "a" in data
        assert "b" in data
```

---

## Testing Strategies

### Snapshot Testing

```python
def test_system_prompt_generation(snapshot):
    """Verify system prompt structure."""
    prompt = build_system_prompt(user=mock_user, project=mock_project)

    # Compare to stored snapshot
    snapshot.assert_match(prompt, "system_prompt.txt")
```

### Behavioral Testing

Test what the system does, not exact outputs:

```python
def test_tool_is_called_for_simulation_request(mock_ai_service):
    """AI should call simulation tool for sim requests."""
    # Setup: AI returns tool call
    mock_ai_service.return_value.complete_with_tools.return_value = AIResponse(
        tool_calls=[ToolCall(name="run_dla_simulation", ...)]
    )

    chat_service.send_message(conv, "Run a simulation")

    # Verify tool was called (not exact response)
    assert Simulation.objects.count() == 1
```

### Fuzzing

```python
from hypothesis import given, strategies as st

@given(st.text(min_size=1, max_size=1000))
def test_input_never_crashes(user_input):
    """System should never crash on any input."""
    try:
        result = process_user_message(user_input)
        assert result is not None
    except ValidationError:
        pass  # Expected for invalid input
```

---

## Test Organization

```
apps/ai_assistant/tests/
├── __init__.py
├── conftest.py           # Fixtures
├── factories.py          # Model factories
├── mocks/
│   ├── __init__.py
│   └── ai_responses.py   # Canned AI responses
├── unit/
│   ├── test_parsing.py
│   ├── test_validation.py
│   └── test_formatting.py
├── integration/
│   ├── test_chat_flow.py
│   ├── test_tool_execution.py
│   └── test_rag_integration.py
└── e2e/
    └── test_real_api.py  # Slow, optional
```

---

## Key Takeaways

1. **Unit test the deterministic parts**: Parsing, validation, formatting
2. **Mock the LLM**: Predictable integration tests
3. **Test behavior, not exact output**: "Tool was called" vs "Response was X"
4. **E2E sparingly**: Expensive and flaky
5. **Property testing**: Verify invariants hold
6. **Fuzzing**: Ensure robustness

---

## Further Reading

- [Testing LLM Applications](https://www.anthropic.com/engineering)
- [pytest-mock Documentation](https://pytest-mock.readthedocs.io/)
- [Hypothesis for Python](https://hypothesis.readthedocs.io/)
