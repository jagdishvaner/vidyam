# Social Science: sources and judgement calls

Tree: `syllabi/social_science.json` (19 units, 151 chapters, 744 topics). Coverage: `coverage/social_science.json`.

## Documents used

- **RPSC Senior Teacher (Secondary Education Dept.), Paper II Social Science**, the syllabus PDF dated 25 Sep 2025, at <https://rpsc.rajasthan.gov.in/Static/Syllabus/911C23F4-3655-4F34-976B-8046CFAEBB1F.pdf>. It is the current one. The older 2022 version (<https://rpsc.rajasthan.gov.in/Static/Syllabus/DFD8A759-CE16-4B49-A9EB-5DE6C7AC1885.pdf>) was read for comparison.
- **REET 2024 syllabus, Level 2, Paper II Section IV(b) Social Studies** (60 Q), BSER Ajmer, Hindi and English. The official PDF is mirrored at <https://static.collegedekho.com/media/uploads/2024/12/16/reet-level-2-syllabus-2024-in-hindi-pdf_l651lBi.pdf>. It is the latest REET notification found; the exam was held in Feb 2025.
- **RBSE Class 10 Social Science (subject code 08), syllabus for session 2026-27**, at <https://rajeduboard.rajasthan.gov.in/anudeshika-etc/10_2027.pdf>, pages 9–15. It gives marks per chapter and uses the NCERT books.
- **CBSE Social Science (087), Class X curriculum 2026-27**, at <https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart1/SocialScience_SecP1X_2026-27.pdf>.
- **CBSE Class IX 2026-27**, at <https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart1/SocialScience_SecP1IX_2026-27.pdf>. It covers the new NCF-SE 2023 Class 9 book, Social Science Part 1 and 2.
- **NCERT textbooks.**
  - Rationalised Class 9–10 books: India and the Contemporary World I–II, Contemporary India I–II, Democratic Politics I–II, Economics / Understanding Economic Development.
  - New _Exploring Society: India and Beyond_ books for Classes 6, 7 (Parts 1–2) and 8 (Parts 1–2). Chapter lists were cross-checked on teachoo.com and shaalaa.com.

## Structure and judgement calls

- **Organised by topic, not by class.** The history, geography, polity and economics units hold NCERT 6–10 content. Each Class 10 NCERT chapter is its own chapter node, named as in the NCERT Hindi book, so the CBSE and RBSE links are exact. The single exception is "Nationalism in India", which is `modern_india/gandhian_movements` (see the RBSE section below).
- **Old and new NCERT books are both covered.** The rationalised Class 9 chapters (French Revolution, Palampur, Food Security, etc.) and the new Class 6–9 themes (plate tectonics, biomes, entrepreneurship, personal finance, Kautilya/authority) both have nodes. Coaching material still uses the old books.
- **Rajasthan.** REET lists Rajasthan history, art and culture, and Rajasthan geography, so each has its own unit (`rajasthan_history_culture`, `rajasthan_geography`). Panchayati raj and district administration are treated "with reference to Rajasthan", as REET states.
- **RPSC-only disciplines.** The 2025 RPSC syllabus adds Sociology, Public Administration and Philosophy, so each is its own unit. A few topics from the 2022 syllabus were kept because they are harmless: credit creation, budget deficits, UNO, Lokpal, Administrative Reforms Commissions.
- **Pedagogy.** The REET "शिक्षाशास्त्रीय मुद्दे I/II" and the RPSC "Teaching Methods" are merged into one `pedagogy` unit.

## Coverage notes

- **RPSC 2nd Grade P-II.** Links the chapters that match the 2025 list.
  - Rajasthan geography is linked as the whole unit, with irrigation and tourism treated as part of agriculture, transport and trade.
  - India geography is linked as a unit, plus the soil, biodiversity, agriculture and industry chapters from `india_resources`.
  - The pedagogy link leaves out `classroom_processes`.
  - The paper says it mixes secondary/senior-secondary standard, graduation standard and teaching methods, but gives no marks split, so there is no weightage.
- **REET Level 2.** Links exactly what the 2024 list names.
  - `ancient_india/sources_and_prehistory` and the Sultanate, Maratha and Arab/Turk chapters are left out.
  - `post_mauryan_period` is included because the list says "Mauryan & Gupta Empires and Post-Gupta Period" and the state books teach the gap between them.
  - "Economic and Social Programmes of Development" is linked at topic level.
  - No unit-wise split is published (60 of the 150 questions), so there is no weightage.
- **CBSE Class 10.** The links cover the full 2026-27 course, including the parts assessed internally only:
  - Making of a Global World subtopics 2–4 (project)
  - Age of Industrialisation (periodic assessment)
  - Lifelines (map work only)
  - Consumer Rights (project)

  CBSE gives marks only per discipline (20 each, out of 80), not per chapter, so there is no weightage.

- **RBSE Class 10.** Weightage is the chapter's marks divided by the 80-mark theory paper. The values sum to 1.0 within social science. Because the `rbse_class_10` exam spans five subject papers, this weightage is a share within the subject paper, not of the whole exam.
  - "Nationalism in India" is linked through `modern_india/gandhian_movements`. Its topics follow the NCERT sub-sections, plus a Poona Pact topic.

## Uncertain

- **Next REET.** No notification after REET 2024 was found. If a new syllabus changes the list, re-check the REET links.
- **New NCERT books.** Class 8 Part 2 and the new Class 9 book chapter titles were checked only on secondary sites.
- **RBSE Class 9 books.** RBSE may still use the old NCERT Class 9 books for 2026-27. The tree keeps both old and new.
