# 0020. Retrieval: hybrid search, one copy per passage, whole-passage rerank

- Status: Accepted
- Date: 2026-10-28

## Context

The chat answers doubts from the center's material, and paper generation needs evidence for each topic
(plan v3 §6–7). Both need the passages that answer a query, in Hindi, English or Hinglish, often across
languages: an English question whose answer sits in Hindi notes.

Steps 17–19 put every passage into Qdrant with its Qwen3 vector, its tags and two keyword forms (`lex`,
`lex_roman`). Step 20 decides how a query turns into a short list of passages.

## Decision

Retrieval is `Retrieve` (`application/retrieval.py`); the choices are pure functions in `domain/retrieval.py`.

1. **One hybrid query in Qdrant.** Three searches inside the scope (organization, syllabus nodes with their
   descendants, language, licence, kind, files, passages to leave out):
   - by meaning: the query's Qwen3 vector, top 50;
   - by keywords: BM25 over `lex` and over `lex_roman`, top 20 each.

   They are fused inside Qdrant by weighted reciprocal rank: weight / (k + rank), with weights 1, 0.5 and
   0.5 and **k = 2**, the top 40 read back with their vectors.

2. **One copy of each passage.** Two candidates are the same passage when they come from the Hindi and
   English editions of one book (same parallel group) and their vectors are at least 0.80 similar, or from
   any two files at 0.95. The copy in the teacher's language is kept, at the better rank. Without a stated
   language, a query in Devanagari asks for Hindi.
3. **Rerank whole passages.** Qwen3-Reranker-4B reads the top 10 candidates, each whole (up to 1,100 tokens,
   enough for a chunk and its headings), and gives each the probability that it answers the query. Passages
   below **0.05** are dropped; when none is left, the material does not cover the question.
4. **Picks.** Maximal marginal relevance over the reranker's scores (diversity 0.25 by default), and at most
   3 passages from one file while other files still have relevant ones.
5. **Neighbours.** Each pick brings the passage before and after it, when they are in the same section
   (same heading path, or under it). A passage is shown once.
6. **Caches in Valkey** for query vectors and for reranker scores per (query, passage text). Both depend
   only on their input and the model, so they never go stale, and results are never cached: the index is
   asked every time.
7. **Degrades instead of failing.** Without the embedding server, search runs on keywords only; without the
   rerank server, the fused order stands. The result says what was skipped.

Settings: `VIDYAM_RERANK_CANDIDATES` (10) and `VIDYAM_RERANK_TOKENS` (1100). `pnpm search` runs the same
retrieval from the terminal.

## Measured on the demo pack (2026-10-28)

45 of the 50 eval queries are answerable today. The other 5 are about the scanned chemistry notes, which
wait for OCR.

| Fusion (top 40)           | Answer in top 20 | Top 5 | Top 1 | MRR  |
| ------------------------- | ---------------- | ----- | ----- | ---- |
| Meaning only              | 45               | 45    | 37    | –    |
| Hybrid, k = 60 (textbook) | 44               | 39    | 29    | 0.75 |
| Hybrid, k = 2             | 45               | 44    | 29    | 0.80 |

With k = 60 a passage halfway down all three lists outranked the best match by meaning: long Hindi queries
match many passages on common words (क्यों, होता), so the keyword lists carry noise. A small k lets each
list's first few count.

Meaning alone puts the answer first more often here. Keywords stay because the reranker reorders the top 10
anyway, and real content brings what synthetic notes lack: exact terms, formulas, names and codes that a
vector blurs.

| Rerank                          | Answer among the picks | First | Time (M5) |
| ------------------------------- | ---------------------- | ----- | --------- |
| 20 candidates cut to 300 tokens | 26 of 45               | 24    | ~11 s     |
| 10 whole candidates             | 45 of 45               | 42    | ~12 s     |

Qwen's tokenizer spends about 1.3 tokens per Devanagari letter, so 300 tokens keep about 45 Hindi words, and
the reranker never saw the answer; many queries came back empty. Fusion already puts every answer in its top
10, so reading 10 whole passages costs what 20 cut ones did.

Reranker scores: answers scored 0.07 or more (an English question on a Hindi passage scores lowest); the 5
questions about the scanned notes, and questions from outside the syllabus, scored 0.005 or less.

## Consequences

- A doubt in the chat costs about 12 s of reranking on the Mac, and well under a second on an L4 GPU on AWS,
  where the settings can rise to 30–50 candidates. A repeated query skips both models.
- The reranker's instruction is the one built into the model file ("Given a web search query, retrieve
  relevant passages that answer the query"); llama-server can't change it per request. A teacher-specific
  instruction would mean rewriting the template in the GGUF; worth trying only if the eval (step 21) shows
  a need.
- The thresholds (0.80, 0.95, 0.05) and the fusion weights come from a small synthetic pack. The retrieval eval
  (step 21) checks them on every change, and the center's real content (phase C) will tune them.
- Bank questions are not searched yet: the `questions` collection is filled with generation (step 26).

## Update 2026-10-29: the retrieval eval (plan v3 step 21)

**What it measures.** `EvaluateRetrieval` (`application/evaluation.py`, measures in `domain/evaluation.py`)
sends each query through retrieval exactly as the chat will, and records where its answer landed. A passage
is the answer when it comes from the named file and contains the named phrase.

- **recall@1/5/10/20** of the fused candidates, the list the reranker reads from. The plan's target is
  recall@20 ≥ 0.9: what search never finds, reranking can't fix.
- **@20 in chapter**: the same query limited to the answer's chapter, as a teacher who picked it would ask.
  It also checks that the passage was tagged to the right chapter.
- **Found / First / MRR**: whether the answer is among the passages returned, after reranking and the
  cut-off, and at what position.
- **Questions the material doesn't answer** (`fixtures/demo-pack/eval/unanswerable.json`, 6 of them) should
  come back empty.
- Time per stage, with a cold cache so the models are timed for real.
- A query whose file has nothing searchable yet is reported apart and not counted. Today that is the 5 about
  the scanned notes, until OCR reads them (phase B).

**Where it runs.**

- `pnpm eval:retrieval` loads the demo pack into a throwaway center, runs the eval and writes
  `apps/ai/reports/retrieval-eval.md`. It is an integration test marked `eval`, left out of
  `pnpm test:integration`.
- `vidyam-ai eval-retrieval --org <slug> --queries <file>` runs it against any center's library, for the
  teachers' golden sets in phase D.
- CI (`.github/workflows/retrieval-eval.yml`) runs it with the 0.6B pair on CPU whenever search code, reading
  code, the models or the demo pack change, and on demand. llama.cpp is the same build as on the Mac
  (b11669, its CPU release), and the converted models are cached between runs.

**Results on the demo pack** (45 answerable queries, 6 unanswerable):

| Models           | recall@1 | @5  | @10  | @20  | @20 in chapter | Found | First | MRR  | Unanswerable left empty | Rerank per query          |
| ---------------- | -------- | --- | ---- | ---- | -------------- | ----- | ----- | ---- | ----------------------- | ------------------------- |
| 4B (M5, Metal)   | 64%      | 98% | 100% | 100% | 100%           | 100%  | 93%   | 0.97 | 6 of 6                  | 14.1 s median, 18.6 s p95 |
| 0.6B (M5, Metal) | 62%      | 89% | 100% | 100% | 100%           | 93%   | 76%   | 0.84 | 6 of 6                  | 1.2 s median, 2.9 s p95   |

By language with the 4B pair, the answer came first for 94% of Hindi queries, 93% of Hinglish and 92% of
English ones. The 0.6B pair loses most on Hinglish (60% first) and English (67%). It stays as CI's smoke check
and isn't a fallback for real use. On CPU it reads about 490 tokens/s with 4 threads, so CI reranks for about
15 s a query.

CI's thresholds sit just under what the 0.6B pair measured: recall@20 ≥ 0.9, Found ≥ 0.85, and at least 80%
of unanswerable questions left empty (`VIDYAM_EVAL_MIN_*`). The local default is the plan's target, with Found
≥ 0.9.

**Fixed along the way.** `pnpm models:setup` called pnpm's own built-in `setup` command instead of the
script, and `models:up` passed a stray `--`. All four model revisions are now pinned to commits, so CI and
every Mac fetch the same weights.
