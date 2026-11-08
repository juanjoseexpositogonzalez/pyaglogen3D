'use client'

/**
 * User settings page.
 *
 * Currently exposes only the CSV Preferences section — a minimal shell that
 * future settings (display, notifications, etc.) can extend.
 *
 * The CSV preferences persist to the authenticated user's profile via
 * PATCH /api/v1/auth/me/ (handled by AuthContext.updateProfile → authApi.updateMe).
 * Values flow through the shared `User` model, so every subsequent CSV export
 * the backend produces honors this choice (see R-csv-export-locale in
 * openspec/changes/import-aggregate/specs/import-aggregate-contract.md).
 *
 * On the design-system kit (issue #183). The shell draws the navigation and
 * the page gutter: `/settings` is not chromeless (`isChromeless` is `/` and
 * `/auth/*` only), so this file contributes neither a `Header` nor a layout
 * box of its own — the two together padded the screen twice and put a
 * second landmark inside the shell's.
 *
 * Nothing below the presentation moved: the same two fields with the same
 * values, the same `updateProfile` call with the same payload, the same three
 * messages, and the same redirect for a visitor without a session.
 *
 * The column keeps the 768px measure it had. Left to itself the form stretches
 * to the shell's full 1440px and each select grows into a reading line nobody
 * scans.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Callout } from '@/components/kit/Callout'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import type {
  CsvColumnDelimiter,
  CsvDecimalSeparator,
} from '@/lib/auth-types'

const decimalOptions: { value: CsvDecimalSeparator; label: string }[] = [
  { value: '.', label: 'Point  (e.g. 1.5)' },
  { value: ',', label: 'Comma  (e.g. 1,5)' },
]

const delimiterOptions: { value: CsvColumnDelimiter; label: string }[] = [
  { value: ',', label: 'Comma  (a,b,c)' },
  { value: ';', label: 'Semicolon  (a;b;c)' },
]

export default function SettingsPage() {
  const router = useRouter()
  const { user, isLoading: authLoading, isAuthenticated, updateProfile } = useAuth()

  const [decimal, setDecimal] = useState<CsvDecimalSeparator>('.')
  const [delimiter, setDelimiter] = useState<CsvColumnDelimiter>(',')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null)

  // Redirect unauthenticated users — settings is account-scoped.
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [authLoading, isAuthenticated, router])

  // Hydrate form state from the current user whenever it changes (initial
  // load + after a successful save when AuthContext refreshes the user).
  useEffect(() => {
    if (user) {
      setDecimal(user.csv_decimal_separator ?? '.')
      setDelimiter(user.csv_column_delimiter ?? ',')
    }
  }, [user])

  const handleSave = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      await updateProfile({
        csv_decimal_separator: decimal,
        csv_column_delimiter: delimiter,
      })
      setFeedback({ kind: 'success', message: 'Preferences saved.' })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save preferences.'
      setFeedback({ kind: 'error', message })
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) {
    return <LoadingScreen message="Checking authentication..." />
  }

  if (!isAuthenticated || !user) {
    return <LoadingScreen message="Redirecting to login..." />
  }

  // Warn when the combination would produce ambiguous output (comma decimal
  // paired with comma delimiter). The backend accepts it, but the resulting
  // file is hard to reparse — call it out so the user picks `;` deliberately.
  const ambiguous = decimal === ',' && delimiter === ','

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="ACCOUNT"
        title="Settings"
        description="Preferences for your pyAgloGen3D account."
      />

      <Panel
        title="CSV Export Preferences"
        hint={
          <>
            Choose how numbers and columns are formatted when exporting CSV
            files. This matches regional conventions — e.g. European{' '}
            <code className="num">1,5;2,5</code> vs US{' '}
            <code className="num">1.5,2.5</code>. The setting applies to every
            CSV export you trigger.
          </>
        }
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="csv-decimal">Decimal Separator</Label>
            <Select
              id="csv-decimal"
              value={decimal}
              onChange={(e) => setDecimal(e.target.value as CsvDecimalSeparator)}
              options={decimalOptions}
            />
            <p className="hint">Character used inside numeric values.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="csv-delimiter">Column Delimiter</Label>
            <Select
              id="csv-delimiter"
              value={delimiter}
              onChange={(e) =>
                setDelimiter(e.target.value as CsvColumnDelimiter)
              }
              options={delimiterOptions}
            />
            <p className="hint">Character used between columns.</p>
          </div>

          {/* A notice, not a bare tinted box: `Callout` pairs the word with the
              icon, so the warning survives greyscale and a reader who cannot
              tell yellow from green. */}
          {ambiguous && (
            <Callout tone="warning" title="Ambiguous format">
              Comma decimal with comma column delimiter produces files that are
              hard to re-parse. Consider switching the delimiter to semicolon.
            </Callout>
          )}

          {feedback && (
            <Callout
              tone={feedback.kind === 'success' ? 'success' : 'danger'}
              title={feedback.message}
            />
          )}

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Preferences'}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
