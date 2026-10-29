# Checklist: RAG Admin Interface

**Branch**: `feature/rag-admin`
**Depends on**: `feature/rag-integration` merged
**Estimated time**: 1-2 days

---

## Prerequisites

- [ ] `feature/rag-integration` merged
- [ ] RAG system fully functional
- [ ] Admin user authentication working

---

## Backend Implementation

### Admin Views

- [ ] Create `apps/rag/views_admin.py`:
  - `RAGStatsView`:
    - `GET /rag/admin/stats/`
    - Return: document counts, chunk counts, storage size
  - `AdminDocumentViewSet`:
    - Extended list with all documents
    - Filter by status
    - Include chunk counts
  - `DocumentChunksView`:
    - `GET /rag/admin/documents/{id}/chunks/`
    - Paginated chunk list
  - `ReindexDocumentView`:
    - `POST /rag/admin/documents/{id}/reindex/`
    - Queue reindexing task
  - `TestSearchView`:
    - `POST /rag/admin/search/test/`
    - Return results with debug info

### Serializers

- [ ] Create admin-specific serializers:
  - `AdminDocumentSerializer` (includes error details, chunk count)
  - `DocumentChunkDetailSerializer` (full content, metadata)
  - `RAGStatsSerializer`
  - `TestSearchResultSerializer` (includes scores, timing)

### URLs

- [ ] Update `apps/rag/urls.py`:
  ```python
  # Admin routes
  path('admin/stats/', RAGStatsView.as_view(), name='rag-stats'),
  path('admin/documents/', AdminDocumentListView.as_view()),
  path('admin/documents/<uuid:pk>/chunks/', DocumentChunksView.as_view()),
  path('admin/documents/<uuid:pk>/reindex/', ReindexDocumentView.as_view()),
  path('admin/search/test/', TestSearchView.as_view()),
  ```

### Permissions

- [ ] Ensure all admin views use `IsRAGAdmin` permission

---

## Frontend Implementation

### Types

- [ ] Add admin types to `src/lib/types.ts`:
  ```typescript
  interface RAGStats {
      total_documents: number;
      documents_by_status: Record<string, number>;
      total_chunks: number;
      storage_size_mb: number;
  }

  interface AdminDocument extends Document {
      chunk_count: number;
      error_message?: string;
  }
  ```

### API Client

- [ ] Add admin API methods:
  - `getRAGStats()`
  - `getAdminDocuments(params)`
  - `getDocumentChunks(documentId)`
  - `reindexDocument(documentId)`
  - `testSearch(query, options)`

### Pages

- [ ] Create `src/app/admin/rag/page.tsx`:
  - RAG dashboard with stats
  - Document list
  - Quick actions

- [ ] Create `src/app/admin/rag/documents/[id]/page.tsx`:
  - Document detail view
  - Chunk browser
  - Reindex button

- [ ] Create `src/app/admin/rag/search/page.tsx`:
  - Search test interface
  - Results with scores
  - Query analysis

### Components

- [ ] Create `src/components/admin/rag/`:
  - `RAGStatsCards.tsx` - Statistics display
  - `DocumentTable.tsx` - Document list with filters
  - `DocumentStatusBadge.tsx` - Status indicator
  - `ChunkViewer.tsx` - View document chunks
  - `SearchTester.tsx` - Test search queries
  - `UploadDialog.tsx` - PDF upload modal
  - `ImportDialog.tsx` - arXiv/S2 import

### Navigation

- [ ] Add RAG admin link to admin sidebar:
  ```tsx
  { label: "Knowledge Base", href: "/admin/rag", icon: Database }
  ```

---

## Testing

### Backend Tests

- [ ] Create `apps/rag/tests/test_admin_views.py`:
  - Test stats endpoint
  - Test admin document list
  - Test chunk viewing
  - Test reindex action
  - Test search testing
  - Test permission enforcement

### Frontend Tests

- [ ] Create component tests:
  - `RAGStatsCards.test.tsx`
  - `DocumentTable.test.tsx`
  - `SearchTester.test.tsx`

---

## Manual Testing

- [ ] View RAG statistics
- [ ] Browse document list
- [ ] Filter by status
- [ ] View document chunks
- [ ] Test reindex action
- [ ] Upload new PDF
- [ ] Import from arXiv
- [ ] Test search queries
- [ ] Verify admin-only access

---

## Git

- [ ] Create branch: `git checkout -b feature/rag-admin`
- [ ] Implement backend views
- [ ] Implement frontend pages
- [ ] Add tests
- [ ] Push and create PR

---

## Definition of Done

- [ ] Stats dashboard functional
- [ ] Document management working
- [ ] Chunk viewer implemented
- [ ] Search testing available
- [ ] Upload/import working
- [ ] Admin-only access enforced
- [ ] All tests passing
- [ ] PR merged
