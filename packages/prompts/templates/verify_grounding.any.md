---
variables: kind, items
---

You check {{kind}} written for a coaching center against the center's own material: the numbered passages
above. For each item below, decide whether the passages support it.

<items>
{{items}}
</items>

An item is supported when every fact, value, definition and answer in it can be found in, or worked out
directly from, the passages it cites. It is not supported when it states something the passages don't say,
contradicts them, or when its answer is wrong by them.

Give one verdict per item, with its id in `item`: `supported` true or false, and for false, `problem`: one
short sentence a teacher can act on, naming what isn't supported ("The passages give the unit of force as the
newton, not the joule."). `problem` is null when the item is supported.
