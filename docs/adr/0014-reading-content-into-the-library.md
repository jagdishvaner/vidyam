# 0014. Reading content into the library: PDFium, Kruti Dev conversion, structure-aware chunks

- Status: Accepted. Delivers the first part of plan steps 27–30 and 40 (see ADR 0012 for the intake model).
- Date: 2026-10-26

## Context

The center's content is mostly PDFs and Word files:

- many are typed in the legacy Kruti Dev font, whose text layer holds Latin codes ("Hkkjr" for भारत);
- some are scans;
- question papers mix Hindi and English.

The text must reach search clean and faithful: a wrong mapping would silently corrupt Hindi.

## Decision

**Intake.** `pnpm ingest <files or folders> --kind … --licence … [--meta k=v] [--wait]` runs the API's
`ImportSource` use case:

- files are de-duplicated per organization by SHA-256;
- originals are stored once in S3 (`org/<org>/originals/<sha256>.<ext>`);
- a `sources` row is registered and the `IngestSource` workflow starts.

Re-running is safe: imported files are skipped, failed ones retried. The command never searches hidden or tool
folders and asks for `--yes` above 100 files.

**Workflow** (Temporal, ADR 0013):

1. `extract_source` runs on the `ai-cpu` queue, in a process pool, with heartbeats.
2. `chunk_source` runs on `ai`.
3. On failure, `mark_source_failed` records the error.

Unreadable or unsupported files fail at once, without retries. `pipeline_runs` and `sources.stage/status` show
progress, keyed by the workflow id.

**Reading:**

- **PDF via pypdfium2** (PDFium, BSD/Apache-2.0), not PyMuPDF, whose AGPL licence would constrain offering
  Vidyam to other centers. Text comes per character with its font, so mixed Kruti Dev and English pages are
  converted run by run.
- **Word via python-docx** (MIT), with fonts resolved through run, then style, then document defaults.
- **Plain text and Markdown** are decoded as UTF-8, falling back to Windows-1252.
- **Images** are stored for OCR.

**Kruti Dev 010 / DevLys 010 → Unicode** uses our own converter (`domain/devanagari.py`):

- The character table matches the encoding used by common open-source converters. One fix: they map `pkS` to
  चै, but it is चौ.
- The pre-base ि and the reph र् are moved over whole consonant clusters (स्थिति, मर्त्य), where the common
  converters handle only one consonant.
- Fonts are recognized by name, or by Kruti Dev word patterns when the name says nothing.

**Quality gates.** A page goes to the OCR backlog (`pages.meta.awaitingOcr`) instead of into search when it:

- has no text layer (a scan);
- is set in another legacy font (Chanakya, Walkman, …);
- has a broken character map;
- has damaged Hindi (fewer than 85% of words well-formed).

Scanner OCR layers are kept with lower confidence.

**Cleaning.** Text is normalized to NFC, invisible characters are removed, and ि extracted in visual order is
repaired.

**Chunks:**

- paragraphs and questions with their options stay together;
- about 450 estimated tokens each, never more than 800 (longer blocks split at sentence ends);
- each chunk records the pages it spans and its language (hi, en or mixed).

## Consequences

- Born-digital PDFs, Kruti Dev files, Word files and transcripts become searchable text now, with no API keys.
- Scans wait for vision OCR, which needs the Claude/OpenAI keys.
- The Kruti Dev table is unit-tested on 33 known words. It still needs checking on the center's real files,
  especially the ligature keys and the `pkS` fix.
- Chanakya and other legacy fonts go to OCR until their tables are added.
- Token counts are estimates; the embedding model's tokenizer gives exact ones at indexing time.
