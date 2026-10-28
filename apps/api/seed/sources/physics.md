# Physics syllabus: sources and judgement calls

Built 27 Oct 2026. The tree is in `syllabi/physics.json` (1 subject, 26 units, 105 chapters, 500 topics) and the exam links are in `coverage/physics.json`. Each topic was tagged with the exams that cover it. Each exam then links the highest node whose topics it covers in full.

## Primary sources

| Exam                                                 | Document                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JEE Main Paper 1                                     | NTA, _Syllabus for JEE (Main) 2026_, linked from https://jeemain.nta.nic.in/syllabus/ : https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2025/10/202510311323551056.pdf (Physics Units 1–20, with 18 experiments in Unit 20)                                                                                                                            |
| NEET-UG                                              | NMC UGMEB public notice of 22 Dec 2025, _Syllabus for NEET (UG) 2026_, linked from https://neet.nta.nic.in : https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/01/202601081066816297.pdf. The physics text matches the 2025 syllabus.                                                                                                               |
| RPSC School Lecturer (School Edu.), Physics Paper II | RPSC syllabus dated 19 Sep 2025: https://rpsc.rajasthan.gov.in/Static/Syllabus/9B2B6D0F-1A2F-423F-8FBB-E2D81F895E82.pdf. It has four parts: I Senior Secondary, II Graduation, III Post-Graduation, IV Pedagogy/ICT. It has 150 MCQs and 300 marks, and states no marks for each part. The 2024 version (…/1C8BDF22-8FED-4D2C-B109-810BF969E936.pdf) is word-for-word the same. |
| CBSE Class 12                                        | CBSE curriculum 2026-27, Physics (042): https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart2/Physics_SecP2_2026-27.pdf                                                                                                                                                                                                                                            |
| RBSE Class 12                                        | BSER Ajmer syllabus for session 2026-27 (exam 2027), class 12, Physics (subject code 40), pp. 119–124 of https://rajeduboard.rajasthan.gov.in/anudeshika-etc/12_2027.pdf. The PDF uses the Kruti Dev font; its Hindi was converted for reading.                                                                                                                                 |
| NCERT                                                | Physics Part I/II for classes 11 and 12 (rationalised editions). The chapter boundaries and Hindi chapter titles follow these books, as the CBSE and RBSE syllabi list them.                                                                                                                                                                                                    |

## Structure

- **School units:** 13 units covering NCERT classes 11–12, with one chapter per NCERT chapter. A 14th chapter, _Communication Systems_, comes from the older NCERT book because RPSC still asks it. These units are measurement, mechanics, properties_of_matter, thermodynamics_and_kinetic_theory, oscillations_and_waves, electrostatics, current_electricity, magnetism, electromagnetic_induction_and_ac, electromagnetic_waves, optics, modern_physics and electronic_devices.
- **experimental_skills:** the 18 JEE/NEET experiments, plus the CBSE and RBSE class 12 practical lists (experiments and activities). These are grouped by area.
- **Graduation and post-graduation units:** these appear in RPSC Paper II only, so no school exam links them. They are grouped by subject area, not by level: mathematical_physics, classical_mechanics, vibrations_waves_acoustics, electromagnetic_theory, thermal_and_statistical_physics, electronics, physical_optics, quantum_mechanics, atomic_and_molecular_physics, nuclear_and_particle_physics and solid_state_physics. Graduation and PG items sit in separate chapters, for example _lagrangian_hamiltonian_mechanics_ and _statistical_ensembles_ are PG.
- **physics_pedagogy:** RPSC Part IV (pedagogy, teaching-learning material and ICT). It is in this tree because the catalog gives `rpsc_1g_p2_physics` only the physics subject. It overlaps in theme with `educational_psychology`.

## Judgement calls

1. **Older NCERT topics kept as separate topics.** RPSC Part I still lists topics that the rationalised NCERT books dropped. These are kept as their own topics, so JEE, NEET, CBSE and RBSE don't link them:
   - potentiometer
   - colour code of resistors
   - toroid
   - hysteresis
   - Doppler effect
   - Reynolds number
   - Newton's law of cooling
   - dispersion and scattering
   - the eye
   - resolving power
   - Davisson–Germer experiment
   - nuclear reactor
   - transistor
   - communication systems
2. **JEE and NEET (identical physics coverage)**
   - **Not linked:** these topics are absent from the 2026 syllabus text:
     - Poisson's ratio and elastic energy
     - applications of elasticity
     - Reynolds number
     - Newton's cooling
     - Doppler effect
     - colour code
     - potentiometer
     - toroid
     - Gauss's law for magnetism
     - hysteresis
     - dispersion and scattering
     - the eye
     - resolving power
     - Davisson–Germer experiment
     - radioactivity
     - nuclear reactor
     - transistor
     - communication systems
   - **Linked although JEE does not name them:** these are NCERT sections inside the listed lines:
     - the vector topics of _Motion in a Plane_. NEET lists them; JEE lists vector algebra under Mathematics.
     - rolling motion, under "rigid body rotation"
     - heat engines and the Carnot engine, under "second law: reversible and irreversible processes"
     - electron emission and work function
3. **CBSE 2026-27 class 12:** the theory topics left out are:
   - series and parallel combination of resistors
   - metre bridge (it stays as a practical)
   - eddy currents
   - Gauss's law for magnetism
   - polarisation
   - radioactivity
   - Zener, optoelectronic devices and logic gates

   Topics that appear in the NCERT text but not in the CBSE outline are linked, because CBSE prescribes the NCERT book minus its marked exclusions. These are motional emf, atomic spectra and de Broglie's explanation of Bohr's postulate.

4. **RBSE 2026-27 class 12:** it follows the NCERT rationalised chapters. Unlike CBSE, it keeps polarisation, Gauss's law for magnetism and radioactivity. Like CBSE, it leaves out resistor combinations, metre bridge (theory), eddy currents and the special-purpose diodes. Its practical list also includes potentiometer experiments, the Zener diode curve and common-emitter (CE) transistor characteristics.
5. **CBSE and RBSE:** only class 12 nodes are linked, including the class 12 practical experiments. Class 11 experiments are linked for JEE and NEET only.
6. **RPSC Part I** ("senior secondary level") is taken to cover all school-level theory. This includes the _Atoms_ chapter, which the RPSC text does not name, so every school unit is linked whole. The brief described the paper as going to graduation level, but the official 2025 syllabus also has a Part III at post-graduation level. Part III is included. RPSC does not link experimental_skills.
7. **Topic granularity for Parts II and III:** the RPSC graduation and PG line items are terse. Each item became a chapter, with 2–6 standard sub-topics. One example: "special functions" became gamma/beta, Legendre, Bessel, and Hermite/Laguerre.
8. **Earth's magnetism** is left out. It is not in any current syllabus for the linked exams.
9. **Weightage is not set on any link.**
   - JEE, NEET and RPSC state no marks for each part.
   - CBSE gives marks for pairs of units.
   - RBSE gives marks for each chapter, but several chapters are only partly covered, so they are linked topic by topic and the chapter marks cannot sit on one link.

   The official marks are below so they can go into paper patterns:
   - **CBSE 2026-27, theory 70 marks:**

     | Units                                | Marks |
     | ------------------------------------ | ----- |
     | Electrostatics + Current Electricity | 16    |
     | Magnetic Effects + EMI & AC          | 17    |
     | EM Waves + Optics                    | 18    |
     | Dual Nature + Atoms & Nuclei         | 12    |
     | Electronic Devices                   | 7     |

     The practical exam is 30 marks.

   - **RBSE 2026-27, theory paper 56 marks:** the theory total is 70, of which 14 are sessional; the practical exam is 30 marks. Marks for each chapter:

     | Chapter                         | Marks |
     | ------------------------------- | ----- |
     | 1. Electric Charges and Fields  | 4     |
     | 2. Potential and Capacitance    | 3     |
     | 3. Current Electricity          | 3     |
     | 4. Moving Charges and Magnetism | 5     |
     | 5. Magnetism and Matter         | 3     |
     | 6. EMI                          | 4     |
     | 7. AC                           | 5     |
     | 8. EM Waves                     | 2     |
     | 9. Ray Optics                   | 6     |
     | 10. Wave Optics                 | 5     |
     | 11. Dual Nature                 | 4     |
     | 12. Atoms                       | 4     |
     | 13. Nuclei                      | 2     |
     | 14. Semiconductor Electronics   | 6     |

10. **Hindi names**
    - **Chapter titles:** taken from the NCERT Hindi-medium books.
    - **School-level topics:** use NCERT and RBSE Hindi terms, such as अपद्रव्यी अर्धचालक, अग्रदिशिक बायस, कला-संबद्ध योग and विस्पंद.
    - **Graduation, PG and pedagogy terms:** use standard CSTT usage.
    - **Worth a teacher's review:** a few are best-effort, namely स्वर-संस्करण (temperament), चार-टर्मिनल नेटवर्क, कर्तन एवं परिबंधन परिपथ (clipping/clamping) and गुणता गुणांक (Q-factor, graduation unit).
