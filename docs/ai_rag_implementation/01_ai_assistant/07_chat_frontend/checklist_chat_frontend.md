# Checklist: Chat Frontend

**Branch**: `feature/ai-chat-frontend`
**Depends on**: `feature/ai-chat-backend` merged
**Estimated time**: 2 days

---

## Prerequisites

- [ ] `feature/ai-chat-backend` merged to main
- [ ] Chat API endpoints working
- [ ] Shadcn UI components available
- [ ] React Query configured

---

## Frontend Implementation

### Types

- [ ] Add to `src/lib/types.ts`:

```typescript
interface Conversation {
    id: string;
    title: string;
    project_id: string | null;
    provider: string;
    model: string;
    created_at: string;
    updated_at: string;
    message_count: number;
}

interface Message {
    id: string;
    conversation_id: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string | null;
    tool_calls: ToolCall[] | null;
    tool_call_id: string | null;
    created_at: string;
}

interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

interface ChatInput {
    content: string;
}
```

### API Client

- [ ] Add to `src/lib/api.ts`:
  - `getConversations(): Promise<Conversation[]>`
  - `createConversation(data: { project_id?: string }): Promise<Conversation>`
  - `getConversation(id: string): Promise<Conversation>`
  - `deleteConversation(id: string): Promise<void>`
  - `archiveConversation(id: string): Promise<void>`
  - `getMessages(conversationId: string): Promise<Message[]>`
  - `sendMessage(conversationId: string, content: string): Promise<Message>`

### State Management

- [ ] Create `src/stores/chatStore.ts`:
  - Zustand store for chat state
  - State:
    - `currentConversation: Conversation | null`
    - `conversations: Conversation[]`
    - `messages: Message[]`
    - `isLoading: boolean`
    - `isSending: boolean`
    - `error: string | null`
  - Actions:
    - `setCurrentConversation`
    - `loadConversations`
    - `loadMessages`
    - `sendMessage`
    - `createConversation`
    - `deleteConversation`

### Hooks

- [ ] Create `src/hooks/useChat.ts`:
  - `useConversations()` - React Query for conversations list
  - `useConversation(id)` - React Query for single conversation
  - `useMessages(conversationId)` - React Query for messages
  - `useSendMessage()` - Mutation for sending messages
  - `useCreateConversation()` - Mutation for new conversation

### Components

#### Core Chat Components

- [ ] Create `src/components/ai/ChatPage.tsx`:
  - Main page layout
  - Sidebar + main chat area
  - Responsive design

- [ ] Create `src/components/ai/ConversationSidebar.tsx`:
  - New chat button
  - Conversation list
  - Search/filter (optional)

- [ ] Create `src/components/ai/ConversationItem.tsx`:
  - Single conversation in list
  - Title, date, active state
  - Delete action

- [ ] Create `src/components/ai/ChatContainer.tsx`:
  - Holds header, messages, input
  - Manages scroll behavior

- [ ] Create `src/components/ai/ChatHeader.tsx`:
  - Conversation title
  - Provider badge
  - Actions (archive, delete)

#### Message Components

- [ ] Create `src/components/ai/MessageArea.tsx`:
  - Scrollable message container
  - Auto-scroll on new messages
  - Empty state

- [ ] Create `src/components/ai/MessageBubble.tsx`:
  - Routes to UserMessage or AssistantMessage
  - Handles role-based styling

- [ ] Create `src/components/ai/UserMessage.tsx`:
  - Right-aligned bubble
  - User styling

- [ ] Create `src/components/ai/AssistantMessage.tsx`:
  - Left-aligned bubble
  - Tool execution display
  - Markdown rendering

- [ ] Create `src/components/ai/ToolExecution.tsx`:
  - Collapsible tool call display
  - Tool name and arguments
  - Result preview

#### Input Components

- [ ] Create `src/components/ai/ChatInput.tsx`:
  - Auto-resizing textarea
  - Send button
  - Keyboard shortcuts (Enter to send)
  - Disabled state when sending

#### Loading States

- [ ] Create `src/components/ai/ThinkingIndicator.tsx`:
  - Animated dots or spinner
  - "Thinking..." text

- [ ] Create `src/components/ai/ToolProgressIndicator.tsx`:
  - Shows current tool being executed
  - Animated icon

#### Error Components

- [ ] Create `src/components/ai/ErrorMessage.tsx`:
  - Error display with retry button
  - Styled for visibility

### Markdown Rendering

- [ ] Install dependencies:
  ```bash
  pnpm add react-markdown remark-gfm remark-math rehype-katex react-syntax-highlighter
  pnpm add -D @types/react-syntax-highlighter
  ```

- [ ] Create `src/components/ai/Markdown.tsx`:
  - Configure react-markdown
  - Code syntax highlighting
  - Math rendering (KaTeX)
  - Table styling

### Page

- [ ] Create `src/app/ai-assistant/page.tsx`:
  - Route: `/ai-assistant`
  - Uses ChatPage component
  - Protected route (AI users only)

- [ ] Create `src/app/ai-assistant/layout.tsx`:
  - Specific layout for AI pages (optional)

### Navigation

- [ ] Update `src/components/layout/Header.tsx`:
  - Add "AI Assistant" link
  - Show only for users with AI access
  - Icon: Bot or MessageSquare

---

## Styling

- [ ] Ensure glassmorphism matches existing design
- [ ] Message bubbles have appropriate contrast
- [ ] Loading states are visually clear
- [ ] Mobile responsive layout

---

## Accessibility

- [ ] Keyboard navigation:
  - Enter sends message
  - Shift+Enter for new line
  - Escape closes modals

- [ ] Screen reader support:
  - `role="log"` for message area
  - `aria-live` for new messages
  - Proper labels on inputs

- [ ] Focus management:
  - Focus input after sending
  - Focus new conversation after creation

---

## Testing

### Unit Tests

- [ ] Create `src/__tests__/components/ai/`:
  - `ChatInput.test.tsx`:
    - Test input handling
    - Test keyboard shortcuts
    - Test disabled state
  - `MessageBubble.test.tsx`:
    - Test user message rendering
    - Test assistant message rendering
    - Test tool calls display
  - `Markdown.test.tsx`:
    - Test code blocks
    - Test tables
    - Test math rendering

### Integration Tests

- [ ] Create `src/__tests__/integration/chat.test.tsx`:
  - Test conversation creation
  - Test message sending (mocked API)
  - Test conversation switching

### E2E Tests (Optional)

- [ ] Create Playwright tests:
  - Full chat flow
  - Tool execution display
  - Error handling

### Run Tests

- [ ] All tests pass: `pnpm test`
- [ ] Build succeeds: `pnpm build`

---

## Component Summary

| Component | Purpose |
|-----------|---------|
| `ChatPage` | Main page layout |
| `ConversationSidebar` | List of conversations |
| `ConversationItem` | Single conversation in list |
| `ChatContainer` | Main chat area wrapper |
| `ChatHeader` | Title and actions |
| `MessageArea` | Scrollable messages |
| `MessageBubble` | Single message |
| `UserMessage` | User message styling |
| `AssistantMessage` | Assistant message + tools |
| `ToolExecution` | Tool call display |
| `ChatInput` | Message input |
| `ThinkingIndicator` | Loading state |
| `ErrorMessage` | Error display |
| `Markdown` | Rich text rendering |

---

## Manual Testing

- [ ] Start frontend: `pnpm dev`
- [ ] Ensure backend running

- [ ] Test conversation flow:
  - Create new conversation
  - Send message
  - Receive response
  - See tool execution (if applicable)

- [ ] Test conversation management:
  - Switch between conversations
  - Delete conversation
  - Archive conversation

- [ ] Test edge cases:
  - Long messages
  - Code blocks in response
  - Math formulas
  - Error recovery

- [ ] Test responsive:
  - Desktop layout
  - Mobile layout
  - Sidebar toggle

---

## Git

- [ ] Ensure on latest main: `git checkout main && git pull`
- [ ] Create branch: `git checkout -b feature/ai-chat-frontend`
- [ ] Commit types and API client
- [ ] Commit store and hooks
- [ ] Commit components (logical groups)
- [ ] Commit page and navigation
- [ ] Push: `git push -u origin feature/ai-chat-frontend`
- [ ] Create PR to main

---

## Definition of Done

- [ ] All components implemented
- [ ] Chat flow working end-to-end
- [ ] Markdown rendering correct
- [ ] Tool execution visible
- [ ] Loading states implemented
- [ ] Error handling complete
- [ ] Mobile responsive
- [ ] Accessible
- [ ] All tests passing
- [ ] Manual testing successful
- [ ] PR reviewed and approved
- [ ] Merged to main
