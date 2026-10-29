# Demo content pack

Synthetic content written for Vidyam, shaped like what the center will hand over. It is two things at once:

- **the test fixture**: ingestion, tagging, retrieval, chat and paper generation are tested against it, all of
  them on the stub model, before any real content or API key exists;
- **the first evaluation set**: its texts are the exact ground truth for extraction and OCR, its questions have
  checked keys, and its queries say which passage should be found.

Nothing here is copied from a book. Science content follows the class 9–10 / RPSC 2nd Grade level.

## What is in it

| Path                                 | What                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `manifest.csv`                       | One row per file, with everything search filters on (plan v3 §5); `files/` row = folder defaults |
| `files/`                             | The 10 files as the center would hand them over (built; do not edit)                             |
| `texts/*.md`                         | The source text of each notes file, page by page: ground truth for extraction and OCR            |
| `texts/science-test-2025-set-a.json` | The mock test booklet: title, instructions and the bank questions it prints                      |
| `questions/<chapter>.json`           | 200 bilingual questions (`QuestionImport`), tagged to syllabus topics                            |
| `catalog/syllabus-science.json`      | Science → physics, chemistry, biology → 9 chapters → 42 topics, with Hinglish aliases            |
| `catalog/exams.json`                 | The exam paper the pack targets: RPSC Senior Teacher (2nd Grade), Paper II, Science              |
| `catalog/blueprints.json`            | Paper patterns: full paper (150 × 2 marks, ⅓ negative), chapter test, practice worksheet         |
| `catalog/glossary.csv`               | ~100 approved English ↔ Hindi science terms                                                      |
| `eval/retrieval.json`                | 50 teacher queries (Hindi, English, Hinglish) with the passage each should find                  |
| `eval/unanswerable.json`             | 6 questions the material doesn't answer; search should come back empty                           |
| `fonts/`                             | Noto Sans fonts (SIL Open Font License, `fonts/OFL.txt`) used to draw the files                  |

The files cover the cases real content brings:

| File                                       | Case                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `physics-motion-force-hi.pdf`              | Hindi notes spanning two chapters (page ranges in the manifest)       |
| `physics-work-energy-en.pdf` / `-hi.pdf`   | The same notes in English and Hindi (`parallelOf`)                    |
| `physics-light-krutidev.pdf`               | Hindi typed in the legacy Kruti Dev font (text layer is Latin codes)  |
| `physics-electricity-en.docx`              | A Word file                                                           |
| `chemistry-acids-bases-salts-scan.pdf`     | A photographed scan with no text layer: needs OCR                     |
| `chemistry-carbon-compounds-bilingual.pdf` | Hindi and English paragraphs interleaved                              |
| `biology-cell-life-processes-hi.pdf`       | An excerpt of a book: printed page numbers start at 41 (`pageOffset`) |
| `science-test-2025-set-a.pdf` / `-key.pdf` | A bilingual question booklet (set A) and its answer key               |

## Commands

```sh
pnpm demo:build                 # rebuild files/ from texts/ and questions/, then read each file back
pnpm demo:build --only light    # just the files whose name contains "light"
pnpm demo:check                 # questions and queries against the contracts and the pack's rules
pnpm ingest --manifest fixtures/demo-pack/manifest.csv --wait   # load the pack into the library
```

`pnpm ingest --manifest` checks the manifest against the center's syllabus and exam papers first, so load the
syllabus and exam paper (Admin → Exams & syllabus, or `pnpm db:seed`, whose official seed includes every code the
pack uses) before the files.

`demo:build` reads every file back with the AI engine's own extractor and fails if the text differs from what
it drew, so `texts/` stays the exact ground truth. The scan is rendered with headless Google Chrome (it shapes
Hindi properly, and OCR reads pixels); the other PDFs are drawn by ReportLab, which does not shape Devanagari,
so their Hindi looks slightly off on screen while the text layer is exact.

`packages/contracts/test/demo-pack.test.ts` checks the whole pack on every `pnpm test`.

## Formats

These are the same import formats admins will use (`packages/contracts/src/catalog.ts`, `manifest.ts`):

- **Syllabus nodes are referred to by code path**, from the subject down: `science/physics/motion/acceleration`.
- **Manifest lists** are separated by `;`. Sections are `pages=chapter`: `1-4=science/physics/motion`.
- **Notes sources** (`texts/*.md`) use `# chapter`, `## section`, paragraphs, `- bullets`, and `<!-- page -->`
  between pages.
- **Retrieval queries**: `{id, query, lang: hi|en|hinglish, node, expect: [{file, phrase}]}`. A retrieved chunk
  counts as a hit when it comes from `file` and contains `phrase`, which appears verbatim in that file's text.
- **Questions the material doesn't answer** (`eval/unanswerable.json`): `{id, query, lang}`. Retrieval should
  return nothing for them.
