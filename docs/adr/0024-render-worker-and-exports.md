# 0024. Exports: a render worker for PDF, Word and Kruti Dev Word, without Pandoc

- Status: Accepted
- Date: 2026-10-30

## Context

Teachers print papers and hand out answer keys, often per booklet set, and many still print in Kruti Dev
(plan v3 step 29). The plan named a Node render worker on the `render` queue:

- PDF through Playwright (Chromium);
- DOCX through Pandoc;
- a Kruti Dev DOCX.

Pandoc is a separate program to install on every machine and image. Our rule is to ask before adding a
runtime, and libraries are fine.

## Decision

1. **A render worker of its own (`apps/render`).** It is a Node service polling the `render` queue (ADR 0013)
   with one activity, `render_export`.
   - It reads the export's document version, questions, exam and the center's branding (read-only, under
     row-level security), draws the file, and puts it in the exports bucket.
   - It never writes Postgres: the API records the result (`finish_export`, ADR 0017).
   - The Python `ExportDocument` workflow joins the two: render, then record. On failure it records why.
2. **One print model, every format.** `domain/print.ts` works out once what a printed document says:
   - numbering;
   - a booklet set's order of questions and options, and its key;
   - the header and facts (exam, set, time, marks) in the paper's languages;
   - the answer-key and solutions variants.

   The PDF and both Word files are drawn from it, so they cannot disagree.

3. **PDF through Chromium.** The model is rendered with React to self-contained HTML (Noto Serif and Noto
   Serif Devanagari, KaTeX and its fonts all inlined) and printed on A4 with page numbers. The output doesn't
   depend on the machine's fonts.
4. **Word through the `docx` library, not Pandoc.**
   - Markdown is read with `marked`.
   - Mathematics goes from LaTeX through KaTeX's MathML to Word equations (OMML, via `mathml2omml`), so it
     stays editable in Word. TeX that KaTeX can't read is printed in brackets instead.
   - Hindi uses Word's Devanagari font (Nirmala UI, falling back to Mangal).
5. **Kruti Dev Word.**
   - Each Devanagari run is converted to Kruti Dev 010's encoding (`domain/krutidev.ts`) and set in that
     font; English stays in Times New Roman.
   - The conversion is the reverse of the engine's `krutidev_to_unicode`. It moves the short-i sign before
     its cluster and the reph after its syllable, and maps conjuncts, half forms and the punctuation the font
     redraws.
   - Dashes end a Kruti Dev run, because the font draws them as letters.
   - All 2,171 Hindi words of the demo pack convert back exactly through the engine's converter.
6. **Exports are fixed to a version.**
   - `POST /api/documents/:id/exports` records the format, the variant (paper, answer key or solutions; notes
     have only themselves) and the set, at the current version. It then starts the workflow.
   - Later edits don't change a file already handed out.
   - Files download through the API, named after the paper (`Force test - Set B - Answer key.pdf`). Deleting
     a document deletes its files.

## Consequences

- **No new program to install.** Locally the worker uses the Chromium Playwright already installed for the
  browser tests. Its image installs Chromium with its system libraries. CI installs Chromium for the render
  worker's integration test.
- **Word layout is ours to keep up.** Pandoc would have handled more Markdown corner cases. We handle what
  Vidyam writes: paragraphs, lists, tables, headings, emphasis and formulas.
- **Kruti Dev files need the font installed on the teacher's computer.** The export dialog says so.
- **Not yet built:** the center's logo in the header, which needs `org_settings` branding images, and the
  rasterised fallback for formulas Word can't show (plan v3 §11). Both come up when real papers are checked
  in phase C.
