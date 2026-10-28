# Sources: general_studies (General Studies)

## Official syllabi and patterns used

- **RPSC Senior Teacher (Sec. Edu.) 2025, Paper I G.K.**, section III "General Knowledge of World & India":
  https://rpsc.rajasthan.gov.in/Static/Syllabus/0146A331-A4EE-4F82-A9EF-5A7A7CF7760A.pdf. The 2024/2022 version,
  https://rpsc.rajasthan.gov.in/Static/Syllabus/20C468B8-5BC7-4809-BEFC-5B4E0FFFA9D9.pdf, adds the GoI Acts of
  1919/1935, political parties and pressure groups, India and the UNO, and globalisation. Those nodes are in the
  tree but are not linked for the 2025 paper.
- **RPSC School Lecturer (School Edu.) 2025, Paper I General Awareness and General Studies**:
  https://rpsc.rajasthan.gov.in/Static/Syllabus/02AA4D5B-0F0E-4D30-BC17-A4048A8263F3.pdf. The parts used are the
  Indian National Movement, current affairs (India and international), General Science and Indian Polity. The
  2024 version, https://rpsc.rajasthan.gov.in/Static/Syllabus/0926B7BD-DED5-40D2-92A9-24879A06BA1A.pdf, was also
  checked. It adds Gupta and Mughal literature, art and architecture, and space and atomic energy programmes.
- **UPSC CSE Preliminary, GS Paper I.** The official syllabus text is unchanged across recent notifications:
  current events; History of India and the Indian National Movement; Indian and World Geography; Indian Polity
  and Governance; Economic and Social Development; Environmental Ecology, Biodiversity and Climate Change;
  General Science. upsc.gov.in blocks automated fetching, so the text was checked against a verbatim reproduction
  (https://visionias.in/blog/prelims-syllabus/upsc-syllabus-2026). The 2026 notice is listed at
  https://www.upsc.gov.in/examinations/Civil%20Services%20%28Preliminary%29%20Examination%2C%202026.
- **SSC CGL 2025 notification, Tier-I.** It has four parts of 25 questions and 50 marks each, 100 questions in
  all, and General Awareness is one of them. The GA syllabus covers the environment and its application to
  society, current events, everyday science, and India and its neighbours (history, culture, geography, economic
  scene, general policy and scientific research). It was read from the notification copy at
  https://docs.aglasem.com/view/b7c61e92-8cb5-11f1-baaa-0aa932765c8b because ssc.gov.in was not reachable.

## Judgement calls

- **One tree for all four papers.** It has 15 units: ancient, medieval and modern history, the national
  movement, Indian art and culture, world and Indian geography, polity, international relations, economy,
  general science, science and technology, environment, current affairs (national and international), and
  static GK. Rajasthan-specific material lives in `rajasthan_gk`.
- **General Science** follows the School Lecturer list, which matches NCERT Class 9-10 chapters: atoms and
  molecules, chemical reactions, carbon compounds, laws of motion, work and energy, electricity, sound, tissues,
  control and coordination, and heredity and evolution. The science-in-daily-life, environment and S&T items are
  separate nodes. The rest of the physics, chemistry and biology topics are there for SSC and UPSC. "Traditional
  knowledge system of India in science" is a chapter under Science and Technology.
- **Weightage** is used only for SSC CGL Tier-I. The whole `general_studies` subject is linked with weightage
  0.25, because General Awareness is 25 of the 100 questions and everything in this tree falls within SSC GA's
  scope. UPSC and both RPSC papers publish no section shares, so they have none. The 80/20/60/40 split quoted
  by coaching sites for Senior Teacher is not in the official RPSC syllabus.
- **UPSC links** every unit except static GK, plus only the national, international and science/environment
  chapters of current affairs. Sports, awards and books are left out because the official syllabus does not
  list them. International relations is linked because prelims regularly tests international institutions and
  India's foreign relations under current events and polity.
- **Topic-level links** are used where an RPSC list names only part of a chapter. Examples are the Supreme Court,
  the Election Commission, the President/VP/PM/CoM (but not the Attorney General), and the global wind system
  and the human-occupation, population and migration topics.
- **Not covered here (catalog gap):** School Lecturer Paper I also has Mental Ability, Statistics, Secondary
  Mathematics and Language Ability (Hindi and English). The catalog does not list reasoning,
  quantitative_aptitude, hindi or english for `rpsc_1g_paper_1`, so those parts cannot be linked from any subject
  until the catalog changes. Educational Psychology, Management, the Scenario in Rajasthan and RTE are in
  `educational_psychology`.
- **Hindi names** follow NCERT Hindi-medium usage and the official Hindi text of the Constitution, for example
  समता का अधिकार, राज्य के नीति निदेशक तत्व, आपातकालीन उपबंध, नियंत्रक एवं महालेखापरीक्षक, वायुदाब पेटियाँ,
  आनुवंशिकता एवं जैव विकास and स्वस्थाने/बाह्यस्थाने संरक्षण. मौलिक अधिकार/कर्तव्य is used because RPSC papers use it.
