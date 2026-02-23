# =============================================================================
# Multi-stage Dockerfile for pyAgloGen3D Backend
# Builds Rust engine (aglogen_core) + Django application
# Optimized for Fly.io deployment
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Rust engine (aglogen_core)
# -----------------------------------------------------------------------------
FROM rust:1.80-slim-bookworm AS rust-builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-dev \
    python3-pip \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install maturin for building Python wheels from Rust
RUN pip3 install --break-system-packages maturin==1.4.0

WORKDIR /build

# Copy Rust source (from project root context)
COPY aglogen_core ./aglogen_core

# Build the wheel
WORKDIR /build/aglogen_core
RUN maturin build --release --strip

# -----------------------------------------------------------------------------
# Stage 2: Python application
# -----------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS production

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install the Rust wheel from builder stage
COPY --from=rust-builder /build/aglogen_core/target/wheels/*.whl /tmp/
RUN pip install /tmp/*.whl && rm -rf /tmp/*.whl

# Copy backend source code
COPY backend/pyproject.toml ./
COPY backend/README.md ./
COPY backend/config ./config
COPY backend/apps ./apps
COPY backend/manage.py ./

# Install Python dependencies (including dj-database-url for Fly.io)
RUN pip install . dj-database-url==2.1.0

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser \
    && mkdir -p /app/staticfiles \
    && chown -R appuser:appuser /app

# Collect static files (requires SECRET_KEY to be set)
ARG SECRET_KEY=build-time-secret-key
ENV SECRET_KEY=${SECRET_KEY}
ENV DJANGO_SETTINGS_MODULE=config.settings.production
ENV ALLOWED_HOSTS=localhost
RUN python manage.py collectstatic --noinput --clear

# Switch to non-root user
USER appuser

# Expose port (Fly.io uses 8080 by default)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/v1/health/')" || exit 1

# Default command (can be overridden in fly.toml)
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "120", "config.wsgi:application"]
