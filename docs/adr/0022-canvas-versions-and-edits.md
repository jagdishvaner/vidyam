# 0022. The canvas: append-only versions, edits against a base version, a teacher's wording as a new question

- Status: Accepted
- Date: 2026-10-30

## Context

A document the chat makes (ADR 0021) opens on the canvas beside the chat (plan v3 §2). Two kinds of change
reach it:

- the teacher's own, by hand;
- later, the chat's edit agent (step 28).

Teachers expect to undo, to see what changed, and never to lose an edit, even when the agent and the teacher
change the same paper at once. Papers point at questions in the shared bank; the generated ones may already
sit in other papers.

## Decision

1. **Versions are append-only.** Every change saves a new `document_versions` row, records the operations that
   made it, and moves `documents.current_version` on. Undo, or going back to any version, saves that version's
   content again as the newest, with the operation `restore`. History is never rewritten, so an undo can
   itself be undone.
2. **Every edit names the version it was made on.** `POST /api/documents/:id/edits` carries `baseVersion` and
   a list of `EditOp`s. In one transaction on the locked document row, it applies them only if the document is
   still at that version; otherwise it answers 409 and the canvas reloads the newest version. A document
   still being made (version 0) refuses edits.
3. **The rules are pure code.** `apps/api/src/modules/studio/domain/edits.ts` applies the operations:
   - replace, edit, remove, add and reorder items, marks, section instructions and the title for papers;
   - edit and remove sections for notes.

   It keeps the booklet sets consistent: a removed item leaves every set; a reorder moves set A, which prints
   the paper's order, while the other sets keep their shuffle; a replaced item prints its options unshuffled.

4. **A teacher's wording is a new question.** `edit_item` saves the text as a new question in the bank
   (`origin: teacher`, a draft until a reviewer approves it), tagged like the one it replaces, and puts it in
   the slot. Old versions keep pointing at the original, so restoring brings it back, and other papers that
   use the original are untouched. Deleting a document also deletes the teacher's drafts written in it. The
   bank never offers drafts, so nothing else can be using them.
5. **Live while being made.** Until the first version is saved, `GET /api/documents/:id` builds the paper from
   the run's slot plan and slot states (ADR 0021). The canvas reads it every two seconds while the run is going,
   so questions appear as their groups finish.
6. **Documents are their owner's**, like the chat they were made in.

## Consequences

- **The edit agent (step 28) needs no locking of its own.** It produces `EditOp`s against the version it read;
  if the teacher changed the paper meanwhile, its edit is refused and it reads again.
- **Restoring an old version can bring back a question a teacher has since reworded.** Both stay in the bank,
  so this is by design.
- **The diff is worked out in the browser, from two versions' content.** It compares items (slots or
  sections), not text. A text diff of a question can come later if teachers want it.
- **Teacher-written questions wait in the bank as drafts** until the question bank and review screens arrive.
