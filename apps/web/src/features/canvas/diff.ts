import type { DocumentContent, NotesDocument, PaperDocument } from "@vidyam/contracts";

/** What changed between two versions of a document, item by item. */
export interface Changes {
  title: boolean;
  /** Papers: slot ids; notes: node ids. */
  added: string[];
  removed: string[];
  /** A different question in the slot, or a section rewritten. */
  changed: string[];
  /** Marks or instructions changed. */
  details: string[];
  reordered: boolean;
}

function isPaper(content: DocumentContent): content is PaperDocument {
  return "slots" in content;
}

function compare<T>(before: Map<string, T>, after: Map<string, T>, same: (a: T, b: T) => boolean) {
  return {
    added: [...after.keys()].filter((id) => !before.has(id)),
    removed: [...before.keys()].filter((id) => !after.has(id)),
    changed: [...after.keys()].filter((id) => before.has(id) && !same(before.get(id)!, after.get(id)!)),
  };
}

function order(ids: string[], keep: Set<string>): string {
  return ids.filter((id) => keep.has(id)).join(",");
}

/** How `after` differs from `before`. Both must be the same kind of document. */
export function diff(before: DocumentContent, after: DocumentContent): Changes {
  const title = before.spec.title !== after.spec.title;
  if (isPaper(before) && isPaper(after)) {
    const a = new Map(before.slots.map((s) => [s.slotId, s]));
    const b = new Map(after.slots.map((s) => [s.slotId, s]));
    const { added, removed, changed } = compare(a, b, (x, y) => x.questionId === y.questionId);
    const details = [...b.keys()].filter((id) => a.has(id) && a.get(id)!.marks !== b.get(id)!.marks);
    const both = new Set([...a.keys()].filter((id) => b.has(id)));
    const instructions = before.sections.some(
      (s, n) => JSON.stringify(s.instructions) !== JSON.stringify(after.sections[n]?.instructions ?? null),
    );
    return {
      title,
      added,
      removed,
      changed,
      details: instructions ? [...details, "instructions"] : details,
      reordered:
        order(
          before.sections.flatMap((s) => s.slotIds),
          both,
        ) !==
        order(
          after.sections.flatMap((s) => s.slotIds),
          both,
        ),
    };
  }
  const a = new Map((before as NotesDocument).sections.map((s) => [s.nodeId, s]));
  const b = new Map((after as NotesDocument).sections.map((s) => [s.nodeId, s]));
  const { added, removed, changed } = compare(
    a,
    b,
    (x, y) => JSON.stringify(x.body) === JSON.stringify(y.body),
  );
  return { title, added, removed, changed, details: [], reordered: false };
}

export function unchanged(changes: Changes): boolean {
  return (
    !changes.title &&
    !changes.reordered &&
    [changes.added, changes.removed, changes.changed, changes.details].every((list) => list.length === 0)
  );
}
