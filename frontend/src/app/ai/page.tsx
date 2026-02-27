'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { aiApi, type AITool, type AIProvider, type ToolExecutionResult } from '@/lib/ai-api'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2, Send, Settings, Wrench, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react'

interface ToolExecution {
  id: string
  tool: AITool
  args: Record<string, unknown>
  result?: ToolExecutionResult
  isExecuting: boolean
  timestamp: Date
}

export default function AIAssistantPage() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [providers, setProviders] = useState<AIProvider[]>([])
  const [tools, setTools] = useState<AITool[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedTool, setSelectedTool] = useState<AITool | null>(null)
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({})
  const [executions, setExecutions] = useState<ToolExecution[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [executions])

  async function loadData() {
    try {
      setIsLoading(true)
      const [providersRes, toolsRes] = await Promise.all([
        aiApi.listProviders(),
        aiApi.listTools(),
      ])
      setProviders(providersRes.results || [])
      setTools(toolsRes.tools || [])
      setCategories(toolsRes.categories || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  async function loadToolsByCategory(category: string) {
    try {
      const res = await aiApi.listTools(category || undefined)
      setTools(res.tools || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tools')
    }
  }

  function handleCategoryChange(category: string) {
    setSelectedCategory(category)
    setSelectedTool(null)
    setToolArgs({})
    loadToolsByCategory(category)
  }

  function handleToolSelect(tool: AITool) {
    setSelectedTool(tool)
    // Initialize args with empty strings
    const initialArgs: Record<string, string> = {}
    if (tool.parameters && typeof tool.parameters === 'object') {
      const props = (tool.parameters as { properties?: Record<string, unknown> }).properties
      if (props) {
        Object.keys(props).forEach(key => {
          initialArgs[key] = ''
        })
      }
    }
    setToolArgs(initialArgs)
  }

  async function handleExecuteTool() {
    if (!selectedTool) return

    const executionId = Date.now().toString()
    const newExecution: ToolExecution = {
      id: executionId,
      tool: selectedTool,
      args: { ...toolArgs },
      isExecuting: true,
      timestamp: new Date(),
    }

    setExecutions(prev => [...prev, newExecution])
    setError(null)

    try {
      // Parse args - try to convert to appropriate types
      const parsedArgs: Record<string, unknown> = {}
      Object.entries(toolArgs).forEach(([key, value]) => {
        if (value === '') return
        // Try to parse as JSON (for numbers, booleans, arrays, objects)
        try {
          parsedArgs[key] = JSON.parse(value)
        } catch {
          parsedArgs[key] = value
        }
      })

      const result = await aiApi.executeTool(selectedTool.name, parsedArgs)

      setExecutions(prev =>
        prev.map(e =>
          e.id === executionId ? { ...e, result, isExecuting: false } : e
        )
      )
    } catch (err) {
      setExecutions(prev =>
        prev.map(e =>
          e.id === executionId
            ? {
                ...e,
                result: {
                  success: false,
                  tool_name: selectedTool.name,
                  error: {
                    error_type: 'ClientError',
                    message: err instanceof Error ? err.message : 'Execution failed',
                  },
                  execution_time_ms: 0,
                  is_async: false,
                },
                isExecuting: false,
              }
            : e
        )
      )
    }
  }

  function toggleResultExpanded(id: string) {
    setExpandedResults(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function renderParameterInput(key: string, schema: Record<string, unknown>) {
    const type = schema.type as string
    const description = schema.description as string
    const enumValues = schema.enum as string[] | undefined

    if (enumValues) {
      return (
        <Select
          value={toolArgs[key] || ''}
          onChange={(e) => setToolArgs(prev => ({ ...prev, [key]: e.target.value }))}
          options={[
            { value: '', label: `Select ${key}...` },
            ...enumValues.map(v => ({ value: v, label: v })),
          ]}
          className="bg-gray-700 border-gray-600"
        />
      )
    }

    return (
      <Input
        type={type === 'integer' || type === 'number' ? 'number' : 'text'}
        placeholder={description || key}
        value={toolArgs[key] || ''}
        onChange={(e) => setToolArgs(prev => ({ ...prev, [key]: e.target.value }))}
        className="bg-gray-700 border-gray-600 text-white"
      />
    )
  }

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

  const hasProviders = providers.length > 0

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">AI Assistant</h1>
            <p className="text-gray-400 mt-1">
              Execute AI tools for simulation and analysis
            </p>
          </div>
          <Link href="/ai/settings">
            <Button variant="outline">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
          </Link>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!hasProviders ? (
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-8 text-center">
              <Settings className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">Configure AI Provider</h3>
              <p className="text-gray-400 mb-4">
                Add your API key to start using the AI assistant
              </p>
              <Link href="/ai/settings">
                <Button>
                  <Settings className="h-4 w-4 mr-2" />
                  Go to Settings
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Tool Selection Panel */}
            <div className="lg:col-span-1 space-y-4">
              <Card className="bg-gray-800/50 border-gray-700">
                <CardContent className="p-4">
                  <h3 className="font-semibold text-white mb-3">Select Tool</h3>

                  <div className="space-y-3">
                    <Select
                      value={selectedCategory}
                      onChange={(e) => handleCategoryChange(e.target.value)}
                      options={[
                        { value: '', label: 'All Categories' },
                        ...categories.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
                      ]}
                      className="bg-gray-700 border-gray-600"
                    />

                    <div className="max-h-[400px] overflow-y-auto space-y-2">
                      {tools.map(tool => (
                        <button
                          key={tool.name}
                          onClick={() => handleToolSelect(tool)}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            selectedTool?.name === tool.name
                              ? 'bg-blue-600/20 border-blue-500 text-white'
                              : 'bg-gray-700/50 border-gray-600 text-gray-300 hover:bg-gray-700'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Wrench className="h-4 w-4 flex-shrink-0" />
                            <span className="font-medium text-sm">{tool.name}</span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{tool.description}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Tool Parameters */}
              {selectedTool && (
                <Card className="bg-gray-800/50 border-gray-700">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-white mb-3">Parameters</h3>
                    <p className="text-sm text-gray-400 mb-4">{selectedTool.description}</p>

                    <div className="space-y-3">
                      {selectedTool.parameters &&
                        typeof selectedTool.parameters === 'object' &&
                        (selectedTool.parameters as { properties?: Record<string, Record<string, unknown>> }).properties &&
                        Object.entries(
                          (selectedTool.parameters as { properties: Record<string, Record<string, unknown>> }).properties
                        ).map(([key, schema]) => {
                          const required = (
                            (selectedTool.parameters as { required?: string[] }).required || []
                          ).includes(key)
                          return (
                            <div key={key} className="space-y-1">
                              <label className="text-sm text-gray-300">
                                {key}
                                {required && <span className="text-red-400 ml-1">*</span>}
                              </label>
                              {renderParameterInput(key, schema)}
                            </div>
                          )
                        })}

                      <Button
                        className="w-full mt-4"
                        onClick={handleExecuteTool}
                        disabled={executions.some(e => e.isExecuting)}
                      >
                        {executions.some(e => e.isExecuting) ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4 mr-2" />
                        )}
                        Execute Tool
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Results Panel */}
            <div className="lg:col-span-2">
              <Card className="bg-gray-800/50 border-gray-700 h-full">
                <CardContent className="p-4">
                  <h3 className="font-semibold text-white mb-3">Results</h3>

                  {executions.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <Wrench className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Select a tool and execute it to see results</p>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[600px] overflow-y-auto">
                      {executions.map(execution => (
                        <div
                          key={execution.id}
                          className="bg-gray-700/50 rounded-lg p-4 border border-gray-600"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {execution.isExecuting ? (
                                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                              ) : execution.result?.success ? (
                                <CheckCircle className="h-4 w-4 text-green-400" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-400" />
                              )}
                              <span className="font-medium text-white">{execution.tool.name}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <Clock className="h-3 w-3" />
                              {execution.timestamp.toLocaleTimeString()}
                              {execution.result && (
                                <span className="ml-2">
                                  {execution.result.execution_time_ms}ms
                                </span>
                              )}
                            </div>
                          </div>

                          {execution.result && (
                            <div>
                              {execution.result.error ? (
                                <div className="text-red-400 text-sm">
                                  <strong>{execution.result.error.error_type}:</strong>{' '}
                                  {execution.result.error.message}
                                </div>
                              ) : (
                                <div>
                                  <button
                                    onClick={() => toggleResultExpanded(execution.id)}
                                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-white"
                                  >
                                    {expandedResults.has(execution.id) ? (
                                      <ChevronUp className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                    {expandedResults.has(execution.id) ? 'Hide' : 'Show'} result
                                  </button>
                                  {expandedResults.has(execution.id) && (
                                    <pre className="mt-2 p-3 bg-gray-800 rounded text-xs text-gray-300 overflow-x-auto">
                                      {JSON.stringify(execution.result.result, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
