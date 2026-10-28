import { parseManifestCsv } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { importOrder, planManifest, type LibraryFile, type ManifestCatalog } from "./manifest.js";

const catalog: ManifestCatalog = {
  subjects: new Map([["science", "n-science"]]),
  nodes: new Map([
    ["science", { id: "n-science", level: "subject" }],
    ["science/physics", { id: "n-physics", level: "unit" }],
    ["science/physics/motion", { id: "n-motion", level: "chapter" }],
    ["science/physics/force_and_laws_of_motion", { id: "n-force", level: "chapter" }],
    ["social_science/history", { id: "n-history", level: "unit" }],
  ]),
  examCodes: new Set(["rpsc_2g_p2_science"]),
};
const PDF = "application/pdf";

function plan(csv: string, files: Record<string, string | null>, library: LibraryFile[] = []) {
  const parsed = parseManifestCsv(csv);
  expect(parsed.problems).toEqual([]);
  return planManifest(parsed.rows, parsed.lines, catalog, new Map(Object.entries(files)), (name) =>
    library.filter((file) => file.filename === name),
  );
}

const HEADER =
  "file,kind,licence,subject,language,exams,title,paperCode,year,setCode,answerKeyFor,answerKeyStatus,chapter,sections,parallelOf";

describe("planManifest", () => {
  it("resolves chapters, page sections, answer keys and parallel editions", () => {
    const { sources, problems } = plan(
      [
        HEADER,
        "notes/,notes,own,science,hi,rpsc_2g_p2_science,,,,,,,,,",
        "notes/motion.pdf,,,,,,Motion,,,,,,science/physics/motion,,",
        "notes/two.pdf,,,,,,Two chapters,,,,,,,1-4=science/physics/motion; 5-9=science/physics/force_and_laws_of_motion,",
        "notes/motion-en.pdf,,,,en,,Motion (English),,,,,,science/physics/motion,,notes/motion.pdf",
        "paper.pdf,question_paper,pyq,science,bilingual,rpsc_2g_p2_science,,p2,2024,A,,,,,",
        "key.pdf,answer_key,pyq,science,bilingual,rpsc_2g_p2_science,,p2,2024,A,paper.pdf,final,,,",
      ].join("\n"),
      {
        "notes/motion.pdf": PDF,
        "notes/two.pdf": PDF,
        "notes/motion-en.pdf": PDF,
        "paper.pdf": PDF,
        "key.pdf": PDF,
      },
    );
    expect(problems).toEqual([]);
    const [motion, two, english, paper, key] = sources;
    expect(motion).toMatchObject({
      subjectNodeId: "n-science",
      chapter: { nodeId: "n-motion", path: "science/physics/motion" },
      language: "hi",
    });
    expect(two!.sections).toEqual([
      { pageStart: 1, pageEnd: 4, nodeId: "n-motion", path: "science/physics/motion", title: null },
      {
        pageStart: 5,
        pageEnd: 9,
        nodeId: "n-force",
        path: "science/physics/force_and_laws_of_motion",
        title: null,
      },
    ]);
    expect(english!.parallelOf).toEqual({ row: 0 });
    expect(paper!.language).toBe("mixed");
    expect(key!.answerKeyFor).toEqual({ row: 3 });
    // Papers are imported before their keys, originals before their other-language editions.
    const order = importOrder(sources);
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(4));
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(2));
  });

  it("reports every unknown code, missing file and broken reference, with its line", () => {
    const { problems } = plan(
      [
        HEADER,
        "a.pdf,notes,own,maths,hi,reet_l9,,,,,,,,,",
        "b.pdf,notes,own,science,hi,rpsc_2g_p2_science,,,,,,,science/physics/optics,,",
        "c.pdf,notes,own,science,hi,rpsc_2g_p2_science,,,,,,,social_science/history,,",
        "d.pdf,notes,own,science,hi,rpsc_2g_p2_science,,,,,,,,4-9=science/physics/motion; 9-12=science/physics/force_and_laws_of_motion,",
        "e.doc,notes,own,science,hi,rpsc_2g_p2_science,,,,,,,,,",
        "key.pdf,answer_key,pyq,science,hi,rpsc_2g_p2_science,,p2,2024,B,old-paper.pdf,final,,,",
        "f.pdf,notes,own,science,hi,rpsc_2g_p2_science,,,,,,,science,,",
      ].join("\n"),
      { "b.pdf": PDF, "c.pdf": PDF, "d.pdf": PDF, "e.doc": null, "key.pdf": PDF, "f.pdf": PDF },
    );
    expect(problems.map((p) => `${p.line} ${p.file}: ${p.message}`)).toEqual([
      "2 a.pdf: file not found next to the manifest",
      '2 a.pdf: subject "maths" is not in the syllabus',
      '2 a.pdf: exam paper "reet_l9" is not set up (Admin → Exams)',
      '3 b.pdf: chapter "science/physics/optics" is not in the syllabus',
      '4 c.pdf: chapter "social_science/history" is not part of subject "science"',
      "5 d.pdf: sections overlap at page 9",
      "6 e.doc: this file type can't be read (PDF, Word, text or images only)",
      '7 key.pdf: answer key for "old-paper.pdf" is neither in this manifest nor in the library',
      '8 f.pdf: chapter "science" is a whole subject',
    ]);
  });

  it("links an answer key to a paper already in the library, and checks booklet sets match", () => {
    const library: LibraryFile[] = [
      { id: "s-paper", filename: "paper.pdf", kind: "question_paper", setCode: "A", parallelGroupId: null },
    ];
    const later = plan(
      [HEADER, "key.pdf,answer_key,pyq,science,hi,rpsc_2g_p2_science,,p2,2024,A,old/paper.pdf,final,,,"].join(
        "\n",
      ),
      { "key.pdf": PDF },
      library,
    );
    expect(later.problems).toEqual([]);
    expect(later.sources[0]!.answerKeyFor).toEqual({ sourceId: "s-paper" });

    const mismatch = plan(
      [
        HEADER,
        "paper.pdf,question_paper,pyq,science,hi,rpsc_2g_p2_science,,p2,2024,A,,,,,",
        "key.pdf,answer_key,pyq,science,hi,rpsc_2g_p2_science,,p2,2024,B,paper.pdf,final,,,",
      ].join("\n"),
      { "paper.pdf": PDF, "key.pdf": PDF },
    );
    expect(mismatch.problems.map((p) => p.message)).toEqual(["the key is for set B but the paper is set A"]);
  });
});
