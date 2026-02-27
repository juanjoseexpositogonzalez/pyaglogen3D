'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { aiApi, type AIProvider, type AIProviderCreate } from '@/lib/ai-api'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2, Plus, Trash2, Check, X, Star, TestTube, ShieldAlert } from 'lucide-react'

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)', models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-20241022'] },
  { value: 'openai', label: 'OpenAI (GPT)', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  { value: 'groq', label: 'Groq', models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'] },
  { value: 'xai', label: 'xAI (Grok)', models: ['grok-2', 'grok-2-mini'] },
] as const

type ProviderType = typeof PROVIDERS[number]['value']

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
    } catch (err) {
      setTestResult({ id, success: false, message: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTestingId(null)
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
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </main>
      </div>
    )
  }

  if (hasAccess === false) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <Card className="bg-gray-800/50 border-gray-700 max-w-lg mx-auto">
            <CardContent className="p-8 text-center">
              <ShieldAlert className="h-16 w-16 mx-auto text-yellow-500 mb-4" />
              <h2 className="text-2xl font-bold text-white mb-2">Access Required</h2>
              <p className="text-gray-400 mb-4">
                AI features are not enabled for your account. Please contact an administrator to request access.
              </p>
              <Button variant="outline" onClick={() => router.push('/dashboard')}>
                Back to Dashboard
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">AI Settings</h1>
            <p className="text-gray-400 mt-1">
              Manage your AI provider API keys
            </p>
          </div>
          <Button onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Provider
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {showAddForm && (
          <Card className="mb-6 bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Add AI Provider</CardTitle>
              <CardDescription className="text-gray-400">
                Add your API key for an AI provider
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddProvider} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="provider" className="text-gray-200">Provider</Label>
                    <Select
                      value={newProvider}
                      onChange={(e) => {
                        const provider = e.target.value as ProviderType
                        setNewProvider(provider)
                        const config = PROVIDERS.find(p => p.value === provider)
                        if (config) setNewModel(config.models[0])
                      }}
                      options={PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
                      className="bg-gray-700 border-gray-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model" className="text-gray-200">Model</Label>
                    <Select
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      options={selectedProviderConfig?.models.map(m => ({ value: m, label: m })) || []}
                      className="bg-gray-700 border-gray-600"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiKey" className="text-gray-200">API Key</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="sk-..."
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white"
                    required
                  />
                  <p className="text-xs text-gray-500">
                    Your API key is encrypted and stored securely
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Add Provider
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowAddForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {providers.length === 0 ? (
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-8 text-center">
              <p className="text-gray-400 mb-4">
                No AI providers configured. Add your API key to use AI features.
              </p>
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {providers.map((provider) => (
              <Card key={provider.id} className="bg-gray-800/50 border-gray-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-white">
                            {PROVIDERS.find(p => p.value === provider.provider)?.label || provider.provider}
                          </h3>
                          {provider.is_default && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">
                              <Star className="h-3 w-3 mr-1" />
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-400">{provider.model_name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {testResult?.id === provider.id && (
                        <span className={`text-sm ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                          {testResult.success ? <Check className="h-4 w-4 inline mr-1" /> : <X className="h-4 w-4 inline mr-1" />}
                          {testResult.message}
                        </span>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestProvider(provider.id)}
                        disabled={testingId === provider.id}
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
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteProvider(provider.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-8">
          <Button variant="outline" onClick={() => router.push('/ai')}>
            Back to AI Assistant
          </Button>
        </div>
      </main>
    </div>
  )
}
