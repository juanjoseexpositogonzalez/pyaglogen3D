'use client'

/**
 * AI provider settings (issue #183, migration slice 2).
 *
 * The screen stops mounting the deprecated layout `Header` and its own page
 * frame: `/ai/settings` is not chromeless (`AppShell.isChromeless` is `/` and
 * `/auth/*` only), so the shell already draws the navigation, the width cap and
 * the gutter. A second full-width, padded box padded the page twice and put a
 * second landmark inside the shell's own `<main>`.
 *
 * On the design-system kit: `PageHeader` for the title and the add action,
 * `Panel` for the add form and for each configured provider, `Callout` for a
 * failed request, and `EmptyState` for the no-providers view. Nothing below
 * the presentation moved — the same access check, the same CRUD calls with
 * the same payloads, the same messages.
 *
 * Security note: this page never renders an API key. `Input type="password"`
 * holds the key the user is typing; the provider list `AIProvider` carries no
 * key field, and nothing read from the backend reaches the DOM.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Callout } from '@/components/kit/Callout'
import { EmptyState } from '@/components/kit/EmptyState'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { aiApi, type AIProvider, type AIProviderCreate } from '@/lib/ai-api'
import { ModelPickerSection } from '@/components/ai/ModelPickerSection'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { Plus, Trash2, Check, X, Star, TestTube, ShieldAlert, KeyRound, Loader2 } from 'lucide-react'

const PROVIDERS = [
  {
    value: 'anthropic',
    label: 'Anthropic (Claude)',
    models: [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-5-haiku-20241022',
    ]
  },
  {
    value: 'openai',
    label: 'OpenAI (GPT)',
    models: [
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'o1',
      'o3-mini',
    ]
  },
  {
    value: 'groq',
    label: 'Groq',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'llama3-70b-8192',
      'llama3-8b-8192',
      'gemma2-9b-it',
    ]
  },
  {
    value: 'xai',
    label: 'xAI (Grok)',
    models: [
      'grok-3',
      'grok-2',
      'grok-2-mini',
      'grok-2-vision-1212',
    ]
  },
] as const

type ProviderType = typeof PROVIDERS[number]['value']

/**
 * The default-provider marker.
 *
 * `StatusChip` is the kit's pill, but its union is `SimulationStatus` — a
 * job's state. A provider being the account default is not a job state, so
 * the pill is built here from the same recipe over the kit's tokens rather
 * than borrowing a state the product does not have.
 */
function DefaultPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning bg-warning-soft px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-warning">
      <Star className="h-3 w-3" aria-hidden="true" />
      Default
    </span>
  )
}

export default function AISettingsPage() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null)

  // Form state
  const [newProvider, setNewProvider] = useState<ProviderType>('anthropic')
  const [newApiKey, setNewApiKey] = useState('')
  const [newModel, setNewModel] = useState<string>(PROVIDERS[0].models[0])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    checkAccessAndLoadProviders()
  }, [])

  async function checkAccessAndLoadProviders() {
    try {
      const accessResponse = await aiApi.checkAccess()
      setHasAccess(accessResponse.has_access)
      if (accessResponse.has_access) {
        await loadProviders()
      } else {
        setIsLoading(false)
      }
    } catch {
      setHasAccess(false)
      setIsLoading(false)
    }
  }

  async function loadProviders() {
    try {
      setIsLoading(true)
      const response = await aiApi.listProviders()
      setProviders(response.results || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleAddProvider(e: React.FormEvent) {
    e.preventDefault()
    if (!newApiKey.trim()) return

    try {
      setIsSubmitting(true)
      setError(null)
      const data: AIProviderCreate = {
        provider: newProvider,
        api_key: newApiKey,
        model_name: newModel,
        is_default: providers.length === 0, // First provider is default
      }
      await aiApi.createProvider(data)
      setNewApiKey('')
      setShowAddForm(false)
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add provider')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeleteProvider(id: string) {
    if (!confirm('Are you sure you want to delete this provider?')) return

    try {
      await aiApi.deleteProvider(id)
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete provider')
    }
  }

  async function handleTestProvider(id: string) {
    try {
      setTestingId(id)
      setTestResult(null)
      const result = await aiApi.testProvider(id)
      setTestResult({ id, success: result.success, message: result.message })
      // Sync model catalog from test_connection response (T4.8)
      if (result.success && result.models) {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === id
              ? { ...p, available_models: result.models!, models_refreshed_at: result.refreshed_at ?? null }
              : p
          )
        )
      }
    } catch (err) {
      setTestResult({ id, success: false, message: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTestingId(null)
    }
  }

  async function handleRefreshModels(id: string) {
    const result = await aiApi.refreshModels(id)
    if (result.success) {
      setProviders((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, available_models: result.models, models_refreshed_at: result.refreshed_at }
            : p
        )
      )
    }
  }

  async function handleModelChange(providerId: string, modelId: string) {
    try {
      await aiApi.updateProvider(providerId, { model_name: modelId })
      setProviders((prev) =>
        prev.map((p) => (p.id === providerId ? { ...p, model_name: modelId } : p))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update model')
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await aiApi.setDefaultProvider(id)
      await loadProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set default')
    }
  }

  const selectedProviderConfig = PROVIDERS.find(p => p.value === newProvider)

  if (authLoading || isLoading) {
    return <LoadingScreen />
  }

  if (hasAccess === false) {
    return (
      <EmptyState
        headingLevel={2}
        icon={ShieldAlert}
        title="Access Required"
        description="AI features are not enabled for your account. Please contact an administrator to request access."
        action={
          <Button variant="outline" onClick={() => router.push('/dashboard')}>
            Back to Dashboard
          </Button>
        }
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="AI"
        title="AI Settings"
        description="Manage your AI provider API keys"
        actions={
          <Button onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add Provider
          </Button>
        }
      />

      <div className="space-y-6">
        {/* A failed request is a state, so it is a `Callout`, not a tinted box:
            the role and the message survive greyscale and a screen reader. */}
        {error && <Callout tone="danger" title={error} />}

        {showAddForm && (
          <Panel title="Add AI Provider" hint="Add your API key for an AI provider">
            <form onSubmit={handleAddProvider} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="provider">Provider</Label>
                  <Select
                    id="provider"
                    value={newProvider}
                    onChange={(e) => {
                      const provider = e.target.value as ProviderType
                      setNewProvider(provider)
                      const config = PROVIDERS.find(p => p.value === provider)
                      if (config) setNewModel(config.models[0])
                    }}
                    options={PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model</Label>
                  <Select
                    id="model"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    options={selectedProviderConfig?.models.map(m => ({ value: m, label: m })) || []}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="sk-..."
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  required
                />
                <p className="hint">
                  Your API key is encrypted and stored securely
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Provider
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Panel>
        )}

        {providers.length === 0 ? (
          <EmptyState
            headingLevel={2}
            icon={KeyRound}
            title="No AI providers configured"
            description="No AI providers configured. Add your API key to use AI features."
            action={
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add Provider
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {providers.map((provider) => (
              <Panel
                key={provider.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {PROVIDERS.find(p => p.value === provider.provider)?.label || provider.provider}
                    {provider.is_default && <DefaultPill />}
                  </span>
                }
                action={
                  <div className="flex items-center gap-2">
                    {testResult?.id === provider.id && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-[12px]',
                          testResult.success ? 'text-success' : 'text-danger',
                        )}
                      >
                        {testResult.success ? (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <X className="h-4 w-4" aria-hidden="true" />
                        )}
                        {testResult.message}
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestProvider(provider.id)}
                      disabled={testingId === provider.id}
                      aria-label="Test connection"
                    >
                      {testingId === provider.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <TestTube className="h-4 w-4" />
                      )}
                    </Button>
                    {!provider.is_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetDefault(provider.id)}
                        aria-label="Set as default"
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteProvider(provider.id)}
                      className="text-danger"
                      aria-label="Delete provider"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                }
              >
                {/* Dynamic model picker (T4.3–T4.8) */}
                <ModelPickerSection
                  availableModels={provider.available_models ?? []}
                  currentModelName={provider.model_name}
                  modelsRefreshedAt={provider.models_refreshed_at ?? null}
                  onModelChange={(modelId) => handleModelChange(provider.id, modelId)}
                  onRefreshModels={() => handleRefreshModels(provider.id)}
                />
              </Panel>
            ))}
          </div>
        )}

        <div>
          <Button variant="outline" onClick={() => router.push('/ai')}>
            Back to AI Assistant
          </Button>
        </div>
      </div>
    </div>
  )
}
