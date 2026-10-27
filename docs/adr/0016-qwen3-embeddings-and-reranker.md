# 0016. Qwen3-Embedding-4B and Qwen3-Reranker-4B, self-hosted

- Status: Accepted
- Date: 2026-10-27

## Context

Master Plan v2 left embeddings to a bake-off between the Voyage API and self-hosted BGE-M3. Voyage would
have been a third API key and a per-token bill on every re-index; BGE-M3 is older and weaker on Hindi.

The owner chose the Qwen3 pair:

- **Qwen3-Embedding-4B:** Apache-2.0, 100+ languages including Hindi, 32K context, up to 2,560 dimensions,
  69.45 on the multilingual MTEB benchmark;
- **Qwen3-Reranker-4B:** the matching reranker, which scores a query against each candidate.

## Decision

- **Both models are self-hosted.** No third key: OpenAI and Anthropic remain the only paid providers.
- **The AI engine talks to a model server over two HTTP APIs**: OpenAI-compatible `/v1/embeddings` and
  Cohere/Jina-compatible `/v1/rerank`. Only the URL changes between environments:

  | Where     | How the models run                                                              |
  | --------- | ------------------------------------------------------------------------------- |
  | Local Mac | llama.cpp `llama-server` natively on Metal, Q8_0 weights, ports 38180 and 38181 |
  | Docker    | a CPU llama.cpp container (`full` profile): correct but slow                    |
  | CI        | Qwen3-Embedding-0.6B / Qwen3-Reranker-0.6B on CPU; unit tests use a stub        |
  | AWS       | vLLM on one NVIDIA L4 (EC2 g6.xlarge), serving both models                      |

- **Documents are embedded without an instruction; queries carry one** (`Instruct: … Query: …`), as the
  model card specifies. The reranker's yes/no prompt format is verified against the reference implementation
  before its scores are trusted.
- **Full 2,560-dimension vectors**, stored in Qdrant with int8 quantization and rescoring.
- **Collections are named after the model and its dimensions** (`chunks_v2_qwen3_embedding_4b_2560`), carry
  `{schema_version, embedding_model, dims}` metadata, and sit behind stable aliases (`chunks`, `questions`,
  `figures`). The vector is named `dense`. Keyword matching uses Qdrant's BM25 full-text indexes on `lex`
  and `lex_roman`; there is no sparse-vector slot.
- **Every model version is a row in `embedding_versions`** (`qwen3-embedding-4b@2560`), and vectors are also
  written to S3 as Parquet, so re-indexing never re-embeds.
- **Changing the model** means re-embedding from `chunks.text` into a new collection and switching the alias.

## Consequences

- A standing GPU cost on AWS: about $590/month on-demand for one L4, ~$370 with a 1-year Savings Plan. Bulk
  re-embedding can run on Spot.
- Locally the models share 24 GB with the Docker stack, so Q8_0 weights (~9 GB) are used. Installing
  llama.cpp is a new runtime on the developer's Mac and is confirmed with the owner first.
- Reranking 50 candidates should take 1–2 s on the M5 and under 1 s on an L4; it is measured in step 17.
- Embedding calls are logged in the same usage ledger as LLM calls, at zero provider cost.
