'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { aiApi, type AIProvider, type ChatMessage, type ToolCallInfo } from '@/lib/ai-api'
import { projectsApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import {
  Loader2,
  Send,
  Settings,
  Bot,
  User,
  Wrench,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallInfo[]
  timestamp: Date
}

interface Project {
  id: string
  name: string
}

export default function AIAssistantPage() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [providers, setProviders] = useState<AIProvider[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set())
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    checkAccessAndLoadData()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function checkAccessAndLoadData() {
    try {
      const accessResponse = await aiApi.checkAccess()
      setHasAccess(accessResponse.has_access)
      if (accessResponse.has_access) {
        await loadData()
      } else {
        setIsLoading(false)
      }
    } catch {
      setHasAccess(false)
      setIsLoading(false)
    }
  }

  async function loadData() {
    try {
      setIsLoading(true)
      const [providersRes, projectsRes] = await Promise.all([
        aiApi.listProviders(),
        projectsApi.list(),
      ])
      setProviders(providersRes.results || [])
      setProjects(projectsRes.results || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSendMessage() {
    const content = inputValue.trim()
    if (!content || isSending) return

    setInputValue('')
    setError(null)

    // Add user message to display
    const userMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])

    // Build conversation history for API
    const chatMessages: ChatMessage[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }))
    chatMessages.push({ role: 'user', content })

    try {
      setIsSending(true)

      const response = await aiApi.chat(
        chatMessages,
        selectedProject || undefined
      )

      // Add assistant response
      const assistantMessage: DisplayMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        toolCalls: response.tool_calls.length > 0 ? response.tool_calls : undefined,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMessage])

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
      // Remove the user message on error
      setMessages(prev => prev.filter(m => m.id !== userMessage.id))
      setInputValue(content) // Restore input
    } finally {
      setIsSending(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  function toggleToolCallExpanded(messageId: string, toolId: string) {
    const key = `${messageId}-${toolId}`
    setExpandedToolCalls(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  function clearChat() {
    setMessages([])
    setError(null)
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

  const hasProviders = providers.length > 0

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-4 flex flex-col max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">AI Assistant</h1>
              <p className="text-sm text-gray-400">
                Ask questions about simulations and analysis
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {projects.length > 0 && (
              <Select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                options={[
                  { value: '', label: 'No project context' },
                  ...projects.map(p => ({ value: p.id, label: p.name })),
                ]}
                className="bg-gray-700 border-gray-600 w-48"
              />
            )}
            {messages.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearChat}>
                Clear
              </Button>
            )}
            <Link href="/ai/settings">
              <Button variant="outline" size="sm">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!hasProviders ? (
          <Card className="bg-gray-800/50 border-gray-700 flex-1 flex items-center justify-center">
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
          <>
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto mb-4 space-y-4 min-h-[400px]">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <Bot className="h-16 w-16 text-gray-500 mb-4" />
                  <h3 className="text-lg font-medium text-white mb-2">
                    How can I help you today?
                  </h3>
                  <p className="text-gray-400 max-w-md">
                    Ask me about agglomeration algorithms, run simulations, analyze results, or get help with your studies.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2 justify-center">
                    {[
                      'What algorithms are available?',
                      'Explain DLA vs DLCA',
                      'How do I run a simulation?',
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => {
                          setInputValue(suggestion)
                          inputRef.current?.focus()
                        }}
                        className="px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-sm text-gray-300 rounded-lg border border-gray-600 transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className="flex gap-3">
                    {/* Avatar */}
                    <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                      message.role === 'user'
                        ? 'bg-blue-600'
                        : 'bg-gradient-to-br from-purple-500 to-blue-500'
                    }`}>
                      {message.role === 'user' ? (
                        <User className="h-4 w-4 text-white" />
                      ) : (
                        <Bot className="h-4 w-4 text-white" />
                      )}
                    </div>

                    {/* Message Content */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">
                          {message.role === 'user' ? 'You' : 'AI Assistant'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {message.timestamp.toLocaleTimeString()}
                        </span>
                      </div>

                      {/* Tool Calls (shown before content for assistant) */}
                      {message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0 && (
                        <div className="space-y-2">
                          {message.toolCalls.map((toolCall) => {
                            const key = `${message.id}-${toolCall.id}`
                            const isExpanded = expandedToolCalls.has(key)
                            return (
                              <div
                                key={toolCall.id}
                                className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden"
                              >
                                <button
                                  onClick={() => toggleToolCallExpanded(message.id, toolCall.id)}
                                  className="w-full flex items-center justify-between p-2 hover:bg-gray-700/50 transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    {toolCall.success ? (
                                      <CheckCircle className="h-4 w-4 text-green-400" />
                                    ) : (
                                      <XCircle className="h-4 w-4 text-red-400" />
                                    )}
                                    <Wrench className="h-4 w-4 text-gray-400" />
                                    <span className="text-sm font-medium text-gray-200">
                                      {toolCall.name}
                                    </span>
                                  </div>
                                  {isExpanded ? (
                                    <ChevronUp className="h-4 w-4 text-gray-400" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4 text-gray-400" />
                                  )}
                                </button>
                                {isExpanded && (
                                  <div className="border-t border-gray-700 p-3 space-y-2">
                                    <div>
                                      <span className="text-xs text-gray-500">Arguments:</span>
                                      <pre className="mt-1 text-xs text-gray-300 bg-gray-900/50 rounded p-2 overflow-x-auto">
                                        {JSON.stringify(toolCall.arguments, null, 2)}
                                      </pre>
                                    </div>
                                    <div>
                                      <span className="text-xs text-gray-500">
                                        {toolCall.success ? 'Result:' : 'Error:'}
                                      </span>
                                      <pre className={`mt-1 text-xs rounded p-2 overflow-x-auto ${
                                        toolCall.success
                                          ? 'text-gray-300 bg-gray-900/50'
                                          : 'text-red-300 bg-red-900/20'
                                      }`}>
                                        {toolCall.success
                                          ? JSON.stringify(toolCall.result, null, 2)
                                          : toolCall.error}
                                      </pre>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Text Content */}
                      <div className={`prose prose-invert max-w-none ${
                        message.role === 'user' ? 'text-gray-200' : 'text-gray-300'
                      }`}>
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Loading indicator */}
              {isSending && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    <span className="text-gray-400">Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="border-t border-gray-700 pt-4">
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything about simulations..."
                  rows={1}
                  className="flex-1 resize-none bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  disabled={isSending}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isSending}
                  className="h-auto px-4"
                >
                  {isSending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </Button>
              </div>
              <p className="mt-2 text-xs text-gray-500 text-center">
                Press Enter to send, Shift+Enter for new line
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
