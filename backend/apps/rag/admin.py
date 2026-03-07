"""Admin interface for RAG models."""

from django.contrib import admin
from django.utils.html import format_html

from .models import IndexedDocument, DocumentChunk, DocumentStatus
from .tasks import index_scientific_document_task


@admin.register(IndexedDocument)
class IndexedDocumentAdmin(admin.ModelAdmin):
    """Admin for IndexedDocument model."""

    list_display = [
        "title_preview",
        "source_type",
        "status_badge",
        "owner",
        "is_global",
        "chunk_count",
        "created_at",
    ]
    list_filter = ["source_type", "status", "is_global"]
    search_fields = ["title", "abstract", "metadata"]
    readonly_fields = [
        "id",
        "content_hash",
        "indexed_at",
        "created_at",
        "updated_at",
        "chunk_count",
    ]
    ordering = ["-created_at"]

    fieldsets = (
        (None, {
            "fields": ("title", "source_type", "source_id", "status", "error_message")
        }),
        ("Ownership", {
            "fields": ("owner", "is_global")
        }),
        ("Scientific Document Info", {
            "fields": ("authors", "year", "abstract", "url", "file"),
            "classes": ("collapse",),
        }),
        ("Metadata", {
            "fields": ("metadata",),
            "classes": ("collapse",),
        }),
        ("System", {
            "fields": ("id", "content_hash", "indexed_at", "created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )

    actions = ["reindex_selected", "mark_as_pending"]

    def title_preview(self, obj: IndexedDocument) -> str:
        """Truncated title for display."""
        return obj.title[:60] + "..." if len(obj.title) > 60 else obj.title
    title_preview.short_description = "Title"

    def status_badge(self, obj: IndexedDocument) -> str:
        """Colored status badge."""
        colors = {
            DocumentStatus.PENDING: "gray",
            DocumentStatus.PROCESSING: "blue",
            DocumentStatus.READY: "green",
            DocumentStatus.FAILED: "red",
        }
        color = colors.get(obj.status, "gray")
        return format_html(
            '<span style="color: {}; font-weight: bold;">{}</span>',
            color,
            obj.get_status_display(),
        )
    status_badge.short_description = "Status"

    def chunk_count(self, obj: IndexedDocument) -> int:
        """Number of chunks for this document."""
        return obj.chunks.count()
    chunk_count.short_description = "Chunks"

    def reindex_selected(self, request, queryset):
        """Reindex selected documents."""
        count = 0
        for doc in queryset:
            if doc.source_type == "scientific_doc":
                index_scientific_document_task.delay(str(doc.id))
                count += 1
        self.message_user(
            request,
            f"Queued {count} documents for reindexing.",
        )
    reindex_selected.short_description = "Reindex selected documents"

    def mark_as_pending(self, request, queryset):
        """Mark selected documents as pending."""
        count = queryset.update(status=DocumentStatus.PENDING)
        self.message_user(request, f"Marked {count} documents as pending.")
    mark_as_pending.short_description = "Mark as pending"


@admin.register(DocumentChunk)
class DocumentChunkAdmin(admin.ModelAdmin):
    """Admin for DocumentChunk model."""

    list_display = [
        "id",
        "document_title",
        "chunk_index",
        "section",
        "content_preview",
        "has_embedding",
        "created_at",
    ]
    list_filter = ["embedding_model", "document__source_type"]
    search_fields = ["content", "document__title"]
    readonly_fields = ["id", "created_at"]
    raw_id_fields = ["document"]
    ordering = ["document", "chunk_index"]

    def document_title(self, obj: DocumentChunk) -> str:
        """Document title."""
        return obj.document.title[:40] + "..." if len(obj.document.title) > 40 else obj.document.title
    document_title.short_description = "Document"

    def content_preview(self, obj: DocumentChunk) -> str:
        """Truncated content for display."""
        return obj.content[:80] + "..." if len(obj.content) > 80 else obj.content
    content_preview.short_description = "Content"

    def has_embedding(self, obj: DocumentChunk) -> bool:
        """Whether chunk has an embedding."""
        return obj.embedding is not None
    has_embedding.boolean = True
    has_embedding.short_description = "Embedded"
