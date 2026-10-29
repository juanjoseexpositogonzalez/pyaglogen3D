# Theory: Role-Based Access Control

Restricting AI features to authorized users.

---

## Access Control Requirements

```
┌─────────────────────────────────────────────────────────────────────┐
│                    User Access Levels                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Level 1: Regular Users                                             │
│  ├── Can use simulation features                                    │
│  ├── Can view their projects                                        │
│  └── NO access to AI features ❌                                    │
│                                                                     │
│  Level 2: Designated Users                                          │
│  ├── All Level 1 permissions                                        │
│  ├── Can use AI chat ✓                                              │
│  ├── Can execute tools via AI ✓                                     │
│  └── Can search knowledge base ✓                                    │
│                                                                     │
│  Level 3: Admin Users                                               │
│  ├── All Level 2 permissions                                        │
│  ├── Can manage RAG knowledge base ✓                                │
│  ├── Can designate users for AI access ✓                            │
│  └── Can view all conversations ✓                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Approach

### User Model Extension

```python
# apps/accounts/models.py

class User(AbstractUser):
    # Existing fields...

    # New field for AI access
    has_ai_access = models.BooleanField(
        default=False,
        help_text="User can access AI features"
    )

    @property
    def can_use_ai(self) -> bool:
        """Check if user can use AI features."""
        return self.is_staff or self.has_ai_access

    @property
    def can_manage_rag(self) -> bool:
        """Check if user can manage RAG knowledge base."""
        return self.is_staff
```

### Permission Classes

```python
# apps/ai_assistant/permissions.py

from rest_framework.permissions import BasePermission

class IsAIUser(BasePermission):
    """
    Allow access to users with AI permissions.
    """
    message = "AI features are not enabled for your account."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated and
            request.user.can_use_ai
        )


class IsRAGAdmin(BasePermission):
    """
    Allow access to users who can manage RAG.
    """
    message = "RAG management requires admin privileges."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated and
            request.user.can_manage_rag
        )
```

---

## Applying Permissions

### View-Level

```python
# apps/ai_assistant/views.py

class ConversationViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsAIUser]

    def get_queryset(self):
        # Users can only see their own conversations
        return Conversation.objects.filter(user=self.request.user)


class ChatView(APIView):
    permission_classes = [IsAuthenticated, IsAIUser]

    def post(self, request, pk):
        # Only AI users can chat
        ...
```

### Tool-Level

```python
# apps/ai_assistant/tools/executor.py

class ToolExecutor:
    def execute(self, tool_name: str, arguments: dict) -> ToolResult:
        # Check tool permissions
        tool = self.registry.get_tool(tool_name)

        if tool.requires_admin and not self.user.is_staff:
            return ToolResult(
                success=False,
                error=ToolError(
                    error_type="PermissionDenied",
                    message="This tool requires admin privileges"
                )
            )

        # Proceed with execution
        ...
```

---

## Frontend Access Control

### API Response

```json
{
    "user": {
        "id": "uuid",
        "email": "user@example.com",
        "can_use_ai": true,
        "can_manage_rag": false
    }
}
```

### Protected Routes

```tsx
// src/app/ai-assistant/layout.tsx

export default function AIAssistantLayout({
    children
}: {
    children: React.ReactNode
}) {
    const { user } = useAuth();

    if (!user?.can_use_ai) {
        redirect('/dashboard');
    }

    return <>{children}</>;
}
```

### Conditional Navigation

```tsx
// src/components/layout/Header.tsx

function NavLinks() {
    const { user } = useAuth();

    return (
        <nav>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/projects">Projects</Link>

            {user?.can_use_ai && (
                <Link href="/ai-assistant">AI Assistant</Link>
            )}

            {user?.can_manage_rag && (
                <Link href="/admin/rag">Knowledge Base</Link>
            )}
        </nav>
    );
}
```

---

## Admin User Management

### Designation Endpoint

```python
# apps/accounts/views.py

class UserViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsAdminUser]

    @action(detail=True, methods=['post'])
    def grant_ai_access(self, request, pk=None):
        user = self.get_object()
        user.has_ai_access = True
        user.save()
        return Response({"status": "AI access granted"})

    @action(detail=True, methods=['post'])
    def revoke_ai_access(self, request, pk=None):
        user = self.get_object()
        user.has_ai_access = False
        user.save()
        return Response({"status": "AI access revoked"})
```

### Admin UI

```tsx
function UserManagement() {
    const { data: users } = useUsers();

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>AI Access</TableHead>
                    <TableHead>Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {users?.map(user => (
                    <TableRow key={user.id}>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                            <Switch
                                checked={user.has_ai_access}
                                onCheckedChange={(checked) =>
                                    toggleAIAccess(user.id, checked)
                                }
                            />
                        </TableCell>
                        <TableCell>
                            <Button variant="ghost">Edit</Button>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
```

---

## Audit Logging

Track access for compliance:

```python
# apps/ai_assistant/middleware.py

class AIAccessLogger:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        # Log AI feature access
        if request.path.startswith('/api/v1/ai/'):
            AIAccessLog.objects.create(
                user=request.user if request.user.is_authenticated else None,
                path=request.path,
                method=request.method,
                status_code=response.status_code,
                ip_address=get_client_ip(request)
            )

        return response
```

---

## Error Handling

### Graceful Denial

```python
class IsAIUser(BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        if not request.user.can_use_ai:
            # Could log attempt
            logger.info(f"AI access denied for user {request.user.id}")
            return False

        return True
```

### Frontend Error Display

```tsx
function AIAccessDenied() {
    return (
        <Card className="max-w-md mx-auto mt-20">
            <CardHeader>
                <CardTitle>AI Features Not Available</CardTitle>
            </CardHeader>
            <CardContent>
                <p>
                    Your account does not have access to AI features.
                    Please contact an administrator if you need access.
                </p>
            </CardContent>
            <CardFooter>
                <Button onClick={() => router.push('/dashboard')}>
                    Return to Dashboard
                </Button>
            </CardFooter>
        </Card>
    );
}
```

---

## Key Takeaways

1. **Simple model**: `has_ai_access` boolean + `is_staff` for admin
2. **Permission classes**: Reusable across views
3. **Frontend guards**: Protect routes and hide UI
4. **Admin management**: Easy toggle for user access
5. **Audit logging**: Track who uses AI features
6. **Graceful errors**: Clear messaging when denied

---

## Further Reading

- [DRF Permissions](https://www.django-rest-framework.org/api-guide/permissions/)
- [Django User Model Extension](https://docs.djangoproject.com/en/4.2/topics/auth/customizing/)
