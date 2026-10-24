# 0004. Data layer: PostgreSQL + Qdrant + 2× Valkey + S3

- Status: Accepted
- Date: 2026-10-24

## Context

Accuracy and speed of retrieval are non-negotiable: generated questions are only as good as the evidence
found. The content is Hindi + English (plus Hinglish queries), and the item bank, documents and audit trail
need strong relational guarantees. Savings should come from elsewhere, never from the data layer.

## Decision

- **PostgreSQL 17**: the single source of truth for content metadata, item bank, documents and versions,
  chats, auth, pipeline state and the LLM usage ledger.
  - Row-level security by `org_id` is a second line of defence behind RBAC.
  - `pg_trgm` is used only for admin keyword search.
  - No pgvector.
- **Qdrant 1.20**: the only retrieval engine.
  - Collections: `chunks`, `questions`, `figures`. Point id = Postgres row UUID; text kept in the payload.
  - Hybrid search in one Query API call:
    1. dense vectors plus BM25 over a Python-normalized `lex` field and a romanized `lex_roman` field
       (Qdrant has no Hindi stemmer);
    2. fusion (weighted RRF or DBSF, chosen by eval);
    3. cross-encoder rerank and MMR in the AI engine.
  - int8 quantization with rescoring, and a tenant index on `org_id`.
  - One alias per embedding version, for zero-downtime re-embedding.
  - Backups: nightly snapshots, plus Parquet copies of embeddings in S3.
  - No ColBERT multivectors on chunks: about 0.9 TB at 3M chunks, for less value than a reranker.
- **Valkey 8, two instances**, because BullMQ needs `noeviction` while caches need eviction:
  - `valkey-queue`: no eviction, AOF every second.
  - `valkey-cache`: `allkeys-lru`, no persistence. Holds caches, rate limits and SSE streams.
- **S3** on AWS; **SeaweedFS** locally (Apache-2.0; the MinIO image is no longer published).
  Buckets: `raw`, `derived`, `exports`, `embeddings`.

## Consequences

- No duplicate search paths that could return different answers.
- Any Qdrant collection can be rebuilt from Postgres plus the Parquet embeddings, without re-embedding.
- Four stateful services to back up and monitor. Managed equivalents exist on AWS: RDS, ElastiCache, S3. Qdrant
  is self-hosted on EC2 or Qdrant Cloud.
