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
}

export { AIApiError }
