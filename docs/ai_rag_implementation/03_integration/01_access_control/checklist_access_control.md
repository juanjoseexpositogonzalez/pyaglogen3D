# Checklist: Access Control

**Branch**: `feature/ai-access-control`
**Depends on**: All AI and RAG features merged
**Estimated time**: 1 day

---

## Prerequisites

- [ ] All AI features implemented
- [ ] All RAG features implemented
- [ ] Admin user management exists

---

## Backend Implementation

### User Model Update

- [ ] Add field to User model:
  ```python
  has_ai_access = models.BooleanField(default=False)
  ```

- [ ] Add properties:
  ```python
  @property
  def can_use_ai(self) -> bool
  @property
  def can_manage_rag(self) -> bool
  ```

- [ ] Create migration: `python manage.py makemigrations accounts`
- [ ] Apply migration: `python manage.py migrate`

### Permission Classes

- [ ] Create `apps/ai_assistant/permissions.py`:
  - `IsAIUser` permission class
  - `IsRAGAdmin` permission class

- [ ] Create `apps/rag/permissions.py`:
  - Import and use `IsRAGAdmin`

### Apply Permissions to Views

- [ ] Update all AI assistant views:
  - `ConversationViewSet`: Add `IsAIUser`
  - `ChatView`: Add `IsAIUser`
  - `ToolListView`: Add `IsAIUser`
  - `ToolExecuteView`: Add `IsAIUser`
  - `AIProviderConfigViewSet`: Add `IsAIUser`

- [ ] Update RAG views:
  - `SearchView`: Add `IsAIUser`
  - `DocumentViewSet` (user): Add `IsAIUser`
  - `RAGStatsView` (admin): Add `IsRAGAdmin`
  - `AdminDocumentViewSet`: Add `IsRAGAdmin`
  - `ReindexView`: Add `IsRAGAdmin`

### User Management Endpoints

- [ ] Add to `apps/accounts/views.py`:
  - `POST /users/{id}/grant-ai-access/`
  - `POST /users/{id}/revoke-ai-access/`

- [ ] Update `apps/accounts/serializers.py`:
  - Add `has_ai_access` to UserSerializer
  - Add `can_use_ai` to read-only fields

### Audit Logging (Optional)

- [ ] Create `apps/ai_assistant/models.py` - `AIAccessLog`:
  - `user` (ForeignKey)
  - `path` (CharField)
  - `method` (CharField)
  - `status_code` (IntegerField)
  - `timestamp` (DateTimeField)

- [ ] Create middleware to log AI access

---

## Frontend Implementation

### API Client Updates

- [ ] Update user type in `src/lib/types.ts`:
  ```typescript
  interface User {
      // existing...
      has_ai_access: boolean;
      can_use_ai: boolean;
      can_manage_rag: boolean;
  }
  ```

- [ ] Add API methods:
  - `grantAIAccess(userId)`
  - `revokeAIAccess(userId)`

### Protected Routes

- [ ] Create AI access guard:
  ```tsx
  // src/app/ai-assistant/layout.tsx
  if (!user?.can_use_ai) redirect('/dashboard');
  ```

- [ ] Create RAG admin guard:
  ```tsx
  // src/app/admin/rag/layout.tsx
  if (!user?.can_manage_rag) redirect('/dashboard');
  ```

### Navigation Updates

- [ ] Update `src/components/layout/Header.tsx`:
  - Show AI Assistant link only if `can_use_ai`
  - Show RAG admin link only if `can_manage_rag`

### Admin User Management

- [ ] Update `src/app/admin/page.tsx`:
  - Add AI access toggle to user list
  - Show current AI access status

### Access Denied Page

- [ ] Create `src/components/ai/AIAccessDenied.tsx`:
  - Clear message about access
  - Contact admin instruction
  - Return to dashboard button

---

## Testing

### Backend Tests

- [ ] Create `apps/ai_assistant/tests/test_permissions.py`:
  - Test `IsAIUser` allows AI users
  - Test `IsAIUser` denies regular users
  - Test `IsRAGAdmin` allows staff
  - Test `IsRAGAdmin` denies AI users

- [ ] Create `apps/accounts/tests/test_ai_access.py`:
  - Test grant endpoint
  - Test revoke endpoint
  - Test permission enforcement

### Frontend Tests

- [ ] Create `src/__tests__/components/ai/AIAccessDenied.test.tsx`
- [ ] Create route guard tests

### Integration Tests

- [ ] Test full flow:
  - Regular user cannot access AI
  - Admin grants access
  - User can now access AI
  - Admin revokes access
  - User cannot access AI

---

## Manual Testing

- [ ] Login as regular user:
  - Verify AI features not visible
  - Verify direct URL redirects

- [ ] Login as admin:
  - Grant AI access to user
  - Verify change reflected

- [ ] Login as AI user:
  - Verify AI features accessible
  - Verify RAG admin not accessible

- [ ] Login as staff:
  - Verify full access

---

## Git

- [ ] Create branch: `git checkout -b feature/ai-access-control`
- [ ] Implement model changes
- [ ] Implement permissions
- [ ] Update views
- [ ] Add tests
- [ ] Push and create PR

---

## Definition of Done

- [ ] User model has `has_ai_access` field
- [ ] Permission classes created
- [ ] All views properly protected
- [ ] Frontend routes guarded
- [ ] Admin can manage access
- [ ] Audit logging implemented
- [ ] All tests passing
- [ ] PR merged
