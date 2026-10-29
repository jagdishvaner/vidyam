---
variables: question
---

Solve this exam question as a careful teacher would, working it out before you answer. You aren't told the
expected answer; give your own. The question was written from the passages of the center's material above,
when there are any: where it turns on a fact or definition, they decide.

<question>
{{question}}
</question>

Answer with:

- `working`: your reasoning, briefly.
- `keys`: the key of the correct option (several only if the question says more than one can be correct);
  empty when the question has no options.
- `value`: for a question whose answer is a number, that number in the unit the question asks for; null
  otherwise.

If the question is ambiguous, has no correct option or more than one, say so in `working` and give the keys
you would accept.
