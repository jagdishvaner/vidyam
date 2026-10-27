import type { SyllabusNodeImport } from "@vidyam/contracts";

export const LEVELS = ["subject", "unit", "chapter", "topic", "subtopic"] as const;
export type Level = (typeof LEVELS)[number];

/** A child sits deeper than its parent; levels may be skipped (a subject without units goes straight to chapters). */
export function canNest(parent: Level | null, child: Level): boolean {
  if (parent === null) return child === "subject";
  return LEVELS.indexOf(child) > LEVELS.indexOf(parent);
}

export interface FlatNode {
  path: string;
  parentPath: string | null;
  code: string;
  level: Level;
  nameEn: string;
  nameHi: string | null;
  aliases: string[];
  objectives: string[];
  sortOrder: number;
}

/** The tree in reading order (parents before children), each node with its code path; or what is wrong with it. */
export function flattenTree(root: SyllabusNodeImport): { nodes: FlatNode[]; problems: string[] } {
  const nodes: FlatNode[] = [];
  const problems: string[] = [];
  const visit = (node: SyllabusNodeImport, parent: FlatNode | null, sortOrder: number) => {
    const path = parent ? `${parent.path}/${node.code}` : node.code;
    if (!canNest(parent?.level ?? null, node.level)) {
      problems.push(`${path}: a ${node.level} can't sit under ${parent ? `a ${parent.level}` : "nothing"}`);
    }
    const flat: FlatNode = {
      path,
      parentPath: parent?.path ?? null,
      code: node.code,
      level: node.level,
      nameEn: node.nameEn,
      nameHi: node.nameHi,
      aliases: node.aliases,
      objectives: node.objectives,
      sortOrder,
    };
    nodes.push(flat);
    const seen = new Set<string>();
    node.children.forEach((child, i) => {
      if (seen.has(child.code)) problems.push(`${path}/${child.code}: the same code appears twice here`);
      seen.add(child.code);
      visit(child, flat, i);
    });
  };
  visit(root, null, 0);
  return { nodes, problems };
}
