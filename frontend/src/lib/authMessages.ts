/**
 * The sentences this client shows that the backend also produces.
 *
 * They live here, and not inline in a component, so a drift test can tie them to
 * the source that owns them (`authMessagesDrift.test.ts` reads
 * `backend/apps/accounts/serializers.py`). A hand-copied sentence is invisible until
 * someone edits one side and the reader meets two vocabularies for one condition —
 * which is the defect #247 was about.
 */

/** `RegisterSerializer.validate` refuses a mismatched confirmation with this. */
export const PASSWORDS_DO_NOT_MATCH = 'Passwords do not match.'
