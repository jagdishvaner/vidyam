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

## Update 2026-10-28: as built (plan v3 step 17)

**Setup.** `pnpm models:setup` (`infra/models/setup.py`) puts the models in `~/.vidyam/models`, outside git.

- **Qwen3-Embedding-4B** is Qwen's own GGUF build at Q8_0 (4.3 GB). Its revision is pinned, and the file is
  checked against its published SHA-256.
- **Qwen3-Reranker-4B** has no official GGUF, and many community conversions lack the classifier tensor, which
  makes every score meaningless. So it is converted from Qwen's official weights (pinned revision) to Q8_0:
  - with llama.cpp's own `convert_hf_to_gguf.py`, taken from the commit the installed `llama-server` was built
    from;
  - in a throwaway uv environment.

  `cls.output.weight` is then checked, and `verify_reranker.py` compares the scores with Qwen's reference
  implementation (transformers, bfloat16) on Hindi, English and Hinglish pairs. The ranking must be the same,
  and the scores within 0.08. The original weights are deleted afterwards.

- Downloads resume after interruptions. `--small` sets up the 0.6B pair instead.

**Serving.** `pnpm models:up` (`infra/models/serve.py`) runs one llama-server per model on Metal:

- each with 8k context, two parallel slots and 4k tokens per request;
- embeddings on `:38180` with `--pooling last`;
- rerank on `:38181` with `--pooling rank`.

`pnpm dev` starts them too, through the `@vidyam/models` workspace package. Until setup has run, it says so
and the rest of the stack runs without search. The Docker `full` profile uses the same host servers through
`host.docker.internal`, instead of the planned CPU container. The Docker VM (7.75 GB) has neither the memory
for two 4B models nor a GPU. A CPU container with the 0.6B pair comes with the CI retrieval evaluation
(step 21).

**AI engine:**

- `HttpEmbedder` and `HttpReranker` (`infrastructure/models/qwen.py`) check what comes back: the vector count,
  the dimensions and the normalization.
- llama-server reports the reranker's probability; the check confirmed it. `VIDYAM_RERANK_SCORES=logit` is
  for servers that return raw scores. The client is told which, instead of guessing from the value.
- Query instructions are fixed per kind of search (`domain/embeddings.py`). Documents are embedded with their
  context header.
- `EmbedSource` is the `embedded` stage, run after tagging on the ai-llm queue:
  - it writes each file's vectors as Parquet (zstd, `fixed_size_list<float32>[dims]`) to the embeddings bucket
    at `org/<org>/<model_dims>/<source>.parquet`;
  - it reuses a vector whenever the content hash is unchanged, so re-chunking re-embeds only new text;
  - without a running server, the file waits at this stage instead of failing.
- `vidyam-ai bootstrap` registers the configured model as the active row in `embedding_versions`.
- System health shows both model servers, and which model each serves.

Embedding is recorded per file in `pipeline_runs` (chunks embedded and reused). It is not in the AI usage
ledger, because it costs nothing per call.

**Measured on the M5 (2026-10-28)**, Q8_0 on Metal, with flash attention on:

- **Throughput.** llama.cpp manages about 650–750 tokens/s with a 4B model (`llama-bench`, prompt processing).
  The plan's estimate of 1–2 s to rerank 50 candidates does not hold here.
- **Reranking 50 whole chunks** (about 570 tokens each) takes 49.5 s. Shortened and trimmed:

  | Candidates | Size of each     | Time   |
  | ---------- | ---------------- | ------ |
  | 30         | first 300 tokens | 16.5 s |
  | 20         | first 300 tokens | 11.4 s |
  | 20         | first 200 tokens | 9.8 s  |

  An L4 on AWS is roughly 10–20 times faster. Step 20 makes the number of candidates and their length
  settings. Cutting passages short turned out to lose answers; retrieval reranks 10 whole passages
  instead ([0020](0020-hybrid-retrieval.md)).

- **Embedding the demo pack** (about 70 chunks) takes about 2 minutes. A few thousand pages of the center's
  content will take hours locally, once; on AWS much less.
- **Retrieval quality.** Embeddings put the answering passage first for English, Hindi, Hinglish and
  cross-language queries.
- **Reference check.** The converted reranker matches Qwen's reference implementation within 0.002, with
  the same ranking for every query.

**Chunk sizes, recalibrated.** Qwen3's tokenizer spends about 1.3 tokens per Devanagari character, and about
one per 2.8 other characters. The earlier estimate undercounted Hindi about 3 times. Chunks are now sized in
these tokens: about 512, never more than 1,024 (`chunker-3`).
