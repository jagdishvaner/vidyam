# Paper patterns (blueprints.json): sources and judgement calls

Checked on 27 October 2026. `blueprints.json` has 60 patterns:

- one "Full paper" for each of the 21 objective exam papers;
- one "Chapter test" for each of those 21 papers;
- 18 board-exam patterns named "Full paper — <Subject>": CBSE Class 10 (5), CBSE Class 12 science (4), RBSE Class 10 (5) and RBSE Class 12 science (4).

Section `scope` uses only subject root codes from `catalog.json`. A scope of `[]` means "the whole paper's syllabus". Every section uses the difficulty mix 0.3 / 0.5 / 0.2, except JEE Main, which uses 0.2 / 0.5 / 0.3. `negativeMarks` is the number of marks deducted for each wrong answer: 0.67 is one-third of 2 marks, and 0.83 is one-third of 2.5 marks.

Totals were checked with a script against the official figures and all match. For papers with "attempt any N" sections, marks are counted as N × marks.

## RPSC Senior Teacher (2nd Grade): `rpsc_2g_*`

**Paper I** (`rpsc_2g_paper_1`): 100 MCQs, 200 marks, 2 hours, one-third negative marking.

- Source: RPSC syllabus PDF for the current Paper I (it includes "Development of 21st Century skills"): https://rpsc.rajasthan.gov.in/Static/Syllabus/0146A331-A4EE-4F82-A9EF-5A7A7CF7760A.pdf. The earlier version has the same scheme: https://rpsc.rajasthan.gov.in/Static/Syllabus/20C468B8-5BC7-4809-BEFC-5B4E0FFFA9D9.pdf
- **Judgement call:** RPSC lists the four parts of the paper but does not say how many questions each part gets. We used the split that coaching material uses (for example PW and Utkarsh pages for the Senior Teacher exam):
  - Rajasthan GK: 40 questions, scope `rajasthan_gk`;
  - Current affairs of Rajasthan: 10 questions, scope `rajasthan_gk`;
  - World and India GK: 30 questions, scope `general_studies`;
  - Educational psychology: 20 questions, scope `educational_psychology`.

**Paper II** (science, mathematics, social science, Hindi, English): 150 MCQs, 300 marks, 2 hours 30 minutes, one-third negative marking. All questions carry equal marks.

- Parts, from the scheme in the RPSC Paper II Mathematics PDF (https://rpsc.rajasthan.gov.in/Static/Syllabus/A4BDD211-AD76-4467-9D9E-C5C9952E4697.pdf):
  - secondary and senior secondary standard: 180 marks (90 questions);
  - graduation standard: 80 marks (40 questions);
  - teaching methods: 40 marks (20 questions).
- A newer Paper II PDF (Urdu, https://rpsc.rajasthan.gov.in/Static/Syllabus/A5AF9663-C9FC-4A91-9485-04750C7203B9.pdf) has the same totals, time and parts, but does not show marks per part. We applied the 180/80/40 split to every subject.
- The parts are separated by level, not by subject, so the sections have scope `[]`.

## RPSC School Lecturer (1st Grade): `rpsc_1g_*`

**Paper I** (`rpsc_1g_paper_1`): 75 MCQs, 150 marks, 1 hour 30 minutes, one-third negative marking.

- Source: current RPSC syllabus PDF. Part (v) of this version adds educational psychology and NEP 2020: https://rpsc.rajasthan.gov.in/Static/Syllabus/02AA4D5B-0F0E-4D30-BC17-A4048A8263F3.pdf. Older version: https://rpsc.rajasthan.gov.in/Static/Syllabus/B25F7B65-60C3-4AD5-9D48-70F132102422.pdf
- **Judgement call:** RPSC lists five parts but no question counts for them. We used the split that coaching sources use (for example https://rrbapply.com/rpsc-school-lecturer-syllabus/ and Careers360): 15 / 20 / 10 / 15 / 15.
- Mental ability, statistics, maths and the language test (Hindi and English) all draw on `general_studies`. This is because the catalogue gives this paper only `rajasthan_gk`, `general_studies` and `educational_psychology`.
- The education part (educational psychology, educational management, the educational scenario in Rajasthan, NEP 2020 and the RTE Act) is scoped to `educational_psychology` plus `general_studies`. That way, management and RTE topics can still be found even if they end up in the general studies tree.

**Paper II** (physics, chemistry, biology, mathematics, Hindi, English): 150 MCQs, 300 marks, 3 hours, one-third negative marking. "Wrong answer" includes marking more than one option.

- Scheme table in the RPSC Paper II Physics PDF: https://rpsc.rajasthan.gov.in/Static/Syllabus/D2356B4D-5118-4DB9-BCB5-4E8158FF9A6C.pdf
  - senior secondary level: 55 questions;
  - graduation level: 55 questions;
  - post-graduation level: 10 questions;
  - educational psychology, pedagogy, teaching-learning material and ICT: 30 questions.
- The table is headed "Subject Concerned", so we used it for every subject.
- The 30 pedagogy questions have scope `[]`. The checker only allows a paper's own subject roots, and these papers have only the one subject.

**RPSC fifth-option rule:** this goes in the instructions of every RPSC pattern. It comes from an RPSC Secretary statement of 29 August 2023, as reported by Drishti IAS: https://www.drishtiias.com/hindi/printpdf/rpsc-10-minutes-extra-time-will-be-given-in-the-examinations-conducted-by-the-commission. The rule:

- every question has five options;
- a candidate who does not want to answer must fill option 5;
- a question with no option filled loses one-third of its marks;
- a candidate who fills no option in more than 10% of the questions is disqualified;
- candidates get 10 extra minutes to fill the OMR sheet.

`durationMinutes` keeps the official paper time and leaves out these 10 minutes.

We did not add a line saying which language version (Hindi or English) is authoritative. We could not confirm RPSC's wording on this.

## REET (Rajasthan Eligibility Examination for Teachers): `reet_*`

- **Pattern:** the current one is from REET 2024, held on 27–28 February 2025. No REET 2026 notification had been issued as of 27 October 2026.
- **Source:** the Level 1 question booklet cover, via a Scribd copy: https://www.scribd.com/document/841218539/REET-L-1-Paper-2025. It says:
  - 150 MCQs in five sections of 30;
  - 1 mark each, 150 marks in all;
  - 2 hours 30 minutes;
  - "No marks will be deducted for wrong answers".
- **Unanswered questions:** the booklet sends candidates to point 4 on its last page, which we could not read. BSER's rule, as reported by Adda247 (https://www.adda247.com/teaching-jobs-exam/bser-introduces-5th-option-in-reet-exam-2025/) and others: five options per question; a question where none of them is filled loses one-third of its marks.
  - We put this rule in the instructions but kept `negativeMarks` at 0, because wrong answers are not penalised.
  - Some news sites (for example Careers360) also report a one-third deduction for wrong answers. The booklet itself says there is none, so we did not follow them.
  - A 10% disqualification rule like RPSC's is reported only by coaching sites, so we left it out.
- **Language I and II:** candidates choose these languages. We used Language I = Hindi and Language II = English, the usual choice and the only languages in the catalogue.
- **Level 2, Science and Mathematics:** the 60-question block is split into Mathematics 30 and Science 30, as in REET 2022 and REET 2024.
- **Level 2, Social Studies:** 60 questions with scope `social_science`.

## JEE Main Paper 1: `jee_main_paper_1`

- **Source:** NTA, JEE (Main) 2027 Information Bulletin, released 24 October 2026: https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2026/10/202610241890224107.pdf. Public notice of the same date: https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2026/10/20261024390682350.pdf
- **Pattern:** Mathematics, Physics and Chemistry, each with Section A (20 MCQs) and Section B (5 numerical-value questions). That gives 75 questions and 300 marks in 3 hours. There are no optional questions.
- **Marking:** +4 / −1 in both sections. Negative marking applies to Section B as well.
- **Judgement call:** Section B uses `qtype` `integer`, not `numerical`. The bulletin says candidates enter "the correct integer value" and the answer "should be rounded off to the nearest integer".
- Subjects are in the bulletin's order: Mathematics, Physics, Chemistry.

## NEET (UG): `neet_ug`

- **Source:** NTA, NEET (UG) 2026 Information Bulletin: https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/02/202602231394640855.pdf. This follows the NMC letter of 5 December 2025.
- **Pattern:** 180 compulsory MCQs (Physics 45, Chemistry 45, Biology 90), 720 marks, 180 minutes, +4 / −1. The paper is on pen and paper, in one shift.
- Biology is split into Botany 45 and Zoology 45, as printed in the paper. Both are scoped to `biology`.
- The NEET (UG) 2027 bulletin is not out yet.
- The NEET (UG) 2026 exam of 3 May 2026 was cancelled and held again on 21 June 2026. The pattern did not change.

## UPSC Civil Services (Preliminary): `upsc_cse_prelims_*`

- **Source:** CSE 2026 notification: https://www.upsc.gov.in/sites/default/files/Notif-CSP-2026-Engl-060226Rev.pdf
  - two objective papers of 200 marks each, 2 hours each;
  - GS Paper II is qualifying at 33%;
  - one-third (0.33) of a question's marks is deducted per wrong answer, and more than one answer counts as wrong;
  - there is no penalty for a question left blank.
- **Question counts:** 100 items × 2 marks for GS I and 80 items × 2.5 marks for CSAT. These come from the question papers; the notification does not state them.
- **GS Paper I:** kept as one MCQ section, as officially set. Many items are "consider the following statements" questions, but UPSC does not fix how many.
- **CSAT, judgement call:** UPSC does not split the paper by area. We used the CSAT 2025 distribution reported by Vision IAS (https://visionias.in/blog/csat-maths/upsc-prelims-csat-2026-detailed-analysis-of-paper-2-with-answer-key):
  - comprehension: 29, scope `english`;
  - logical reasoning and analytical ability: 20, scope `reasoning`;
  - basic numeracy and data interpretation: 31, scope `quantitative_aptitude`.
  - Other analyses give 29 / 17 / 34. The split changes from year to year.

## SSC CGL Tier 1: `ssc_cgl_tier_1`

- **Source:** SSC CGL 2026 notice, §13.8: https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_cgl_2026.pdf
- **Pattern:** four sections of 25 questions, 50 marks each:
  - General Intelligence and Reasoning, scope `reasoning`;
  - General Awareness, scope `general_studies`;
  - Quantitative Aptitude, scope `quantitative_aptitude`;
  - English Comprehension, scope `english`.
- 1 hour in all, with a 15-minute sectional timer per section.
- 0.50 marks are deducted per wrong answer.

## CBSE: `cbse_class_10`, `cbse_class_12_science` (2026-27 sample question papers)

- **Sources:**
  - Class X list: https://cbseacademic.nic.in/SQP_CLASSX_2026-27.html
  - Class XII list: https://cbseacademic.nic.in/SQP_CLASSXII_2026-27.html
  - Every paper is marked "There is no change in the Question Paper Design and Assessment Pattern for Academic Session 2026-27".
- **Class X papers used:** Science (086), Mathematics Standard (041), Social Science (087), Hindi Course A (002) and English Language & Literature (184).
- **Class XII papers used:** Physics (042), Chemistry (043), Biology (044) and Mathematics (041).

**Class X**

- **Science:** 39 questions, 80 marks.
  - The paper is split by discipline: Section A Biology (Q1–16, 30 marks), Section B Chemistry (Q17–29, 25 marks), Section C Physics (Q30–39, 25 marks).
  - We counted each part's question types from the paper itself: MCQs, assertion–reason, 2-mark, 3-mark, one 4-mark case-based question and one 5-mark question.
  - All parts are scoped to `science`.
- **Mathematics:** 38 questions, 80 marks.
  - A: 18 MCQ + 2 assertion–reason (1 mark each);
  - B: 5 × 2;
  - C: 6 × 3;
  - D: 4 × 5;
  - E: 3 case-based × 4.
- **Social Science:** 38 questions in four sections of 20 marks (History, Geography, Political Science, Economics). We counted each section's types from the 2026-27 paper.
  - Map questions are Q9 in History (2 marks) and Q19 in Geography (3 marks), modelled as `short_answer`.
- **Hindi A:** 15 questions in four sections: 14, 16, 30 and 20 marks.
  - Grammar has four questions of "any 4 of 5" (`attemptAny` 4).
  - The textbook questions are "any 3 of 4" and "any 2 of 3".
  - Paragraph writing is "one of 3 topics".
- **English:** 11 questions.
  - Section A: two 10-mark passages.
  - Grammar: any 10 of 12 tasks.
  - Letter and analytical paragraph: 5 marks each.
  - Q6 and Q7: each is one of two extracts, 5 marks.
  - Q8: any 4 of 5 × 3 marks.
  - Q9: any 2 of 3 × 3 marks.
  - Q10 and Q11: each is one of two questions, 6 marks.

**Class XII**

- **Physics, Chemistry, Biology:** 33 questions, 70 marks.
  - A: 12 MCQ + 4 assertion–reason;
  - B: 5 × 2;
  - C: 7 × 3;
  - D: 2 case-based × 4;
  - E: 3 × 5.
- **Mathematics:** 38 questions, 80 marks, with the same section design as Class X Mathematics.

**Modelling choices**

- `passage` means one case, source or extract block with sub-questions. `count` is the number of blocks and `marksEach` is the marks per block.
- Both 2-mark and 3-mark answers are `short_answer`. Answers of 4 marks and more are `long_answer`, except case-based blocks, which are `passage`.
- CBSE "internal choice" (A or B for the same question) is not "attempt any N", so it is not modelled. The instructions mention it instead.
- Where the paper says "any N of M", the section has `count` M and `attemptAny` N.
- Duration is 180 minutes. CBSE's separate reading time is not included.

## RBSE / BSER: `rbse_class_10`, `rbse_class_12_science`

**Class 10** follows the official BSER 2026-27 secondary model question paper. Source: https://rajeduboard.rajasthan.gov.in/books/MODALPAPER2027/sec_model2027.pdf, listed at https://rajeduboard.rajasthan.gov.in/books/model27.htm. The "प्रश्नों के प्रकार व अंकभार" (question types and marks) tables in that file give these designs. Every paper is 80 marks and 3 hours 15 minutes (195 minutes, which includes 15 minutes for reading the paper).

| Subject        | Questions | Objective | 2-mark | 3-mark | 4-mark | 5-mark | 6-mark |
| -------------- | --------- | --------- | ------ | ------ | ------ | ------ | ------ |
| Science        | 40        | 20 × 1    | 8      | 8      | —      | 4      | —      |
| Mathematics    | 40        | 20 × 1    | 8      | 8      | —      | 4      | —      |
| Social Science | 37        | 16 × 1    | 8      | 8      | 3      | —      | 2      |
| Hindi          | 36        | 16 × 1    | 6      | 8      | 4      | —      | 2      |
| English        | 36        | 16 × 1    | 6      | 8      | 4      | —      | 2      |

- In Social Science, the two 6-mark questions are one essay and one map question (Q37: mark 6 of 12 places on an India outline map).
- Question numbers for Mathematics come from its model-paper instructions.
- We split the types further by reading the model papers themselves:
  - Hindi: 10 MCQ + 6 fill-in-the-blank; four unseen passages at 3 marks each; two case studies (4 and 6 marks).
  - English: a 10-mark unseen passage with MCQs, a 10-mark case-based factual passage, 6 grammar MCQs, letter, paragraph and story writing, and extract-based questions.
- BSER tells paper-setters to include at least two case-based questions. In Science we modelled two of the eight 3-mark questions as `passage` blocks.
- The text of the BSER files is in Kruti Dev font encoding. We decoded it by hand, so please check the sub-type splits against the PDF if anything looks off.

**Class 12 science** follows the latest published senior secondary science model paper, which is for the 2025-26 session (2026 exam): https://rajeduboard.rajasthan.gov.in/books/MODALPAPER2026/srsecscience2026.pdf. A 2027 senior secondary model paper had not been published as of 27 October 2026.

- **Physics, Chemistry, Biology:** 56-mark theory paper, 3 hours 15 minutes. These marks are confirmed by the 2026-27 syllabus (https://rajeduboard.rajasthan.gov.in/anudeshika-etc/12_2027.pdf), which gives 56 theory, 14 sessional and 30 practical. The paper has 53 questions:
  - MCQ: 18 × ½
  - fill in the blanks: 10 × ½
  - very short answer: 10 × 1
  - short answer: 10 × 1½
  - long answer: 3 × 3
  - essay-type: 2 × 4
- **Mathematics:** 80 marks, 53 questions:
  - MCQ: 18 × 1
  - fill in the blanks: 6 × 1
  - very short answer: 12 × 1
  - short answer: 10 × 2
  - long answer: 4 × 3
  - essay-type: 3 × 4
- **Section letters**, following BSER: अ = objective, fill-in and very short answer; ब = short answer; स = long answer; द = essay-type.
- There is an internal choice in sections स and द.
- **Possible change:** for 2026-27, BSER moved Class 10 to a new design of objective, 2-, 3-, 4/5- and 6-mark questions. Class 12 may follow when the 2027 senior secondary model papers come out. Recheck these four patterns then.

## Chapter tests

Each of the 21 objective papers has a "Chapter test":

- 25 `mcq_single` questions in one section, scope `[]`, 30 minutes;
- the same marks and negative marking as the official paper:

| Papers         | Marks per question | Negative marks                                           |
| -------------- | ------------------ | -------------------------------------------------------- |
| RPSC           | 2                  | 0.67, and the instructions include the fifth-option rule |
| REET           | 1                  | 0, and the instructions include the blank-answer rule    |
| JEE Main, NEET | 4                  | 1                                                        |
| UPSC GS I      | 2                  | 0.67                                                     |
| UPSC CSAT      | 2.5                | 0.83                                                     |
| SSC CGL        | 2                  | 0.5                                                      |

For JEE, the chapter test uses only MCQs, which is the paper's main question type.
