# RAG Implementation Status

**Status**: PAUSED - Awaiting pgvector-enabled PostgreSQL
**Branch**: `feature/rag-implementation`
**PR**: #45
**Last Updated**: 2026-02-28

## What's Done (100% Code Complete)

All RAG code is implemented and ready. Only the database extension is missing.

### Files Created

```
backend/apps/rag/
├── __init__.py
├── apps.py
├── models.py                    # IndexedDocument, DocumentChunk with VectorField
├── admin.py                     # Admin interface with reindex actions
├── tasks.py                     # Celery indexing tasks
├── services/
│   ├── __init__.py
│   ├── embedding_service.py     # OpenAI text-embedding-3-small
│   ├── chunking.py              # Domain-specific chunking strategies
│   └── search_service.py        # pgvector similarity search
├── migrations/
│   └── 0001_initial.py          # pgvector extension + models + HNSW index
└── management/commands/
    ├── backfill_rag_index.py    # Index existing simulations/analyses
    └── seed_scientific_docs.py  # Seed DLA/CCA/fractal documentation
```

### Files Modified

- `backend/pyproject.toml` - Added pgvector, langchain-text-splitters
- `backend/config/settings/base.py` - Added RAG settings and apps.rag
- `backend/apps/simulations/tasks.py` - Auto-index on simulation completion
- `backend/apps/fractal_analysis/tasks.py` - Auto-index on analysis completion
- `backend/apps/ai_assistant/tools/rag_tools.py` - 3 RAG tools for AI
- `backend/apps/ai_assistant/tools/registration.py` - Registered RAG tools
- `backend/apps/ai_assistant/views.py` - Updated system prompt

### Custom Postgres Dockerfile (Optional)

```
docker/postgres/
├── Dockerfile      # postgres-flex + pgvector v0.8.0
└── fly.toml        # Build config
```

## What's Blocking

**pgvector extension not available on Fly.io self-managed Postgres**

The current `pyaglogen3d-db` uses `flyio/postgres-flex:17.2` which does NOT include pgvector.

Error when running migrations:
```
psycopg.errors.FeatureNotSupported: extension "vector" is not available
DETAIL: Could not open extension control file "/usr/share/postgresql/17/extension/vector.control"
```

## Options to Resume

### Option 1: Fly.io Managed Postgres (MPG) - $38/month
- Has pgvector built-in
- Create with: `fly mpg create --name pyaglogen3d-mpg --plan development --region fra`
- Migrate data from old database
- Attach to API app

### Option 2: External PostgreSQL with pgvector
- **Supabase** (Free tier available, has pgvector)
- **Neon** (Free tier available, has pgvector)
- **Railway** (Has pgvector)
- Update DATABASE_URL secret on Fly.io

### Option 3: Custom Docker Image for postgres-flex
- Build image with pgvector from `docker/postgres/Dockerfile`
- Push to Docker Hub
- Update Fly.io machine to use custom image
- Complex but keeps current infrastructure

## Resume Steps

1. **Choose a pgvector-enabled PostgreSQL option** (see above)

2. **If using new database, migrate data**:
   ```bash
   # Export from old
   fly postgres connect -a pyaglogen3d-db
   \copy (SELECT * FROM ...) TO '/tmp/export.csv'

   # Import to new
   fly mpg connect --cluster NEW_CLUSTER_ID
   \copy table FROM '/tmp/export.csv'
   ```

3. **Update DATABASE_URL secret**:
   ```bash
   fly secrets set DATABASE_URL="postgresql://..." -a pyaglogen3d-api
   ```

4. **Run migrations**:
   ```bash
   fly ssh console -a pyaglogen3d-api -C "python manage.py migrate"
   ```

5. **Seed scientific documentation**:
   ```bash
   fly ssh console -a pyaglogen3d-api -C "python manage.py seed_scientific_docs --sync"
   ```

6. **Backfill existing data**:
   ```bash
   fly ssh console -a pyaglogen3d-api -C "python manage.py backfill_rag_index"
   ```

7. **Add OPENAI_API_KEY** (if not already set):
   ```bash
   fly secrets set OPENAI_API_KEY="sk-..." -a pyaglogen3d-api
   ```

8. **Test RAG**:
   - Open AI chat in the app
   - Ask: "Search my simulations for DLA with high fractal dimension"
   - The AI should use `search_knowledge_base` tool

## RAG Features When Complete

### AI Tools Available
- `search_knowledge_base` - Semantic search across user data and scientific docs
- `get_simulation_insights` - Aggregated statistics from past simulations
- `get_analysis_insights` - Aggregated statistics from past analyses

### Auto-Indexing
- Simulations indexed automatically when completed
- Analyses indexed automatically when completed
- Scientific documentation seeded via management command

### Data Isolation
- User data only visible to owner
- Scientific docs (`is_global=True`) visible to all users
- pgvector HNSW index for fast similarity search

## Architecture

```
User Query → AI Assistant → search_knowledge_base tool
                                    ↓
                          Embed query (OpenAI)
                                    ↓
                          pgvector similarity search
                                    ↓
                          Return relevant chunks
                                    ↓
                          AI uses context in response
```

## Cost Considerations

| Option | Monthly Cost | Notes |
|--------|-------------|-------|
| Fly.io MPG Development | $38 | Simplest, built-in pgvector |
| Supabase Free | $0 | 500MB storage, good for dev |
| Supabase Pro | $25 | 8GB storage, production ready |
| Neon Free | $0 | Limited compute, good for dev |
| Custom Docker | $0* | Uses existing Fly Postgres, complex setup |

*Custom Docker requires no additional cost but needs image building and deployment.
