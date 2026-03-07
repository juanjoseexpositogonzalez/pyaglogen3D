# Postgres 17 with pgvector extension for Fly.io
# Based on flyio/postgres-flex with pgvector installed

FROM flyio/postgres-flex:17.2

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git \
        build-essential \
        postgresql-server-dev-17 && \
    rm -rf /var/lib/apt/lists/*

# Install pgvector
WORKDIR /tmp
RUN git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git && \
    cd pgvector && \
    make && \
    make install && \
    cd .. && \
    rm -rf pgvector

# Clean up build dependencies to reduce image size
RUN apt-get purge -y --auto-remove \
        git \
        build-essential \
        postgresql-server-dev-17 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /
