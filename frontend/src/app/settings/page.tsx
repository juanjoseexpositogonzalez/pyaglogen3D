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
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Header } from '@/components/layout/Header'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Preferences for your pyAgloGen3D account.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>CSV Export Preferences</CardTitle>
            <CardDescription>
              Choose how numbers and columns are formatted when exporting CSV
              files. This matches regional conventions — e.g. European{' '}
              <code className="bg-muted px-1 rounded">1,5;2,5</code> vs US{' '}
              <code className="bg-muted px-1 rounded">1.5,2.5</code>. The
              setting applies to every CSV export you trigger.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="csv-decimal">Decimal Separator</Label>
              <Select
                id="csv-decimal"
                value={decimal}
                onChange={(e) =>
                  setDecimal(e.target.value as CsvDecimalSeparator)
                }
                options={decimalOptions}
              />
              <p className="text-xs text-muted-foreground">
                Character used inside numeric values.
              </p>
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
              <p className="text-xs text-muted-foreground">
                Character used between columns.
              </p>
            </div>

            {ambiguous && (
              <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm">
                <strong>Ambiguous format:</strong> comma decimal with comma
                column delimiter produces files that are hard to re-parse.
                Consider switching the delimiter to semicolon.
              </div>
            )}

            {feedback && (
              <div
                className={
                  feedback.kind === 'success'
                    ? 'rounded-md border border-green-500/50 bg-green-500/10 p-3 text-sm'
                    : 'rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive'
                }
              >
                {feedback.message}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Preferences'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
