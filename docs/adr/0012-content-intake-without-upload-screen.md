# 0012. Content comes in through the development team, not an upload screen (for now)

- Status: Accepted. Changes plan steps 25, 27 and 42.
- Date: 2026-10-25

## Context

The owner will hand over the center's books, PDFs, question papers and images directly. They will turn lecture
videos into text themselves. An in-app upload screen isn't needed yet.

## Decision

- **No Library upload screen in this phase** (step 27 is deferred).
  - Files are ingested by a command from a local folder kept out of git, with a manifest giving exam, subject,
    year, licence and parallel edition.
  - The command feeds the same pipeline as planned (step 28 onwards): queue jobs, parsing, OCR, tagging and
    indexing.
- **No speech-to-text pipeline** (step 42 is dropped). Video transcripts and notes arrive as text and are ingested
  like any other document.
- **The "brain" is the center's own content, indexed, plus Claude/GPT; no model is trained:**
  - the parsed text and its embeddings in Qdrant;
  - the item bank in Postgres.

  Retrieval keeps every answer tied to a citable source, which a trained model can't do.

## Consequences

- Ingestion can start as soon as content arrives.
- An upload screen can be added later on top of the same ingestion command.
- Thousands of files are handed over as a folder or drive; the chat is fine for samples.
