# Frente 7 Crash Diagnosis: `TypeError: Cannot read properties of undefined (reading 'variant')`

## Root Cause

**File**: `frontend/src/components/common/StatusBadge.tsx`, line 19 → 22

```tsx
const config = statusConfig[status]       // ← undefined when status = "empty"
return <Badge variant={config.variant}>   // ← CRASH: undefined.variant
```

**Trigger**: `backend/apps/fractal_analysis/views.py`, line 853 in `batch_list_view`:

```python
"status": "completed" if b.n_successful and b.n_successful > 0 else "empty",
```

The backend synthesizes `"empty"` as a status for batches with zero successful images. This value does NOT exist in the frontend's `statusConfig` map (which only covers `queued | running | completed | failed | cancelled`). When `statusConfig["empty"]` returns `undefined`, the subsequent `.variant` access throws.

## Why It Crashes the Dashboard, Not the Drill-Down

The crash path is:

1. User navigates to `/projects/[id]` (project dashboard)
2. `page.tsx` calls `useFraktalBatches(id)` → hits `GET /api/v1/projects/{id}/fraktal/batches/`
3. Backend returns batch list with `status: "empty"` for any batch that has `n_successful == 0`
4. `<FraktalBatchesSection>` renders → iterates `batches.map(batch => ...)` → renders `<StatusBadge status={batch.status} />`
5. `StatusBadge` does `statusConfig["empty"]` → `undefined` → `undefined.variant` → **TypeError**

The drill-down page (`FraktalBatchImageDetail.tsx`) does NOT render `<StatusBadge>` at all — it fetches individual image detail, not the batch list. So the drill-down is unaffected.

Any project that has at least one batch where ALL images failed (or the batch has 0 images) will crash the entire project dashboard.

## Suggested Fix

**Safest minimal change** — guard in `StatusBadge.tsx` (1 line):

```tsx
export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status]
  if (!config) return <Badge variant="secondary">{status}</Badge>  // ← ADD THIS
  // ... rest unchanged
}
```

**Also fix the backend** to stop emitting non-standard status values (`views.py:853`):

```python
# Before:
"status": "completed" if b.n_successful and b.n_successful > 0 else "empty",

# After:
"status": "completed",  # Batch existence in DB implies processing finished
```

The backend should never return a status value that isn't in the `AnalysisStatus` enum. Batches in the DB are already completed (they're persisted post-analysis). "0 successful" is a data quality issue, not a status.

## Tests Needed

**Vitest regression test** in `frontend/src/__tests__/StatusBadge.test.tsx`:

```tsx
it('renders gracefully for unknown status values', () => {
  // @ts-expect-error — testing runtime safety for backend mismatches
  render(<StatusBadge status="empty" />)
  expect(screen.getByText('empty')).toBeInTheDocument()
})

it('renders gracefully for undefined status', () => {
  // @ts-expect-error — testing runtime safety
  render(<StatusBadge status={undefined} />)
  // Should not throw
})
```

**Backend test** in `test_batch_endpoints.py`:

```python
def test_batch_list_status_is_valid_analysis_status(self, ...):
    """Batch list status must be a value from AnalysisStatus.choices."""
    # Create batch with n_successful=0
    # GET /batches/ → assert status in [s[0] for s in AnalysisStatus.choices]
```
