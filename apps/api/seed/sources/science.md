# Science (`science`): sources and judgement calls

Built 27–28 October 2026. The tree covers school science for classes 6–10, plus the senior-secondary and graduation topics that the RPSC Senior Teacher Science paper lists, plus science pedagogy.

## Documents used

**Exam syllabi (primary sources)**

- RPSC, _Syllabus for examination for the post of Sr. Teacher (Grade-II), Secondary Education Department, Paper II: Science_. It has three parts: (i) secondary and senior secondary, 180 marks; (ii) graduation standard, 80 marks; (iii) teaching methods, 40 marks. The paper has 150 MCQs worth 300 marks. I used the copy published with the 2025 recruitment: https://img2.freejobalert.com/news/2025/07/784545-6879f37eb06df45169974.pdf. The RPSC site (rpsc.rajasthan.gov.in) loads its syllabus pages with JavaScript, so I couldn't fetch the file from RPSC directly.
- BSER, _REET 2024 syllabus, Level II_, Paper II Section IV(a) Mathematics and Science (60 questions), in Hindi and English. This is the exam held in February 2025 and is the latest REET syllabus I could find. I used the BSER PDF hosted by Testbook: https://cdn.testbook.com/1744357121366-Syllabus%20L2%20%281%29.pdf/1744357125.pdf. The Hindi part is in Kruti Dev encoding, and I read the Hindi topic names from it by hand.
- CBSE, _Science (086) curriculum, Class X_:
  - 2026-27: https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart1/Science_SecP1_2026-27.pdf
  - 2025-26: https://cbseacademic.nic.in/web_material/CurriculumMain26/Sec/Science_Sec_2025-26.pdf
  - Unit marks in both years: I 25, II 25, III 12, IV 13, V 5 (80 theory marks).
- BSER, _Class 10 syllabus 2026-27, Science (subject code 07)_, with chapter-wise marks: https://rajeduboard.rajasthan.gov.in/anudeshika-etc/10_2027.pdf

**Textbooks (ncert.nic.in/textbook/pdf/…)**

- _Curiosity_, grades 6, 7 and 8 (`fecu1`, `gecu1`, `hecu1`; 12, 12 and 13 chapters), with section headings from each chapter PDF. The Hindi editions are _Jigyasa_ (`fhcu1`, `ghcu1`, `hhcu1`).
- _Exploration_, grade 9 (`iesc1`, first edition April 2026, 13 chapters). This is a new NCF-SE 2023 book. The Hindi edition is _Anveshan_ (`ihsc1`, June 2026).
- _Science_, class X (`jesc1`, rationalised edition, reprint 2026-27, 13 chapters). Hindi edition: `jhsc1`.
- I added the old (pre-2024) class 6–8 and class 9 chapter names as aliases from memory of the rationalised NCERT books. Senior-secondary Hindi terms follow the NCERT class 11–12 Hindi-medium books (CSTT terms).

## Structure and judgement calls

- **Units.** There are five units: `physics`, `chemistry` and `biology` (all kept from the demo pack), `earth_and_environment`, and `pedagogy`.
  - Every code and path in `fixtures/demo-pack/catalog/syllabus-science.json` is unchanged, and its names, aliases and objectives are kept.
  - I added topics to three of those chapters: `carbon_compounds` gained chemical properties and soaps and detergents; `acids_bases_salts` gained acids and bases in water, and salt families and pH; `light_reflection_refraction` gained images in a plane mirror.
- **Class X chapters stay pure.** The 13 NCERT class X chapters hold only class X content, so CBSE and RBSE can link whole chapters:
  - chemistry: `chemical_reactions_equations`, `acids_bases_salts`, `metals_and_non_metals`, `carbon_compounds`
  - biology: `life_processes`, `control_and_coordination`, `reproduction`, `heredity`
  - physics: `light_reflection_refraction`, `human_eye_colourful_world`, `electricity`, `magnetic_effects_of_current`
  - earth and environment: `our_environment`
- **Where other content goes.**
  - Content from classes 6–8 that is a simpler subset of a class X chapter goes into that chapter as aliases. For example, class 7 "Exploring Substances: Acidic, Basic and Neutral" goes into `acids_bases_salts`.
  - Content that is distinct gets its own chapter, such as `electric_circuits`, `magnets` and `reproduction_in_animals`.
  - Senior-secondary depth also gets its own chapter, as NCERT does: `current_electricity` sits beside `electricity`, and `genetics` and `evolution` sit beside `heredity`.
  - "AC vs DC", which CBSE examines, is the topic `physics/alternating_current/ac_and_dc`.
- **New class 9 book (2026).** _Exploration_ reorganised class 9: it drops gravitation and food resources and adds simple machines and "Earth as a System". Its chapter titles are aliases on the matching topic chapters.
  - "Earth as a System" is split: winds and ocean currents go to `weather_climate_and_winds`, and biogeochemical cycles go to `ecosystems_and_ecology`.
- **Single home for overlapping RPSC content.**
  - Biomolecules appear in both the RPSC chemistry and biology lists. They live once, in `biology/biomolecules`.
  - RPSC "environmental chemistry" and the ecology item on pollution are merged into `earth_and_environment/environmental_pollution`.
  - RPSC graduation-level topics are added as topics inside the matching chapters, such as `plant_kingdom/gymnosperms`, `cellular_respiration/electron_transport_system` and `kinetic_theory_of_gases/molecular_speeds`. Only spectroscopy, chemical kinetics, electrochemistry, the d- and f-block, reaction mechanisms and bio-inorganic chemistry get chapters of their own.
- **Classes 6–8 opening chapters.** The "world of science" opening chapters of _Curiosity_ and _Exploration_ are aliases on `pedagogy/nature_of_science/scientific_method`, which is the only place nature-of-science content lives.

## Coverage notes

- **`rpsc_2g_p2_science`**
  - Links the whole `physics`, `chemistry` and `biology` units. Those units include class 6–8 foundation chapters, which RPSC's "secondary standard" assumes.
  - Links four `earth_and_environment` chapters: `our_environment`, `ecosystems_and_ecology`, `biodiversity_and_conservation` and `environmental_pollution`.
  - Not linked, because RPSC does not list them: astronomy, weather, soil, natural resources and energy sources.
  - `pedagogy` carries weightage 0.1333 (40 of 300 marks). Parts (i) and (ii) are split by level, not by topic, so no other node gets a weightage.
  - `pedagogy` also contains the REET-only topics on innovations and remedial teaching. RPSC's teaching-methods list does not name these, but they sit inside the same chapters.
- **`reet_level_2_science_math`** (science part only)
  - Links classes 6–8 chapters, and topics where a chapter goes deeper than REET. Senior chapters such as `digestion_and_absorption` are linked only at the topic level REET names, for example "different systems of the human body".
  - Pedagogy chapters linked: nature of science, aims, methods, innovations, aids, evaluation, and the teacher/problems chapter.
  - The syllabus does not split the 60 questions between maths and science, so there is no weightage.
  - Older REET syllabi listed the solar system. The 2024 syllabus does not, so the astronomy chapters are not linked.
- **`cbse_class_10`**
  - Links the 13 chapters plus `alternating_current/ac_and_dc`.
  - Not linked: topics the 2026-27 curriculum assesses only formatively, which are periodic classification, evolution, and the motor, electromagnetic induction and generator. They are in the tree, under `periodic_classification`, `evolution`, `moving_charges_and_magnetism/electric_motor` and `electromagnetic_induction`.
  - CBSE weights units, not chapters. Our chapters don't map one-to-one onto CBSE units, so no weightage is given.
- **`rbse_class_10`**
  - Links the 13 chapters, each with weightage = chapter marks ÷ 80 from the BSER 2026-27 syllabus.
  - The weightages are shares of the science paper, not of all RBSE class 10 subjects together.

## Open questions

- I couldn't fetch the RPSC syllabus PDF from rpsc.rajasthan.gov.in itself. If RPSC republishes the Science syllabus for a new cycle, the topic list should be checked again.
- Hindi names for some graduation-level terms vary between books, for example कोशिकीय अंतर्वेश (cell inclusions) and कंदुकन (gastrulation). They follow common NCERT and Rajasthan usage; an RPSC Hindi syllabus, if available, would settle them.
