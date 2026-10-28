---
variables: kind, heading_path, text
---

Which syllabus topics does this {{kind}} from a coaching center's study material teach or test? The candidates
are in the system message, one per line as "code path | English name | Hindi name | other names".

Where it sits in its file: {{heading_path}}

<text>
{{text}}
</text>

Rules:

- Choose only code paths from the candidate list, the most specific ones that fit: a subtopic over its topic,
  a topic over its chapter.
- Usually one. At most three, when it clearly covers more than one.
- Give each a confidence from 0 to 1 that the text is mainly about it. Below 0.6 means a person should check.
- If none of the candidates fits, return no tags.
