'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  aiApi,
  type AIProvider,
  type ChatMessage,
  type ToolCallInfo,
  type Conversation,
  type Notification,
  type RecentSimulation,
} from '@/lib/ai-api'
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
  Bell,
  History,
  MessageSquare,
  Trash2,
  Plus,
  Activity,
  Clock,
  RefreshCw,
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

  // State
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

  // Conversation state
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [showConversations, setShowConversations] = useState(false)

  // Notifications state
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)

  // Recent simulations state
  const [recentSimulations, setRecentSimulations] = useState<RecentSimulation[]>([])
  const [showRecentSims, setShowRecentSims] = useState(false)
  const [isRefreshingSims, setIsRefreshingSims] = useState(false)

  // Auth redirect
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login')
    }
  }, [user, authLoading, router])

  // Initial load
  useEffect(() => {
    checkAccessAndLoadData()
  }, [])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Poll for notifications every 30 seconds
  useEffect(() => {
    if (!hasAccess) return
    const interval = setInterval(loadNotifications, 30000)
    return () => clearInterval(interval)
  }, [hasAccess])

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

      // Load conversations and notifications
      await Promise.all([
        loadActiveConversation(),
        loadConversations(),
        loadNotifications(),
        loadRecentSimulations(),
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  async function loadActiveConversation() {
    try {
      const conv = await aiApi.getActiveConversation()
      setConversation(conv)
      // Convert stored messages to display messages
      if (conv.messages && conv.messages.length > 0) {
        const displayMessages: DisplayMessage[] = conv.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            toolCalls: m.tool_calls,
            timestamp: new Date(m.created_at),
          }))
        setMessages(displayMessages)
      }
    } catch (err) {
      console.error('Failed to load active conversation:', err)
    }
  }

  async function loadConversations() {
    try {
      const res = await aiApi.listConversations()
      setConversations(res.results || [])
    } catch (err) {
      console.error('Failed to load conversations:', err)
    }
  }

  async function loadNotifications() {
    try {
      const [notifRes, countRes] = await Promise.all([
        aiApi.listNotifications(),
        aiApi.getUnreadCount(),
      ])
      setNotifications(notifRes.results || [])
      setUnreadCount(countRes.count)
    } catch (err) {
      console.error('Failed to load notifications:', err)
    }
  }

  async function loadRecentSimulations() {
    try {
      setIsRefreshingSims(true)
      const res = await aiApi.getRecentSimulations()
      setRecentSimulations(res.simulations || [])
    } catch (err) {
      console.error('Failed to load recent simulations:', err)
    } finally {
      setIsRefreshingSims(false)
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

      // Save messages to conversation
      if (conversation) {
        try {
          await aiApi.addMessage(conversation.id, {
            role: 'user',
            content,
          })
          await aiApi.addMessage(conversation.id, {
            role: 'assistant',
            content: response.message,
            tool_calls: response.tool_calls,
            token_usage: response.usage,
          })

          // Update conversation title if it's the first message
          if (messages.length === 0) {
            const title = content.slice(0, 50) + (content.length > 50 ? '...' : '')
            setConversation(prev => prev ? { ...prev, title } : null)
          }
        } catch (err) {
          console.error('Failed to save messages:', err)
        }
      }

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

  async function clearChat() {
    if (conversation) {
      try {
        await aiApi.clearConversation(conversation.id)
      } catch (err) {
        console.error('Failed to clear conversation:', err)
      }
    }
    setMessages([])
    setError(null)
  }

  async function startNewConversation() {
    try {
      const conv = await aiApi.createConversation({ title: 'New Conversation' })
      await aiApi.setActiveConversation(conv.id)
      setConversation(conv)
      setMessages([])
      setShowConversations(false)
      await loadConversations()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create conversation')
    }
  }

  async function switchConversation(convId: string) {
    try {
      await aiApi.setActiveConversation(convId)
      const conv = await aiApi.getConversation(convId)
      setConversation(conv)
      // Convert stored messages to display messages
      if (conv.messages && conv.messages.length > 0) {
        const displayMessages: DisplayMessage[] = conv.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            toolCalls: m.tool_calls,
            timestamp: new Date(m.created_at),
          }))
        setMessages(displayMessages)
      } else {
        setMessages([])
      }
      setShowConversations(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch conversation')
    }
  }

  async function deleteConversation(convId: string) {
    try {
      await aiApi.deleteConversation(convId)
      if (conversation?.id === convId) {
        await startNewConversation()
      } else {
        await loadConversations()
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err)
    }
  }

  async function markAllRead() {
    try {
      await aiApi.markAllNotificationsRead()
      setUnreadCount(0)
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    } catch (err) {
      console.error('Failed to mark notifications as read:', err)
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'completed': return 'text-green-400'
      case 'running': return 'text-yellow-400'
      case 'pending': return 'text-blue-400'
      case 'failed': return 'text-red-400'
      default: return 'text-gray-400'
    }
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

      <main className="flex-1 container mx-auto px-4 py-4 flex gap-4">
        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col max-w-4xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">AI Assistant</h1>
                <p className="text-sm text-gray-400">
                  {conversation?.title || 'New Conversation'}
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

              {/* Notifications Bell */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowNotifications(!showNotifications)
                    setShowConversations(false)
                    setShowRecentSims(false)
                  }}
                  className="relative"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 rounded-full text-xs text-white flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Button>

                {showNotifications && (
                  <div className="absolute right-0 top-10 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50">
                    <div className="p-3 border-b border-gray-700 flex items-center justify-between">
                      <span className="font-medium text-white">Notifications</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="p-4 text-center text-gray-400">
                          No notifications
                        </div>
                      ) : (
                        notifications.slice(0, 10).map(notif => (
                          <div
                            key={notif.id}
                            className={`p-3 border-b border-gray-700 hover:bg-gray-700/50 ${
                              !notif.is_read ? 'bg-blue-900/20' : ''
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {notif.notification_type.includes('complete') ? (
                                <CheckCircle className="h-4 w-4 text-green-400 mt-0.5" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-400 mt-0.5" />
                              )}
                              <div className="flex-1">
                                <p className="text-sm font-medium text-white">{notif.title}</p>
                                <p className="text-xs text-gray-400">{notif.message}</p>
                                <p className="text-xs text-gray-500 mt-1">
                                  {new Date(notif.created_at).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Conversations */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowConversations(!showConversations)
                    setShowNotifications(false)
                    setShowRecentSims(false)
                  }}
                >
                  <History className="h-4 w-4" />
                </Button>

                {showConversations && (
                  <div className="absolute right-0 top-10 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50">
                    <div className="p-3 border-b border-gray-700 flex items-center justify-between">
                      <span className="font-medium text-white">Conversations</span>
                      <button
                        onClick={startNewConversation}
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        <Plus className="h-3 w-3" /> New
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {conversations.length === 0 ? (
                        <div className="p-4 text-center text-gray-400">
                          No conversations
                        </div>
                      ) : (
                        conversations.map(conv => (
                          <div
                            key={conv.id}
                            className={`p-3 border-b border-gray-700 hover:bg-gray-700/50 cursor-pointer flex items-center justify-between ${
                              conv.id === conversation?.id ? 'bg-blue-900/20' : ''
                            }`}
                            onClick={() => switchConversation(conv.id)}
                          >
                            <div className="flex-1 overflow-hidden">
                              <p className="text-sm font-medium text-white truncate">
                                {conv.title || 'Untitled'}
                              </p>
                              <p className="text-xs text-gray-400">
                                {conv.message_count || 0} messages
                              </p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteConversation(conv.id)
                              }}
                              className="p-1 hover:bg-red-500/20 rounded"
                            >
                              <Trash2 className="h-3 w-3 text-gray-400 hover:text-red-400" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

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

                        {/* Tool Calls */}
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
        </div>

        {/* Right Sidebar - Recent Simulations */}
        <div className="w-80 hidden lg:block">
          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Recent Simulations
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadRecentSimulations}
                  disabled={isRefreshingSims}
                  className="h-6 w-6 p-0"
                >
                  <RefreshCw className={`h-3 w-3 ${isRefreshingSims ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-2">
              {recentSimulations.length === 0 ? (
                <div className="p-4 text-center text-gray-400 text-sm">
                  No recent simulations
                </div>
              ) : (
                <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto">
                  {recentSimulations.map(sim => (
                    <div
                      key={sim.id}
                      className="p-2 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 cursor-pointer"
                      onClick={() => {
                        const prompt = `Check the status of simulation ${sim.id} (${sim.name})`
                        setInputValue(prompt)
                        inputRef.current?.focus()
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-white truncate">
                          {sim.name}
                        </span>
                        <span className={`text-xs ${getStatusColor(sim.status)}`}>
                          {sim.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>{sim.algorithm}</span>
                        {sim.n_particles && <span>{sim.n_particles}p</span>}
                      </div>
                      {sim.metrics && sim.status === 'completed' && (
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                          {sim.metrics.fractal_dimension && (
                            <span>Df: {sim.metrics.fractal_dimension.toFixed(2)}</span>
                          )}
                          {sim.metrics.radius_of_gyration && (
                            <span>Rg: {sim.metrics.radius_of_gyration.toFixed(1)}</span>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                        <Clock className="h-3 w-3" />
                        {new Date(sim.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
