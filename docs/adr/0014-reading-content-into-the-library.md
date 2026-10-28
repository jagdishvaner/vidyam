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

## Update 2026-10-28: ingestion v2 (plan v3 step 16)

**Manifests.** `pnpm ingest --manifest <folder>/manifest.csv` runs the API's `ImportManifest` use case.

- The whole manifest is checked before anything is stored:
  - subject, exam paper and chapter codes against the center's syllabus and exams;
  - the files themselves;
  - page ranges;
  - answer keys against their paper (same booklet set);
  - parallel editions, in the manifest or already in the library.

  Every problem is reported with its CSV line.

- Typed columns are filled from the manifest. `meta.manifest` keeps the row as written; `meta.structure` holds
  the chapter and page sections resolved to syllabus ids.
- One `ingest_batches` row and a copy of the CSV in S3 are kept per import.
- Importing again updates descriptions in place: nothing is uploaded twice. A changed description restarts the
  workflow with `stages: structure`, which keeps the stored pages and redoes sections, chunks and tags.
- Parallel editions share a group id. It is derived from their contents, so a re-import doesn't count as a
  change.

**Reading:**

- **Headings.** PDF text carries font size and weight. A heading is a short line:
  - at least 12% larger than the body text, at one level per size; or
  - entirely bold; or
  - one that starts like a chapter ("अध्याय 8", "Chapter 3", "इकाई 2").

  Running headers and page numbers are excluded. Word heading styles and Markdown `#` are trusted as they are.

- **Page text** is stored as Markdown with `#`/`##`/`###` headings.
- **Page images**: every PDF page as a PNG with a 1,568-pixel long edge, in the derived bucket at
  `org/<org>/pages/<source>/<n>.png`. They are used for vision OCR, figures and citations.
- **Page labels** come from the PDF's own labels, else from the manifest's `pageOffset`.
- **Versions**: each page records the reader version that produced it (`pdf-2`, `+krutidev-1`, …).
- Reading a file again keeps pages that were read by OCR or corrected by hand.

**Sections** (`source_sections`), in order of trust:

1. the manifest's page ranges or chapter;
2. a table of contents near the front;
3. the top-level headings.

Titles are matched to syllabus names and aliases, in Hindi or English. A match needs a word-overlap score of at
least 0.6; below that, the section is kept without a node.

**Chunks:**

- never span two headings, and never mix questions with explanatory text;
- record their heading path. The context header (title › headings) is embedded with them, with no LLM call;
- have a kind: prose, question, solution, definition or table;
- carry a hash of what is embedded. A chunk unchanged at its position keeps its row, so its tags (and later its
  vectors) survive a re-run.

**Rule tags.** The manifest's chapter applies to the whole file; otherwise a chunk takes its section's chapter;
otherwise the subject. Method and confidence are recorded. A tag below 0.6 is kept for review and is not used as
the chunk's primary tag. If a chunk's chapter changes, its model-picked topics are dropped too.

**Workflow**, in order:

1. `extract_source` on ai-cpu (skipped for `stages: structure`);
2. `structure_source`;
3. `tag_source`.

The library counts a file as ready from `chunked` onwards (`tagged`, and later `embedded` and `indexed`).
Removing a file also deletes its page images.
