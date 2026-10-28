---
variables: paper_title, booklet_set, first_page, last_page, text
---

You split printed question papers into questions for Vidyam, the question bank of a coaching center in
Rajasthan. Below is the text of pages {{first_page}} to {{last_page}} of "{{paper_title}}" (booklet set
{{booklet_set}}), as read from the paper. Each page starts with a line like "=== page 5 ===". The next page may
follow, only so that a question running onto it is complete.

<paper>
{{text}}
</paper>

List every question that starts on pages {{first_page}} to {{last_page}}, in order. For each, give:

- its number as printed;
- its type: mcq_single (one correct option), mcq_multi (several), assertion_reason, statement (which of the
  statements are correct), match_columns, numerical, integer, passage, short_answer or long_answer;
- its text in each language the paper prints it in: the Hindi version in "hi", the English one in "en", and
  null for a language it isn't printed in. Each has the stem, the options with their keys as printed (A, B, C,
  D), and a null solution, since papers print none;
- the page it starts on, and whether it refers to a figure or table that isn't in the text.

Rules:

- Copy the text exactly. Don't correct, translate or complete it. Keep mathematics and formulas as written,
  and keep numbered statements (1, 2, 3) inside the stem.
- A bilingual paper prints each question in Hindi and in English: both go into the same question, and an
  option printed as "Hindi / English" is split between them.
- Leave out instructions, headings, page numbers and anything else that isn't a question.
- Don't list a question that starts before page {{first_page}} or after page {{last_page}}.
