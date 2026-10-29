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

## Update 2026-10-29: the chat backend as built (plan v3 step 22)

**API** (`apps/api/src/modules/chat`), everything behind `chat:use`. A chat is only ever its owner's; another
teacher gets 404.

| Endpoint                                  | What it does                                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/chat/sessions?q=&show=&offset=` | History: pinned first, then most recent. `q` searches titles and what was said, Hindi included. `show=archived` lists the archive. |
| `POST /api/chat/sessions`                 | A new chat, optionally with a model from the center's allowed list.                                                                |
| `GET /api/chat/sessions/:id`              | The chat, its messages, its draft spec, and the turn still being answered.                                                         |
| `PATCH /api/chat/sessions/:id`            | Rename, pin, archive, or change model. None of these moves the chat up the history.                                                |
| `POST /api/chat/sessions/:id/turns`       | 202: the teacher's message is recorded and answered in the background.                                                             |
| `GET /api/chat/turns/:turnId/events`      | The answer as Server-Sent Events, from the start or after `Last-Event-ID`.                                                         |

**A turn:**

1. **Checks first.** The same `clientTurnId` returns the turn already made. Then the model must be one the
   center offers, and the budget must not be used up (403, in the gateway's words).
2. **One transaction.** The chat's row is locked; a chat still answering refuses another message (409); the
   teacher's message and the `chat_turns` row are written.
3. **The relay.** The API calls the AI engine (`POST /chat/turns`, service token, ids only) and copies each
   event into the Valkey stream `vidyam:chat:turn:<id>`. Text goes out at most every 50 ms, in one piece, so
   an answer is a few hundred stream entries.
4. **The end.** The answer is stored as the assistant's message, under an id fixed in advance (a UUIDv8 of
   the turn), with the title and draft spec.
   - A failed answer keeps what arrived and adds an `error` block. The cases are the engine reporting an
     error, the engine being unreachable, and the stream stopping early.
   - Then `message_complete` is sent, and the stream expires 15 minutes later.

**Following an answer:**

- The browser reads the stream after its last event id. Comments every 15 s keep a quiet connection open.
- When the stream has expired, a finished turn is reported complete at once, and the browser reloads the
  chat.
- A turn still unanswered after 5 minutes (the API restarted mid-answer, say) is marked failed and reported
  `interrupted`. The same happens when the next message is sent.

**AI engine** (`application/chat.py`): reads the conversation under the center's row-level security and never
writes it.

- Blocks become plain text for the model (`domain/chat.py`). An answered card reads as its sentence; sources
  and documents become short notes; cards, progress and errors are left out. Turns from the same side are
  joined.
- The answer is the `chat_qa` task, streamed. A new chat is named by `chat_title` alongside it.
- Gateway failures become `error` events: `budget_exceeded`, `model_unavailable`, `not_configured`,
  `provider_error`, `model_error`.
- Every event is checked against `ChatEngineEvent` before it is sent.

**Deferred to the chat agent (step 23):** card submissions and button presses (the API answers 422 for
now), intents, the draft spec, and search with citations.

## Update 2026-10-29: the chat agent (plan v3 step 23)

`ChatAgent` (`apps/ai/src/vidyam_ai/application/chat.py`) replaces the plain answer. What the teacher sent
decides the work.

**Typed text** gets one structured call: the `spec` task, routed to a cheap model. The prompt lists the
center's exam papers, and the reply is a fixed form:

- the intent, which is `create`, `ask`, `edit` or `chat`;
- what to make and the exam, by its code;
- chapter and topic names exactly as typed;
- the number of questions, question types, difficulty, languages, duration and sourcing;
- for a doubt, the question restated so it stands alone for search.

**Topics are matched by code** (`domain/mentions.py`). Every name and alias of the exam's syllabus nodes is
reduced to the same Hinglish sound key as keyword search, and compared word by word.

- "gati ke niyam", "Newton ke niyam" and "गति के नियम" all find _Force and Laws of Motion_.
- A clear best match is taken. Otherwise the closest nodes are offered on the scope card.

**The draft spec follows rules** (`domain/specs.py`):

- **Pattern.** It fits the request: the pattern nearest the number of questions asked for; without a number,
  the chapter test for a worksheet or three chapters or fewer, and the full paper for a whole subject. The
  pattern is scaled to the count, keeping only the question types asked for. Time scales with it.
- **Defaults.** Languages come from the teacher's setting, sourcing is bank first, and a worksheet is 20
  MCQs.
- **Missing fields** become at most two cards, scope and then shape, each opening with what was understood.
- **Complete drafts** show the review card: the full spec, each chapter's bank questions against those to
  generate, and a cost range and time. Costs are quoted at the route's prices (the teacher's chosen model
  for generation), with and without caching and retries. On the stub they show $0, because it is free.
- **Title.** It stays automatic, from the exam and chapter names, until the teacher sets one.

**Doubts** are answered from the center's material only:

- Retrieval (step 20) supplies up to six passages, numbered.
- `chat_qa` answers from them and cites them as `[n]`. Each cited passage becomes a citation: the file, its
  pages, and a short quote.
- With nothing found, the chat says so in the teacher's language, and no model is asked.

**Cards, buttons and the rest:**

- **Cards and buttons** need no model:
  - an answered card merges into the draft;
  - Cancel clears the draft;
  - Confirm says generation isn't switched on yet (step 26);
  - Undo has nothing to undo yet.
- **The API stores card answers and button presses as blocks.** A card answer becomes a sentence written by
  code, with exam, chapter and pattern names looked up. A button press becomes a new `action` block. Any
  model can read the transcript.
- **The chat's own sentences** ("A few details first…", "Here is what I'll make…") are written in code, in
  Hindi or English, so they are free, instant and consistent.
- **The stub model** reads requests with rules and answers doubts from the first passage, so the whole flow
  works without keys.

**Contract detail:** the AI engine sends only the fields an event sets. Python fills an optional field it
wasn't given with null, but the TypeScript contracts read optional as absent.
