# 0015. Chat turns stream through the API; clarification cards are built by code

- Status: Accepted
- Date: 2026-10-27

## Context

The chat is the product. A teacher types "RPSC 2nd grade science paper", and the platform has to work out
what is missing (exam, chapters and topics, question types, marks, difficulty, language), ask for it, show
what it will make and what it will cost, and only then spend money generating.

Two failure modes shaped this decision:

- **Letting the model design the questions it asks.** Its cards would differ from turn to turn, could not be
  translated reliably, and might skip a field the paper needs.
- **Putting the turn behind a queue.** The first words of an answer would arrive seconds later than a direct
  stream, and a closed tab would still need the turn to finish.

Only the AI engine may call a model ([0008](0008-llm-ownership-and-gateway.md)). Only the API owns
sessions, permissions and budgets ([0003](0003-service-boundaries.md)).

## Decision

- **A turn is one request with a client-made id.** `POST /api/chat/sessions/:id/turns` carries free text, a
  card submission or an action (confirm, cancel, undo). A retried request with the same `clientTurnId`
  returns the existing turn instead of creating another.
- **The API records first, then calls the AI engine with ids only.** In one transaction it checks permission
  and budget, appends the user's message and the `chat_turns` row. It then opens an internal HTTP stream to
  the AI engine and relays it.
- **The browser reads Server-Sent Events from a Valkey stream**, not from the AI connection directly. Each
  event has an id, so a dropped connection resumes with `Last-Event-ID`, and closing the tab doesn't stop
  the turn.
- **Messages are lists of typed blocks** (`ChatBlock` in `packages/contracts`): text, citations,
  clarification card, card response, spec review, progress, document reference, edit summary, notice and
  error. They are stored provider-neutral, so a teacher can switch between Claude and GPT mid-chat.
- **Cards are built by code.**
  - Free text gets one cheap model call with a fixed output schema (`intent`, `specDelta`, `mentions`).
    Chapter and topic names, including Hinglish, are matched in code against syllabus aliases.
  - Card submissions and button presses use no model call; the values merge into `chat_sessions.draftSpec`.
  - Rules in code turn missing required fields into **at most two cards**: _scope_ (exam, pattern,
    chapters and topics) and _shape_ (question types, counts, marks, difficulty, language, layout,
    sourcing). Defaults come from the blueprint, the teacher's settings and their subjects.
  - Long option lists, such as the syllabus tree with content counts, are fetched live by the web app, so
    stored messages stay small and counts stay current.
  - Each card answer is also stored as a plain sentence, for the model to read after a switch.
- **Only Confirm spends money.** The spec review card shows the full spec, what the bank already covers, and
  a cost and time estimate. Generation starts when the teacher presses Confirm, as a Temporal workflow.

## Consequences

- The web app needs a renderer per block and per card field, in English and Hindi. In exchange, cards look
  and behave the same every time, and adding a field is a code change with tests.
- Clarifying is cheap: at most one small model call per typed message, none per click.
- The API holds a stream open per active turn. Turns are short, so this is well within one instance's
  capacity at 100–200 staff.
- Valkey streams for SSE need trimming; each turn's stream expires after it completes.
