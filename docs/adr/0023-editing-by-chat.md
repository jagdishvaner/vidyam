# 0023. Editing by chat: the agent plans, the API applies, rewrites run as a workflow

- Status: Accepted
- Date: 2026-10-30

## Context

Once a paper or notes exist, teachers change them in the chat: "remove Q5", "make Q3 harder", "give the
numericals 4 marks", "translate Q7 into English" (plan v3 §6.9). The plan asks for:

- an agent that sees an outline of the document and edits through operations;
- edits made against the version the agent read;
- a diff with Undo;
- more than five regenerated questions moved to a workflow.

Constraints from earlier decisions:

- the AI engine never writes documents or chats (ADR 0017);
- every change is a new version against a base version (ADR 0022);
- new questions must pass the same checks as when the paper was made (ADR 0021).

## Decision

1. **The agent plans; code turns the plan into operations.**
   - The engine reads the chat's document (read-only) and gives the teacher's model (`edit_agent`) an outline:
     one line per question or section, with the id it must use, type, chapter, difficulty, marks, state and
     first words.
   - The model answers with a reply and a list of changes: `remove`, `move`, `marks`, `rename`,
     `instructions` and `rewrite` (with the teacher's words and a target difficulty).
   - `domain/editing.py` checks every id against the document and turns the changes into `EditOp`s and
     rewrite requests. Ids the outline doesn't have are refused and named in the reply.
2. **Simple changes are applied by the API, in the turn.**
   - The engine streams a `document_edit` event with the operations and the version it read.
   - The API applies them through the same rules as the canvas, as the agent, and adds an `edit_summary`
     block (or the reason it refused) to the answer it stores.
3. **Every rewrite runs as a workflow, however few questions.**
   - The engine streams `document_rewrite`. After storing the turn's answer, the API creates a run on the
     newest version and starts `EditDocument`.
   - The workflow runs the generation steps on just those items: evidence, writing (with the teacher's words
     and the item as it stands), fast checks, grounding, and the re-solve on the other provider.
   - Only questions that pass replace the old ones; a notes section is replaced whole, sources and all.
   - The API's `apply_document_edits` activity saves the next version and the chat's message in one
     transaction, but only if the document is still at the base version. A retry finds the message and
     answers as before.

   This departs from the plan's "more than five go to a workflow". Model time dominates even for one
   question, the workflow survives a restart, and one path is simpler to test.

4. **Undo is the API's.**
   - Undo on the chat's latest edit summary restores the version before it as a new version (ADR 0022). No
     model is asked.
   - If the document moved on since, nothing is undone, and the reply points to the canvas's history.
   - Confirm is handled the same way (ADR 0021), so the engine handles only Cancel among the buttons.
5. **The canvas shows rewrites live.** While a rewrite runs, the items being written show as "being written",
   from the run's plan. The chat stays `generating` until the workflow's message arrives.

## Consequences

- **The model never writes the document directly.** A wrong id or an impossible change becomes a sentence in
  the reply, not a broken paper.
- **A teacher can't edit a paper twice at once by mistake.** A rewrite that finds the paper changed when it
  finishes saves nothing and says so; the questions it wrote stay in the bank.
- **`edit_agent` costs one call per edit message**, on the teacher's chosen model. Rewrites cost what writing
  those questions costs, plus their checks.
- **The stub reads edit requests by pattern**, so the flow is tested end to end without keys. Understanding
  free phrasing is the real model's job, and phase D's evaluation covers it.
