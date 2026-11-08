'use client'

/**
 * AI assistant (issue #183, migration slice 2).
 *
 * The screen stops mounting the deprecated layout `Header` and its own page
 * frame: `/ai` is not chromeless (`AppShell.isChromeless` is `/` and `/auth/*`
 * only), so the shell already draws the navigation, the width cap and the
 * gutter. A second full-width, padded box padded the page twice and put a
 * second landmark inside the shell's own `<main>`.
 *
 * On the design-system kit: `PageHeader` for the title, the conversation name
 * and the action cluster; `Panel` for the message thread and for the recent
 * simulations rail; `Callout` for a failed request; `EmptyState` for the three
 * empty views; `Num` for Df and Rg; `StatusChip` for a simulation's state.
 *
 * There is no chat primitive in the kit. `DisclosurePanel` collapses a section
 * on demand — the opposite of a transcript that must stay open — and a message
 * list is not a table, so `DataTable` and `DisclosurePanel` both miss. The
 * thread is a `Panel` with a scrolling body, and that is a stated limitation
 * rather than an invented primitive.
 *
 * Nothing below the presentation moved — the same API calls, the same
 * messages, the same permission gate and the same conversation/notification
 * handling.
 */
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Callout } from '@/components/kit/Callout'
import { EmptyState } from '@/components/kit/EmptyState'
import { Num } from '@/components/kit/Num'
import { PageHeader } from '@/components/kit/PageHeader'
import { Panel } from '@/components/kit/Panel'
import { StatusChip } from '@/components/kit/StatusChip'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
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
import { getScaleFactorNm } from '@/lib/units'
import { cn } from '@/lib/utils'
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
  Bell,
  History,
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

/** The states the backend uses; `RecentSimulation.status` is typed as string. */
const SIMULATION_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const
type KnownStatus = (typeof SIMULATION_STATUSES)[number]

/**
 * `StatusChip` takes the `SimulationStatus` union, and the recent-simulations
 * endpoint returns a bare string. Narrow it so a chip is only rendered for a
 * state the product actually has; anything else falls back to its raw word
 * rather than to a chip with no colour.
 */
function asSimulationStatus(value: string): KnownStatus | null {
  return (SIMULATION_STATUSES as readonly string[]).includes(value)
    ? (value as KnownStatus)
    : null
}

const SUGGESTIONS = [
  'What algorithms are available?',
  'Explain DLA vs DLCA',
  'How do I run a simulation?',
]

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

  const hasProviders = providers.length > 0

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* Main Chat Area */}
      <div className="flex min-w-0 max-w-4xl flex-1 flex-col">
        <PageHeader
          eyebrow="AI"
          title="AI Assistant"
          description={conversation?.title || 'New Conversation'}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {projects.length > 0 && (
                <Select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  options={[
                    { value: '', label: 'No project context' },
                    ...projects.map(p => ({ value: p.id, label: p.name })),
                  ]}
                  className="w-48"
                  aria-label="Project context"
                />
              )}

              {/* Notifications Bell */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Notifications"
                  onClick={() => {
                    setShowNotifications(!showNotifications)
                    setShowConversations(false)
                  }}
                >
                  <Bell className="h-4 w-4" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-ink-on-dark">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Button>

                {showNotifications && (
                  <div className="absolute right-0 top-11 z-50 w-80 rounded-lg border border-line bg-surface-strong shadow-panel">
                    <div className="flex items-center justify-between border-b border-line p-3">
                      <span className="font-medium text-ink">Notifications</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          className="text-[12px] text-brand-strong hover:text-ink"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="p-4 text-center text-ink-muted">
                          No notifications
                        </div>
                      ) : (
                        notifications.slice(0, 10).map(notif => (
                          <div
                            key={notif.id}
                            className={cn(
                              'border-b border-line p-3 hover:bg-accent',
                              !notif.is_read && 'bg-brand-soft',
                            )}
                          >
                            <div className="flex items-start gap-2">
                              {notif.notification_type.includes('complete') ? (
                                <CheckCircle className="mt-0.5 h-4 w-4 text-success" aria-hidden="true" />
                              ) : (
                                <XCircle className="mt-0.5 h-4 w-4 text-danger" aria-hidden="true" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium text-ink">{notif.title}</p>
                                <p className="text-[11px] text-ink-muted">{notif.message}</p>
                                <p className="mt-1 text-[11px] text-ink-faint">
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
                  aria-label="Conversations"
                  onClick={() => {
                    setShowConversations(!showConversations)
                    setShowNotifications(false)
                  }}
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                </Button>

                {showConversations && (
                  <div className="absolute right-0 top-11 z-50 w-72 rounded-lg border border-line bg-surface-strong shadow-panel">
                    <div className="flex items-center justify-between border-b border-line p-3">
                      <span className="font-medium text-ink">Conversations</span>
                      <button
                        onClick={startNewConversation}
                        className="flex items-center gap-1 text-[12px] text-brand-strong hover:text-ink"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" /> New
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {conversations.length === 0 ? (
                        <div className="p-4 text-center text-ink-muted">
                          No conversations
                        </div>
                      ) : (
                        conversations.map(conv => (
                          <div
                            key={conv.id}
                            className={cn(
                              'flex cursor-pointer items-center justify-between border-b border-line p-3 hover:bg-accent',
                              conv.id === conversation?.id && 'bg-brand-soft',
                            )}
                            onClick={() => switchConversation(conv.id)}
                          >
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <p className="truncate text-[13px] font-medium text-ink">
                                {conv.title || 'Untitled'}
                              </p>
                              <p className="text-[11px] text-ink-muted">
                                {conv.message_count || 0} messages
                              </p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteConversation(conv.id)
                              }}
                              className="rounded-sm p-1 hover:bg-danger-soft"
                              aria-label={`Delete conversation ${conv.title || 'Untitled'}`}
                            >
                              <Trash2 className="h-3 w-3 text-ink-muted hover:text-danger" aria-hidden="true" />
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
                <Button variant="outline" size="sm" aria-label="AI settings">
                  <Settings className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Link>
            </div>
          }
        />

        {/* A failed request is a state, so it is a `Callout` and keeps `role=alert`. */}
        {error && <Callout tone="danger" title={error} className="mb-4" />}

        {!hasProviders ? (
          <EmptyState
            headingLevel={2}
            icon={Settings}
            title="Configure AI Provider"
            description="Add your API key to start using the AI assistant"
            action={
              <Link href="/ai/settings">
                <Button>
                  <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
                  Go to Settings
                </Button>
              </Link>
            }
          />
        ) : (
          <Panel>
            {/* Messages Area */}
            <div className="flex max-h-[calc(100vh-320px)] min-h-[400px] flex-col gap-4 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-4">
                  <EmptyState
                    headingLevel={2}
                    icon={Bot}
                    title="How can I help you today?"
                    description="Ask me about agglomeration algorithms, run simulations, analyze results, or get help with your studies."
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        {SUGGESTIONS.map((suggestion) => (
                          <button
                            key={suggestion}
                            onClick={() => {
                              setInputValue(suggestion)
                              inputRef.current?.focus()
                            }}
                            className="rounded-lg border border-line bg-surface-soft px-3 py-1.5 text-[12px] text-ink-muted transition-colors hover:bg-accent hover:text-ink"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    }
                  />
                </div>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className="flex gap-3">
                    {/* Avatar */}
                    <div className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      message.role === 'user'
                        ? 'bg-brand text-ink-on-dark'
                        : 'bg-brand-soft text-brand-strong',
                    )}>
                      {message.role === 'user' ? (
                        <User className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Bot className="h-4 w-4" aria-hidden="true" />
                      )}
                    </div>

                    {/* Message Content */}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">
                          {message.role === 'user' ? 'You' : 'AI Assistant'}
                        </span>
                        <span className="text-[11px] text-ink-faint">
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
                                className="overflow-hidden rounded-lg border border-line bg-surface-soft"
                              >
                                <button
                                  onClick={() => toggleToolCallExpanded(message.id, toolCall.id)}
                                  className="flex w-full items-center justify-between p-2 transition-colors hover:bg-accent"
                                >
                                  <div className="flex items-center gap-2">
                                    {toolCall.success ? (
                                      <CheckCircle className="h-4 w-4 text-success" aria-hidden="true" />
                                    ) : (
                                      <XCircle className="h-4 w-4 text-danger" aria-hidden="true" />
                                    )}
                                    <Wrench className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                                    <span className="text-[13px] font-medium text-ink">
                                      {toolCall.name}
                                    </span>
                                  </div>
                                  {isExpanded ? (
                                    <ChevronUp className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                                  )}
                                </button>
                                {isExpanded && (
                                  <div className="space-y-2 border-t border-line p-3">
                                    <div>
                                      <span className="hint">Arguments:</span>
                                      <pre className="mt-1 overflow-x-auto rounded-sm bg-surface-soft p-2 text-[11px] text-ink-muted">
                                        {JSON.stringify(toolCall.arguments, null, 2)}
                                      </pre>
                                    </div>
                                    <div>
                                      <span className="hint">
                                        {toolCall.success ? 'Result:' : 'Error:'}
                                      </span>
                                      <pre className={cn(
                                        'mt-1 overflow-x-auto rounded-sm p-2 text-[11px]',
                                        toolCall.success
                                          ? 'bg-surface-soft text-ink-muted'
                                          : 'bg-danger-soft text-danger',
                                      )}>
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
                      <div className={cn(
                        'whitespace-pre-wrap text-[13px] leading-relaxed',
                        message.role === 'user' ? 'text-ink' : 'text-ink-muted',
                      )}>
                        {message.content}
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Loading indicator */}
              {isSending && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-strong">
                    <Bot className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-ink-muted" aria-hidden="true" />
                    <span className="text-ink-muted">Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex gap-2">
                <Textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything about simulations..."
                  rows={1}
                  className="min-h-0 flex-1 resize-none"
                  disabled={isSending}
                  aria-label="Message"
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isSending}
                  className="h-auto px-4"
                  aria-label="Send message"
                >
                  {isSending ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-5 w-5" aria-hidden="true" />
                  )}
                </Button>
              </div>
              <p className="hint mt-2 text-center">
                Press Enter to send, Shift+Enter for new line
              </p>
            </div>
          </Panel>
        )}
      </div>

      {/* Right Sidebar - Recent Simulations */}
      <aside className="hidden w-80 shrink-0 lg:block">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Activity className="h-4 w-4" aria-hidden="true" />
              Recent Simulations
            </span>
          }
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={loadRecentSimulations}
              disabled={isRefreshingSims}
              className="h-6 w-6 p-0"
              aria-label="Refresh recent simulations"
            >
              <RefreshCw className={cn('h-3 w-3', isRefreshingSims && 'animate-spin')} aria-hidden="true" />
            </Button>
          }
        >
          {recentSimulations.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title="No recent simulations"
              description="Simulations you run will appear here with their fractal dimension and radius of gyration."
            />
          ) : (
            <div className="max-h-[calc(100vh-300px)] space-y-2 overflow-y-auto">
              {recentSimulations.map(sim => {
                const status = asSimulationStatus(sim.status)
                // The backend does not expose parameters on this endpoint yet
                // (see RecentSimulation), so Rg is shown as the dimensionless
                // engine value unless parameters arrive; scaling it with the
                // default diameter would silently print a wrong number.
                const hasParams =
                  sim.parameters !== undefined && sim.parameters !== null
                const scale = hasParams
                  ? getScaleFactorNm(sim.parameters as Record<string, unknown>)
                  : null
                return (
                  <div
                    key={sim.id}
                    className="cursor-pointer rounded-lg border border-line bg-surface-soft p-2 hover:bg-accent"
                    onClick={() => {
                      const prompt = `Check the status of simulation ${sim.id} (${sim.name})`
                      setInputValue(prompt)
                      inputRef.current?.focus()
                    }}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">
                        {sim.name}
                      </span>
                      {status ? (
                        <StatusChip status={status} />
                      ) : (
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-ink-muted">
                          {sim.status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                      <span>{sim.algorithm}</span>
                      {sim.n_particles && (
                        <span className="inline-flex items-baseline gap-[0.28em]">
                          <Num value={sim.n_particles} digits={0} size="sm" />p
                        </span>
                      )}
                    </div>
                    {sim.metrics && sim.status === 'completed' && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
                        {sim.metrics?.fractal_dimension && (
                          <span className="inline-flex items-baseline gap-1">
                            Df: <Num value={sim.metrics.fractal_dimension} digits={2} size="sm" />
                          </span>
                        )}
                        {sim.metrics?.radius_of_gyration != null && (
                          <span className="inline-flex items-baseline gap-1">
                            Rg:{' '}
                            {scale !== null ? (
                              <Num
                                value={sim.metrics.radius_of_gyration * scale}
                                unit="nm"
                                digits={1}
                                size="sm"
                              />
                            ) : (
                              <>
                                <Num value={sim.metrics.radius_of_gyration} digits={2} size="sm" />
                                <span className="text-ink-faint">(engine)</span>
                              </>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-ink-faint">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {new Date(sim.created_at).toLocaleString()}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </aside>
    </div>
  )
}
