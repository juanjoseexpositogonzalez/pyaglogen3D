# Theory: AI Chat UX Patterns

Designing an effective chat interface for research workflows.

---

## Chat Interface Anatomy

```
┌─────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Conversation Header                       │   │
│  │  "DLA Parameter Study" [Edit] [Archive] [Provider: Claude]   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │  Message Area (Scrollable)                                  │   │
│  │                                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐   │   │
│  │  │ 👤 User                                              │   │   │
│  │  │ Run a DLA simulation with 1000 particles             │   │   │
│  │  └─────────────────────────────────────────────────────┘   │   │
│  │                                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐   │   │
│  │  │ 🤖 Assistant                                         │   │   │
│  │  │ ┌─────────────────────────────────────────────────┐ │   │   │
│  │  │ │ 🔧 Executing: run_dla_simulation                 │ │   │   │
│  │  │ │ n_particles: 1000                               │ │   │   │
│  │  │ └─────────────────────────────────────────────────┘ │   │   │
│  │  │ I've started a DLA simulation with 1000 particles.  │   │   │
│  │  │ Simulation ID: 456                                   │   │   │
│  │  └─────────────────────────────────────────────────────┘   │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      Input Area                              │   │
│  │  ┌───────────────────────────────────────────────┐  [Send]  │   │
│  │  │ Type a message...                              │         │   │
│  │  └───────────────────────────────────────────────┘          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Hierarchy

```
ChatPage
├── ConversationSidebar
│   ├── NewChatButton
│   └── ConversationList
│       └── ConversationItem (map)
│
├── ChatContainer
│   ├── ChatHeader
│   │   ├── ConversationTitle
│   │   ├── ProviderBadge
│   │   └── ConversationActions
│   │
│   ├── MessageArea
│   │   └── MessageBubble (map)
│   │       ├── UserMessage
│   │       └── AssistantMessage
│   │           └── ToolExecution (if tool_calls)
│   │
│   └── ChatInput
│       ├── TextArea
│       └── SendButton
│
└── LoadingOverlay (when waiting)
```

---

## State Management

### Zustand Store

```typescript
interface ChatState {
    // Current conversation
    currentConversation: Conversation | null;
    messages: Message[];

    // Conversations list
    conversations: Conversation[];

    // UI state
    isLoading: boolean;
    isSending: boolean;
    error: string | null;

    // Actions
    setCurrentConversation: (conv: Conversation) => void;
    addMessage: (msg: Message) => void;
    updateMessage: (id: string, updates: Partial<Message>) => void;
    sendMessage: (content: string) => Promise<void>;
    createConversation: (projectId?: string) => Promise<Conversation>;
    loadConversations: () => Promise<void>;
}
```

### React Query Integration

```typescript
// Fetch conversations
const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.getConversations(),
});

// Fetch messages for current conversation
const { data: messages } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => api.getMessages(conversationId),
    enabled: !!conversationId,
});

// Send message mutation
const sendMutation = useMutation({
    mutationFn: (content: string) =>
        api.sendMessage(conversationId, content),
    onSuccess: (response) => {
        queryClient.invalidateQueries(['messages', conversationId]);
    },
});
```

---

## Message Display Patterns

### User Message

```tsx
function UserMessage({ message }: { message: Message }) {
    return (
        <div className="flex justify-end mb-4">
            <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[80%]">
                <Markdown>{message.content}</Markdown>
            </div>
        </div>
    );
}
```

### Assistant Message

```tsx
function AssistantMessage({ message }: { message: Message }) {
    return (
        <div className="flex justify-start mb-4">
            <div className="bg-muted rounded-lg px-4 py-2 max-w-[80%]">
                {message.tool_calls && (
                    <ToolExecutionDisplay tools={message.tool_calls} />
                )}
                {message.content && (
                    <Markdown>{message.content}</Markdown>
                )}
            </div>
        </div>
    );
}
```

### Tool Execution Display

```tsx
function ToolExecutionDisplay({ tools }: { tools: ToolCall[] }) {
    return (
        <div className="border rounded-md p-2 mb-2 bg-background/50">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Wrench className="h-4 w-4" />
                <span>Executed: {tools.map(t => t.name).join(', ')}</span>
            </div>
            {tools.map(tool => (
                <div key={tool.id} className="text-xs mt-1">
                    <code>{JSON.stringify(tool.arguments)}</code>
                </div>
            ))}
        </div>
    );
}
```

---

## Loading States

### Thinking Indicator

```tsx
function ThinkingIndicator() {
    return (
        <div className="flex justify-start mb-4">
            <div className="bg-muted rounded-lg px-4 py-2">
                <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-muted-foreground">Thinking...</span>
                </div>
            </div>
        </div>
    );
}
```

### Tool Execution Progress

```tsx
function ToolProgressIndicator({ toolName }: { toolName: string }) {
    return (
        <div className="flex justify-start mb-4">
            <div className="bg-muted rounded-lg px-4 py-2">
                <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 animate-pulse" />
                    <span>Running: {toolName}...</span>
                </div>
            </div>
        </div>
    );
}
```

---

## Input Handling

### Chat Input Component

```tsx
function ChatInput({ onSend, disabled }: Props) {
    const [content, setContent] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleSubmit = () => {
        if (!content.trim() || disabled) return;
        onSend(content);
        setContent('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height =
                textareaRef.current.scrollHeight + 'px';
        }
    }, [content]);

    return (
        <div className="flex gap-2 p-4 border-t">
            <Textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                disabled={disabled}
                rows={1}
                className="resize-none"
            />
            <Button onClick={handleSubmit} disabled={!content.trim() || disabled}>
                <Send className="h-4 w-4" />
            </Button>
        </div>
    );
}
```

---

## Conversation Sidebar

```tsx
function ConversationSidebar() {
    const { conversations, currentConversation, setCurrentConversation } =
        useChatStore();

    return (
        <div className="w-64 border-r h-full flex flex-col">
            <div className="p-4">
                <Button onClick={createNewConversation} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    New Chat
                </Button>
            </div>

            <ScrollArea className="flex-1">
                {conversations.map((conv) => (
                    <button
                        key={conv.id}
                        onClick={() => setCurrentConversation(conv)}
                        className={cn(
                            "w-full p-3 text-left hover:bg-muted",
                            currentConversation?.id === conv.id && "bg-muted"
                        )}
                    >
                        <div className="font-medium truncate">
                            {conv.title || "New conversation"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {formatDate(conv.updated_at)}
                        </div>
                    </button>
                ))}
            </ScrollArea>
        </div>
    );
}
```

---

## Markdown Rendering

### Supported Elements

For research chat:
- **Headers**: Section organization
- **Code blocks**: Simulation parameters, JSON results
- **Tables**: Data comparison
- **Math**: LaTeX equations (via KaTeX)
- **Links**: References, downloads

### Implementation

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

function Markdown({ children }: { children: string }) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
                code({ node, inline, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    return !inline && match ? (
                        <SyntaxHighlighter language={match[1]}>
                            {String(children)}
                        </SyntaxHighlighter>
                    ) : (
                        <code className={className} {...props}>
                            {children}
                        </code>
                    );
                },
            }}
        >
            {children}
        </ReactMarkdown>
    );
}
```

---

## Scroll Behavior

### Auto-scroll to Bottom

```tsx
function MessageArea({ messages }: Props) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);

    // Auto-scroll on new messages
    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, autoScroll]);

    // Detect manual scroll
    const handleScroll = (e: React.UIEvent) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
        setAutoScroll(isAtBottom);
    };

    return (
        <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4"
        >
            {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
            ))}
        </div>
    );
}
```

---

## Error Handling

### Error Display

```tsx
function ErrorMessage({ error, onRetry }: Props) {
    return (
        <div className="flex justify-center my-4">
            <div className="bg-destructive/10 border border-destructive rounded-lg px-4 py-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className="text-destructive">{error}</span>
                <Button variant="ghost" size="sm" onClick={onRetry}>
                    Retry
                </Button>
            </div>
        </div>
    );
}
```

### Offline Indicator

```tsx
function OfflineIndicator() {
    const isOnline = useNetworkStatus();

    if (isOnline) return null;

    return (
        <div className="bg-yellow-100 text-yellow-800 px-4 py-2 text-center text-sm">
            You're offline. Messages will be sent when connection is restored.
        </div>
    );
}
```

---

## Accessibility

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Enter | Send message |
| Shift+Enter | New line |
| Escape | Close sidebar / Cancel |
| Ctrl+N | New conversation |
| Up/Down | Navigate conversation history |

### Screen Reader Support

```tsx
<div role="log" aria-live="polite" aria-label="Chat messages">
    {messages.map((msg) => (
        <div
            key={msg.id}
            role="article"
            aria-label={`${msg.role === 'user' ? 'You' : 'Assistant'} said`}
        >
            {msg.content}
        </div>
    ))}
</div>
```

---

## Responsive Design

### Mobile Layout

```tsx
function ChatPage() {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <div className="flex h-screen">
            {/* Sidebar - hidden on mobile */}
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetContent side="left" className="p-0">
                    <ConversationSidebar />
                </SheetContent>
            </Sheet>

            {/* Desktop sidebar */}
            <div className="hidden md:block">
                <ConversationSidebar />
            </div>

            {/* Main chat area */}
            <div className="flex-1 flex flex-col">
                <ChatHeader onMenuClick={() => setSidebarOpen(true)} />
                <MessageArea />
                <ChatInput />
            </div>
        </div>
    );
}
```

---

## Key Takeaways

1. **Clear visual hierarchy**: User vs assistant messages
2. **Tool transparency**: Show what tools executed
3. **Loading states**: Indicate thinking and execution
4. **Markdown support**: Rich content rendering
5. **Auto-scroll**: Keep newest messages visible
6. **Error recovery**: Allow retry on failures
7. **Accessibility**: Keyboard nav and screen readers
8. **Responsive**: Mobile-friendly layout

---

## Further Reading

- [Shadcn UI Components](https://ui.shadcn.com/)
- [React Query for Server State](https://tanstack.com/query/latest)
- [Zustand State Management](https://zustand-demo.pmnd.rs/)
- [WAI-ARIA Chat Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialogmodal/)
