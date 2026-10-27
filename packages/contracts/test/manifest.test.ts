import { describe, expect, it } from "vitest";

import { parseManifestCsv } from "../src/index.js";

const header = "file,kind,licence,subject,language,exams,title,year,paperCode,setCode,sections,tags";

describe("upload manifest", () => {
  it("fills each file from its closest folder's defaults, and lets the file's own cells win", () => {
    const { rows, problems } = parseManifestCsv(
      [
        header,
        "books/,book,own,science,hi,rpsc_2g_p2_science; reet_l2,,,,,,",
        "books/english/,,,,en,,,,,,,",
        'books/english/a.pdf,,third_party,,,,"Motion, Force and Energy",,,,1-4=science/physics/motion; 5-9=science/physics/work_and_energy,old; scanned',
        "books/b.pdf,,,,,,Hindi book,,,,,",
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        file: "books/english/a.pdf",
        kind: "book",
        licence: "third_party",
        subject: "science",
        language: "en",
        exams: ["rpsc_2g_p2_science", "reet_l2"],
        title: "Motion, Force and Energy",
        sections: [
          { pages: "1-4", chapter: "science/physics/motion" },
          { pages: "5-9", chapter: "science/physics/work_and_energy" },
        ],
        tags: ["old", "scanned"],
      },
      {
        file: "books/b.pdf",
        kind: "book",
        licence: "own",
        subject: "science",
        language: "hi",
        exams: ["rpsc_2g_p2_science", "reet_l2"],
        title: "Hindi book",
      },
    ]);
  });

  it("reports every problem with its line, so a manifest is fixed in one pass", () => {
    const { rows, problems } = parseManifestCsv(
      [
        header + ",colour",
        "p.pdf,question_paper,pyq,science,hi,rpsc_2g_p2_science,,2024,,,,,",
        "q.pdf,notes,own,science,hindi,rpsc_2g_p2_science,,,,,,,",
        "q.pdf,notes,own,science,hi,rpsc_2g_p2_science,,,,,,,",
      ].join("\r\n"),
    );
    expect(rows.map((r) => r.file)).toEqual(["q.pdf"]);
    expect(problems).toEqual([
      { line: 1, message: 'unknown column "colour"' },
      { line: 2, file: "p.pdf", message: "paperCode: required for a question paper" },
      { line: 2, file: "p.pdf", message: "setCode: required for a question paper (its booklet set)" },
      { line: 3, file: "q.pdf", message: expect.stringMatching(/^language: /) },
      { line: 4, file: "q.pdf", message: "listed twice" },
    ]);
  });
});
