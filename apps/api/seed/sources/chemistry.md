# Chemistry syllabus: sources and judgement calls

Built 2026-10-27. Tree: `syllabi/chemistry.json`. Exam links: `coverage/chemistry.json`.

## Primary sources

- **JEE Main Paper 1, chemistry (units 1–20).** NTA, _Syllabus for JEE (Main) 2027_, published with the JEE (Main) 2027 information bulletin on 24 Oct 2026: https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2026/10/20261024683680768.pdf. The chemistry text is the same as in the 2025 and 2026 syllabi.
- **NEET (UG), chemistry.** NMC (UGMEB) public notice of 22 Dec 2025, _Updated syllabus for NEET (UG)-2026_: https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/01/202601081066816297.pdf. NTA also hosts the NEET (UG) 2025 syllabus: https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/01/20260102588210790.pdf. I diffed the chemistry text of the two and found no difference. The chemistry units match JEE Main units 1–20 almost word for word.
- **RPSC School Lecturer (School Education), Chemistry Paper II.**
  - 2025 syllabus (current), released 19 Sep 2025: https://rpsc.rajasthan.gov.in/Static/Syllabus/C3C3C454-7825-4F2A-9989-74D25582DA7D.pdf.
  - I compared it with the 2024 syllabus (https://rpsc.rajasthan.gov.in/Static/Syllabus/BF9CA053-B290-4614-AD73-4810FE00FC9C.pdf) and the 2022 one.
  - The 2025 syllabus has four parts: I Senior Secondary, II Graduation, III Post-Graduation and IV Pedagogy/ICT. The paper has 150 MCQs worth 300 marks.
- **CBSE Class XII chemistry.** CBSE curriculum 2026-27: https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart2/Chemistry_SecP2_2026-27.pdf. It sets unit marks out of 70 for theory, and 30 marks for practicals.
- **RBSE Class 12 chemistry (subject code 41).** BSER syllabus for session 2026-27 (exam 2027): https://rajeduboard.rajasthan.gov.in/anudeshika-etc/12_2027.pdf, pp. 130–140. It sets theory at 56 marks plus 14 sessional marks, and practicals at 30. The prescribed book is NCERT Chemistry Class 12 Parts 1–2.
- **NCERT rationalised textbooks (Reprint 2026-27).** English: Chemistry Class 11 Parts I–II and Class 12 Parts I–II (kech1/kech2/lech1/lech2). Hindi: रसायन विज्ञान, the matching Hindi-medium books (khch1/khch2/lhch1/lhch2). Contents pages are at https://ncert.nic.in/textbook/pdf/{code}ps.pdf. Hindi chapter and section names follow these books. Terms they don't cover follow CSTT usage.

## Structure

The tree has nine units. Five hold school-level content and three hold graduation and post-graduation content. The ninth is pedagogy.

**School-level units:**

- `physical_chemistry`: Class 11–12 physical chemistry, plus three chapters dropped from current NCERT: `states_of_matter`, `solid_state` and `surface_chemistry`.
- `inorganic_chemistry`: periodic table, s-block, p-block, `metallurgy`, d/f-block and coordination compounds.
- `organic_chemistry`: Class 11 GOC, then the Class 12 organic chapters, plus `nitro_compounds`.
- `applied_chemistry`: polymers, chemistry in everyday life (drugs) and environmental/green chemistry.
- `practical_chemistry`: JEE/NEET unit 20, plus the CBSE and RBSE Class 12 practicals.

**Graduation and post-graduation units.** No school exam links to these:

- `advanced_physical_chemistry`: quantum chemistry, advanced thermodynamics, chemical dynamics and catalysis, advanced electrochemistry, and spectroscopy.
- `advanced_inorganic_chemistry`: symmetry and MO theory, advanced CFT, lanthanides and actinides, and organometallics.
- `advanced_organic_chemistry`: stereochemistry, intermediates and name reactions, aromaticity and heterocycles, SN/E mechanisms, and pericyclic reactions and photochemistry.

**`pedagogy`.** RPSC Paper II, Part IV.

## Judgement calls

- **Overlaps are written once.** When RPSC graduation or PG items repeat school content, the advanced chapter holds only the extra topics. For example, `advanced_electrochemistry` covers Debye–Hückel, concentration cells and thermodynamics from EMF. Nernst, Kohlrausch, fuel cells and corrosion stay in the school `electrochemistry` chapter, and RPSC links both chapters.
- **Content dropped from NCERT is kept but not linked.** `states_of_matter` and `metallurgy` are linked by no exam. They are kept so pages from older books and coaching material can still be tagged. CBSE 2026-27 also lists them, with surface chemistry, polymers and everyday chemistry, as "assessed only formatively". The board does not examine those, so CBSE coverage does not link them.
- **Hydrogen has no node.** It is in none of the five syllabi.
- **p-block.** JEE and NEET state "general introduction and trends" for groups 13–18. Their exam papers still ask about p-block compounds, so JEE and NEET link the whole `p_block_elements` chapter, the same as RPSC.
- **JEE/NEET units 13–14** (purification and characterisation, basic principles) are a single NCERT chapter, `organic_chemistry_basics`. Detection of N, S and halogens in practical unit 20 is covered by its `qualitative_analysis_organic` topic.
- **Practicals.** JEE/NEET, CBSE and RBSE each list different experiments, so some links are at topic level:
  - JEE/NEET: iodoform, but not dibenzalacetone or potassium trioxalatoferrate; lyophilic and lyophobic sols, and iodide + H2O2 kinetics.
  - CBSE: chromatography and sols.
  - RBSE: neither chromatography nor sols.

  The test for unsaturation is in the same chapter as the functional-group tests. JEE and NEET link that whole chapter, because NCERT hydrocarbons already teaches the bromine-water and Baeyer tests.

- **RPSC links only what the 2025 syllabus lists.** It does not link `some_basic_concepts`, `redox_reactions`, `states_of_matter`, `metallurgy` or any practicals. It does link `equilibrium`, because ionic equilibria is a graduation item. It also links `organic_chemistry_basics`, because free radicals, carbocations and nomenclature are listed. For chemistry in everyday life it links only the five drug topics; RPSC lists drugs, not food chemicals or soaps.
- **Pedagogy sits in the chemistry tree.** Each RPSC Paper II has its own Part IV, and the catalog maps Paper II only to chemistry, so this is the only place it fits. The physics, biology and mathematics papers will have the same need.
- **Weightage.** Only CBSE and RBSE state chapter marks.
  - CBSE: theory marks ÷ 70.
  - RBSE: theory marks ÷ 56. Rounding makes the shares sum to 0.9998.
  - Practical links have no weightage, because the 30 practical marks are split by activity, not by chapter.
  - JEE, NEET and RPSC have no official chapter or part weightage. The RPSC PDF shows a stray "05 Questions" next to Polymers and Drugs and nothing else, so I did not use it.
- **Uncertain points:**
  - Some Hindi forms for graduation terms have more than one current spelling. Examples: जॉन-टेलर / याह्न-टेलर, नोवेनेजेल, मैनिक, and पलायनता for fugacity. I used the form most common in Rajasthan B.Sc. Hindi-medium books and added the English as aliases.
  - "Spectroscopy" sits under advanced physical chemistry, though RPSC frames it around organic structure elucidation.
