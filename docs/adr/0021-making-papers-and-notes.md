# 0021. Making papers and notes: slots, bank first, checks in code, a re-solve on the other provider

- Status: Accepted
- Date: 2026-10-30

## Context

Confirm on the chat's review card (plan v3 §6.7) must turn a spec into a paper, worksheet, notes or revision
sheet that a teacher can trust without checking every line: every fact from the center's own material, every
answer key right, Hindi and English saying the same thing. It must also be cheap: a paper filled mostly from
the bank should cost cents, and nothing should be invented when the material is missing.

## Decision

**Confirm** is handled by the API with no model call: in one transaction it marks the review card confirmed,
creates the document (version 0) and its generation run, and posts a `document_ref` block. It then starts
`GeneratePaper` (papers and worksheets) or `GenerateNotes` on the AI engine's queue, named by the run's id so a
retried start finds the running workflow. The chat stays `generating` until the workflow posts its message.

**GeneratePaper** (`interface/workflows/workflows.py`, steps in `application/generation.py`):

1. **Plan in code** (`domain/generation.py`). One slot per question. Questions are split across the
   chapters by the exam's weightage (a chapter without weightage counts as average), and each chapter gets
   its share of the section's easy, medium and hard questions. The totals always match the spec exactly.
2. **Bank first.** Approved questions, then verified ones, of the slot's type under its chapter (topics
   included) in every language the paper needs. Each question is used at most once, none the student batch
   has seen, least used first, nearest the slot's difficulty. Bank-only papers mark what the bank couldn't
   fill.
3. **Write in groups** of up to five slots of one chapter and type, four groups at a time:
   - evidence from that chapter's material, leaving out passages the paper already used;
   - the teacher's model (or the `generate` route) writes the questions, citing passage numbers. Its rules
     and the exam's glossary are a 1-hour cached system prompt; the evidence is cached for 5 minutes;
   - **fast checks in code**:
     - every language present, and Hindi in Devanagari once formulas are set aside;
     - the same option keys in each language, and exactly one correct key for single-choice questions;
     - a number for numeric questions, a model answer for written ones;
     - balanced `$` and braces;
     - at least one passage cited;
   - a **grounding check** by a model, over the group and its evidence.

   A chapter with no material is marked `insufficient_evidence`; nothing is invented.

4. **Re-solve on the other provider.** Each new question is solved again, without its key, by the
   `verify_solve` route on whichever provider did not write it: GPT checks Claude's questions and Claude
   checks GPT's. The gateway's new `written_by` request field and the route's `crossProvider`/`altModelId`
   options do this. Each language version is solved on its own, given the passages the question cites, so
   the center's own definitions decide. Agreement makes the question `verified`. A different answer, or the
   Hindi and English versions disagreeing, flags it.
5. **Retry twice** with what was wrong; after that a failed question is kept as `flagged` for the teacher. A
   replaced question is retired from the bank.
6. **Assemble in code**:
   - sections in order;
   - booklet sets A–D, where set A keeps the paper's order and the others shuffle within sections;
   - options shuffled, with "all/none of the above" kept last;
   - each set's correct answers spread evenly over the option positions;
   - shuffles seeded by the run, so they come out the same every time.

   The document is saved as version 1 through the API's worker (ADR 0017).

**GenerateNotes**: a section per chapter, or per topic for standard and detailed notes. Each section is
written from its material in Markdown with `[n]` citations and checked for grounding. Its sources are kept
like a doubt's answer.

**Progress and the end.** Slot states reach the run as each group finishes, and the chat's detail carries
the run's progress for the screen to show. The workflow ends by:

- recording the run's cost from the usage ledger;
- posting `document_ref` (version 1) and a summary under a message id fixed by the run.

If the run fails, it is marked failed and the chat says why. Either way the chat is free again.

Generated questions go into the bank (`origin: generated`, tagged with method `generation`), so the next
paper on the same chapter can reuse them.

## Consequences

- **Correct answer keys depend on both providers agreeing.** With one key set (or on the stub), the re-solve
  runs on the same provider, which still catches slips but not one model's blind spot. Phase B adds the
  second key.
- **The stub model takes part in every stage.** It writes fill-in-the-blank questions from the evidence,
  checks grounding by citation, re-solves by finding the sentence again, and writes notes from the passages.
  The whole flow is therefore tested end to end with no keys, and those tests say nothing about quality;
  phase D measures that.
- **Costs.**
  - The expensive call is `generate`, once per five questions. Grounding is one cheap call per group.
  - The re-solve is one call per question and language, which roughly doubles the checking cost of a
    bilingual paper. Prompt caching and bank reuse are what keep a paper in the few-dollar range.
- **Still to come.**
  - Novelty against the bank (MinHash and embeddings) and sympy for symbolic answers are left for phase D's
    tuning; numeric answers are compared within the key's tolerance.
  - The canvas (step 27) shows the slots live from the run's slot states.
