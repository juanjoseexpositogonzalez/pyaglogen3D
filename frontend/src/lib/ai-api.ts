/**
 * AI Assistant API client.
 */

import { tokenStorage } from './token-storage'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// Types
export interface AIProvider {
  id: string
  provider: 'anthropic' | 'openai' | 'groq' | 'xai'
  model_name: string
  is_default: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AIProviderCreate {
  provider: 'anthropic' | 'openai' | 'groq' | 'xai'
  api_key: string
  model_name: string
  is_default?: boolean
}

export interface AITool {
  name: string
  description: string
  category: string
  requires_project: boolean
  is_async: boolean
  parameters: Record<string, unknown>
}

export interface ToolsResponse {
  tools: AITool[]
  count: number
  categories: string[]
}

export interface ToolExecutionResult {
  success: boolean
  tool_name: string
  result?: unknown
  error?: {
    error_type: string
    message: string
    details?: Record<string, unknown>
  }
  execution_time_ms: number
  is_async: boolean
  task_id?: string
}

class AIApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AIApiError'
  }
}

async function aiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}/ai${endpoint}`

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  // Add auth header if we have an access token
  const accessToken = tokenStorage.getAccessToken()
  if (accessToken) {
    ;(headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (!response.ok) {
    let data: Record<string, unknown> | undefined
    try {
      data = await response.json()
    } catch {
      // Ignore JSON parse errors
    }
    throw new AIApiError(
      (data?.error as string) || (data?.detail as string) || `Request failed with status ${response.status}`,
      response.status,
      data
    )
  }

  return response.json()
}

export interface AIAccessResponse {
  has_access: boolean
  reason: 'staff' | 'granted' | 'debug_mode' | 'not_granted'
}

// Chat types
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | unknown[]
  tool_call_id?: string
}

export interface ToolCallInfo {
  id: string
  name: string
  arguments: Record<string, unknown>
  success: boolean
  result?: unknown
  error?: string
}

export interface ChatResponse {
  message: string
  tool_calls: ToolCallInfo[]
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

// Conversation types
export interface Conversation {
  id: string
  title: string
  project: string | null
  is_active: boolean
  message_count?: number
  last_message_preview?: string
  messages?: StoredChatMessage[]
  created_at: string
  updated_at: string
}

export interface StoredChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls: ToolCallInfo[]
  token_usage: Record<string, number>
  created_at: string
}

// Notification types
export interface Notification {
  id: string
  notification_type: 'simulation_complete' | 'simulation_failed' | 'study_complete' | 'study_failed' | 'analysis_complete' | 'info'
  notification_type_display: string
  title: string
  message: string
  data: Record<string, unknown>
  is_read: boolean
  created_at: string
}

// Recent simulation type
export interface RecentSimulation {
  id: string
  name: string
  algorithm: string
  status: string
  n_particles: number | null
  project_id: string
  project_name: string
  created_at: string
  completed_at: string | null
  metrics: {
    fractal_dimension: number | null
    radius_of_gyration: number | null
  } | null
}

export const aiApi = {
  // Access Check

  /**
   * Check if the current user has AI access.
   */
  async checkAccess(): Promise<AIAccessResponse> {
    return aiFetch<AIAccessResponse>('/access/')
  },

  // Provider Management

  /**
   * List all AI providers for the current user.
   */
  async listProviders(): Promise<{ results: AIProvider[] }> {
    return aiFetch<{ results: AIProvider[] }>('/providers/')
  },

  /**
   * Create a new AI provider configuration.
   */
  async createProvider(data: AIProviderCreate): Promise<AIProvider> {
    return aiFetch<AIProvider>('/providers/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * Update an AI provider configuration.
   */
  async updateProvider(id: string, data: Partial<AIProviderCreate>): Promise<AIProvider> {
    return aiFetch<AIProvider>(`/providers/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  /**
   * Delete an AI provider configuration.
   */
  async deleteProvider(id: string): Promise<void> {
    await aiFetch(`/providers/${id}/`, {
      method: 'DELETE',
    })
  },

  /**
   * Test connection to an AI provider.
   */
  async testProvider(id: string): Promise<{ success: boolean; message: string; response?: string }> {
    return aiFetch(`/providers/${id}/test_connection/`, {
      method: 'POST',
    })
  },

  /**
   * Set a provider as the default.
   */
  async setDefaultProvider(id: string): Promise<{ message: string }> {
    return aiFetch(`/providers/${id}/set_default/`, {
      method: 'POST',
    })
  },

  // Tools

  /**
   * List all available AI tools.
   */
  async listTools(category?: string): Promise<ToolsResponse> {
    const params = category ? `?category=${encodeURIComponent(category)}` : ''
    return aiFetch<ToolsResponse>(`/tools/${params}`)
  },

  /**
   * Execute an AI tool.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    projectId?: string
  ): Promise<ToolExecutionResult> {
    return aiFetch<ToolExecutionResult>(`/tools/${toolName}/execute/`, {
      method: 'POST',
      body: JSON.stringify({
        arguments: args,
        project_id: projectId,
      }),
    })
  },

  // Chat

  /**
   * Send a chat message to the AI assistant.
   * The AI will automatically use tools as needed to answer.
   */
  async chat(
    messages: ChatMessage[],
    projectId?: string
  ): Promise<ChatResponse> {
    return aiFetch<ChatResponse>('/chat/', {
      method: 'POST',
      body: JSON.stringify({
        messages,
        project_id: projectId,
      }),
    })
  },

  // Conversations

  /**
   * List all conversations for the current user.
   */
  async listConversations(): Promise<{ results: Conversation[] }> {
    return aiFetch<{ results: Conversation[] }>('/conversations/')
  },

  /**
   * Get a specific conversation with all messages.
   */
  async getConversation(id: string): Promise<Conversation> {
    return aiFetch<Conversation>(`/conversations/${id}/`)
  },

  /**
   * Get the active conversation or create one.
   */
  async getActiveConversation(): Promise<Conversation> {
    return aiFetch<Conversation>('/conversations/active/')
  },

  /**
   * Create a new conversation.
   */
  async createConversation(data: { title?: string; project?: string }): Promise<Conversation> {
    return aiFetch<Conversation>('/conversations/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * Add a message to a conversation.
   */
  async addMessage(conversationId: string, message: {
    role: string
    content: string
    tool_call_id?: string
    tool_calls?: ToolCallInfo[]
    token_usage?: Record<string, number>
  }): Promise<StoredChatMessage> {
    return aiFetch<StoredChatMessage>(`/conversations/${conversationId}/add_message/`, {
      method: 'POST',
      body: JSON.stringify(message),
    })
  },

  /**
   * Set a conversation as active.
   */
  async setActiveConversation(id: string): Promise<{ message: string }> {
    return aiFetch<{ message: string }>(`/conversations/${id}/set_active/`, {
      method: 'POST',
    })
  },

  /**
   * Clear all messages from a conversation.
   */
  async clearConversation(id: string): Promise<{ message: string }> {
    return aiFetch<{ message: string }>(`/conversations/${id}/clear/`, {
      method: 'DELETE',
    })
  },

  /**
   * Delete a conversation.
   */
  async deleteConversation(id: string): Promise<void> {
    await aiFetch(`/conversations/${id}/`, {
      method: 'DELETE',
    })
  },

  // Notifications

  /**
   * List all notifications for the current user.
   */
  async listNotifications(): Promise<{ results: Notification[] }> {
    return aiFetch<{ results: Notification[] }>('/notifications/')
  },

  /**
   * Get unread notification count.
   */
  async getUnreadCount(): Promise<{ count: number }> {
    return aiFetch<{ count: number }>('/notifications/unread_count/')
  },

  /**
   * Mark all notifications as read.
   */
  async markAllNotificationsRead(): Promise<{ message: string }> {
    return aiFetch<{ message: string }>('/notifications/mark_all_read/', {
      method: 'POST',
    })
  },

  /**
   * Mark a single notification as read.
   */
  async markNotificationRead(id: string): Promise<{ message: string }> {
    return aiFetch<{ message: string }>(`/notifications/${id}/mark_read/`, {
      method: 'POST',
    })
  },

  /**
   * Delete a notification.
   */
  async deleteNotification(id: string): Promise<void> {
    await aiFetch(`/notifications/${id}/`, {
      method: 'DELETE',
    })
  },

  // Recent Simulations

  /**
   * Get recent simulations for the chat interface.
   */
  async getRecentSimulations(): Promise<{ simulations: RecentSimulation[] }> {
    return aiFetch<{ simulations: RecentSimulation[] }>('/recent-simulations/')
  },
}

export { AIApiError }
