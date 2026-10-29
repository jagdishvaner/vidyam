import { createHash } from "node:crypto";

import type { ChatBlock, ChatTurnInput } from "@vidyam/contracts";

/**
 * A turn still unanswered after this long has lost its answer (the API restarted mid-turn, say). It is marked
 * failed when next looked at, so the chat can go on.
 */
export const TURN_TIMEOUT_MS = 5 * 60_000;

/** The Valkey stream a turn's events go through (ADR 0015). */
export function streamKey(turnId: string): string {
  return `vidyam:chat:turn:${turnId}`;
}

/**
 * The assistant message's id, known from the turn's before it is written: the browser is told it when the
 * turn starts, and chat messages are append-only, so no placeholder row is written first. A UUIDv8 from a hash.
 */
export function assistantMessageId(turnId: string): string {
  const hex = createHash("sha256").update(`assistant:${turnId}`).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Names for the ids a card's answer refers to, so it reads as a sentence. */
export interface CardNames {
  exams: Record<string, string>;
  nodes: Record<string, string>;
  blueprints: Record<string, string>;
}

/** The ids a card's answer refers to (exam codes, syllabus nodes, paper patterns), to look their names up. */
export function cardRefs(values: Record<string, unknown>): {
  examCodes: string[];
  nodeIds: string[];
  blueprintIds: string[];
} {
  const strings = (value: unknown) =>
    (Array.isArray(value) ? value : [value]).filter((v) => typeof v === "string");
  return {
    examCodes: strings(values.exam),
    nodeIds: strings(values.taxonomy_nodes).filter((id) => UUID.test(id)),
    blueprintIds: strings(values.blueprint).filter((id) => UUID.test(id)),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_WORDS = { confirm_spec: "Confirm", cancel: "Cancel", undo: "Undo" } as const;
const LANGUAGE_NAMES: Record<string, string> = { hi: "Hindi", en: "English" };
const FIELD_NAMES: Record<string, string> = {
  kind: "Make",
  exam: "Exam",
  blueprint: "Paper pattern",
  taxonomy_nodes: "Chapters and topics",
  sections: "Sections",
  difficulty_mix: "Difficulty",
  languages: "Languages",
  layout: "Layout",
  duration: "Duration",
  sourcing: "Questions from",
  student_batch: "Student batch",
  set_codes: "Sets",
  depth: "Depth",
  include_examples: "Worked examples",
  include_practice: "Practice questions",
  title: "Title",
};

function words(text: string): string {
  return text.replaceAll("_", " ");
}

function describe(key: string, value: unknown, names: CardNames): string {
  const list = Array.isArray(value) ? (value as unknown[]) : [value];
  switch (key) {
    case "exam":
      return typeof value === "string" ? (names.exams[value] ?? value) : "none";
    case "blueprint":
      return typeof value === "string" ? (names.blueprints[value] ?? "chosen") : "none";
    case "taxonomy_nodes":
      return list.map((id) => names.nodes[String(id)] ?? String(id)).join(", ");
    case "languages":
      return list.map((code) => LANGUAGE_NAMES[String(code)] ?? String(code)).join(", ");
    case "sections":
      return list
        .map((section) => {
          const s = section as { count?: number; qtype?: string; marksEach?: number };
          return `${s.count ?? "?"} ${words(s.qtype ?? "questions")} (${s.marksEach ?? "?"} marks each)`;
        })
        .join("; ");
    case "difficulty_mix": {
      const mix = value as Record<string, number>;
      return ["easy", "medium", "hard"]
        .map((level) => `${Math.round((mix[level] ?? 0) * 100)}% ${level}`)
        .join(", ");
    }
    case "duration":
      return value === null ? "no limit" : `${String(value)} minutes`;
    default:
      return typeof value === "boolean" ? (value ? "yes" : "no") : words(list.map(String).join(", "));
  }
}

/** A card's answer in words, for the transcript (ADR 0015): any model can read it after a switch. */
export function cardSummary(values: Record<string, unknown>, names: CardNames): string {
  return Object.entries(values)
    .filter(([key]) => key in FIELD_NAMES)
    .map(([key, value]) => `${FIELD_NAMES[key]}: ${describe(key, value, names)}`)
    .join(". ");
}

/** What the teacher sent, as the blocks of their message: words, an answered card, or a button press. */
export function userBlocks(input: ChatTurnInput, names: CardNames): ChatBlock[] {
  switch (input.kind) {
    case "text":
      return [{ type: "text", text: input.text }];
    case "card_submit":
      return [
        {
          type: "card_response",
          cardId: input.cardId,
          values: input.values,
          summary: cardSummary(input.values, names),
        },
      ];
    case "action":
      return [
        {
          type: "action",
          action: input.action,
          targetId: input.targetId ?? null,
          summary: ACTION_WORDS[input.action],
        },
      ];
  }
}

/**
 * The assistant message for an answer that failed: what had arrived, then the error, so the chat shows what
 * happened and the transcript stays readable.
 */
export function failedAnswer(text: string, blocks: ChatBlock[], code: string, message: string): ChatBlock[] {
  return [...(text ? [{ type: "text" as const, text }] : []), ...blocks, { type: "error", code, message }];
}

export function isStale(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > TURN_TIMEOUT_MS;
}

/** ILIKE pattern for a search term, with its own % and _ taken literally. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
