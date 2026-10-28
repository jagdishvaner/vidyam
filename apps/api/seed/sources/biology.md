# Biology syllabus: sources and judgement calls

Built on 2026-10-27. The generator script lives outside the repo; edit the JSON directly or ask for it to be regenerated.

## Primary sources

- **NEET (UG)**: the NMC syllabus PDF linked as "Syllabus" on NTA's NEET page, https://neet.nta.nic.in/syllabus/
  (file `cdnbbsr.s3waas.gov.in/.../uploads/2026/01/20260102588210790.pdf`; its header still reads "NEET (UG) - 2025").
  NMC/UGMEB said the 2026 syllabus is unchanged from 2025. Biology Units 1–10 were read line by line.
- **RPSC School Lecturer (School Education) Biology Paper II**: the syllabus dated 19 Sep 2025, from
  https://rpsc.rajasthan.gov.in/viewcommon?Slice=SL (`/Static/Syllabus/27F64CF5-4D2F-497F-942E-D70A5628885B.pdf`).
  The 2024 syllabus (`11326B14-…pdf`) was used only for comparison.
- **CBSE Class XII Biology 2026-27**: https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart2/Biology_SecP2_2026-27.pdf
  (compared with the 2025-26 version, which differs only in the formative-assessment note).
- **RBSE (BSER Ajmer) Class 12 Biology, Syllabus 2026-27** (subject code 42), from the board's
  "पाठ्यक्रम 2027" file https://rajeduboard.rajasthan.gov.in/anudeshika-etc/12_2027.pdf. The Class 11 file
  `11_2027.pdf` was used for Hindi terminology. Both use the NCERT books.
- **NCERT rationalised Biology XI/XII**: the chapter lists are the ones CBSE and RBSE give above. The Hindi names
  follow the NCERT and RBSE Hindi-medium wording, such as द्विपद नाम पद्धति, अनुलेखन, स्थानांतरण, समष्टि and पारितंत्र.

## How the tree is organised

- 13 units by topic area. The NCERT chapters keep NCERT boundaries and names. Content that the rationalised NCERT
  books dropped, but RPSC still asks for, has its own chapters so the school exams can link whole chapters. These
  chapters are Transport in Plants, Mineral Nutrition, Digestion and Absorption, Reproduction in Organisms,
  Organism and its Environment, Ecological Succession and Nutrient Cycling, Environmental Issues, Reflex Action and
  Sensory Reception, and Plant Movements, Photoperiodism and Vernalisation.
- Graduation and post-graduation content (RPSC Parts II–III) also has its own chapters, which NEET, CBSE and RBSE
  never link:
  - Cryptogams and Gymnosperms life cycles
  - Classification of Animals up to Classes
  - Animal Type Studies
  - Cell Cycle Regulation and Apoptosis
  - Developmental Biology
  - Chromosome Organisation and Gene Regulation
  - Medical Biotechnology
  - Microbial Culture Techniques
  - Plant and Animal Tissue Culture
  - Biogeography and Wildlife Conservation
  - Bioremediation and Waste Management
  - Ethology
  - Tools and Techniques
  - Biostatistics
  - Bioinformatics

  The generator asserts that the school exams link none of them.

- Where RPSC's graduation items describe the same content as NCERT, they share the NCERT nodes rather than
  duplicating them. Examples are RPSC's "Cell structure and functions", "Reproduction in higher plants"
  (microsporogenesis, embryogenesis, apomixis) and "Levels of organisation, symmetry, coelom".

## Coverage decisions

- **neet_ug**: all 19 rationalised Class XI chapters and all 13 Class XII chapters. NEET does not list taxonomical
  aids or the three-domain system, so The Living World and Biological Classification are linked topic by topic
  without those two topics. NEET also lists some items that NCERT does not cover, such as the families
  Malvaceae/Cruciferae/Compositae/Gramineae and the thymus. These sit inside the linked chapters (for example as
  aliases of "important_families"), so they need no separate links. No weightage is set, because NMC does not fix
  shares within biology.
- **cbse_class_12_science**: the 13 NCERT XII chapters, plus the `stem_cell_technology` topic, which CBSE lists
  under Ch. 10 but NCERT/NEET/RBSE do not. **Environmental Issues is not linked.** CBSE 2026-27 says it is "included
  in the syllabus but will be assessed only formatively", so it is not in the board paper. Link it if teachers want
  it for school-internal work. No weightage is set, because CBSE gives marks per _unit_ (VI 16, VII 20, VIII 12,
  IX 12, X 10 of 70) but not per chapter.
- **rbse_class_12_science**: the 13 NCERT XII chapters, with weightage = chapter marks ÷ 56 theory marks
  (Ch 1–13: 5, 4, 2, 5, 6, 3, 6, 5, 4, 4, 4, 5, 3). The other 14 of the 70 marks are sessional.
- **rpsc_1g_p2_biology** (2025 syllabus):
  - Whole units: Diversity, Structural Organisation, Cell, Plant Physiology, Human Physiology, Reproduction,
    Biology in Human Welfare, Ecology and Environment, Biological Techniques, History of Biology, and Pedagogy.
  - Genetics: every chapter except **Evolution**.
  - Biotechnology: every chapter, except that Medical Biotechnology is linked only through its monoclonal
    antibodies and therapeutic proteins topics, without stem cells.
  - No weightage is set: the pattern says 150 MCQs / 300 marks across Parts I–IV without fixing their shares.

## Judgement calls and open points

- **Evolution is not in the RPSC 2025 syllabus.** The 2024 syllabus had "Origin of life – theories and evidence",
  and the 2025 one does not. Following the current syllabus, Evolution is not linked for RPSC. If the coaching
  centre wants it covered anyway, add `biology/genetics_and_evolution/evolution/origin_of_life`.
- **RPSC "Reproduction" (Part I, Animal Physiology)** is read broadly. It links Reproductive Health and Reproduction
  in Organisms as well as Human Reproduction, because the whole Reproduction unit is linked.
- **RPSC "Biology in Ancient India: contribution of various Indian scientists"**: the topics cover Charaka and
  Sushruta, Vrikshayurveda (Parashara, Surapala) and Shalihotra/Hastyayurveda. A topic on Indian biologists more
  broadly (J.C. Bose, Birbal Sahni, Khorana and others) is included because the line is ambiguous.
- **RPSC Part IV (Pedagogy, ICT)** is not biology content, but `rpsc_1g_p2_biology` only lists the biology subject.
  So it sits in a `pedagogy` unit here, the same unit code other subjects use. A shared pedagogy subject in
  catalog.json would avoid repeating it in every subject.
- Items that only the RPSC 2024 syllabus had (beverages, floral variations in Ranunculaceae/Apiaceae, data
  representation in biostatistics, classification up to order) were left out.
- Secondary growth (removed from rationalised NCERT, and in no current syllabus) and the old NCERT chapter
  "Strategies for Enhancement in Food Production" are left out because no listed exam requires them. Apiculture
  and sericulture are covered under Economic Importance of Animals, and tissue culture has its own chapter.
- The "Sex determination in plants" part of RPSC is folded into the NCERT `sex_determination` topic as an alias,
  rather than given a separate node.
