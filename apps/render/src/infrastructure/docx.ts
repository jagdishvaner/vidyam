import {
  AlignmentType,
  BorderStyle,
  convertToXmlComponent,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableBorders,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import type { Token, Tokens } from "marked";
import { xml2js, type Element } from "xml-js";

import type { FileRenderer } from "../application/render-export.js";
import { devanagariRuns, unicodeToKrutiDev } from "../domain/krutidev.js";
import {
  sourcesTitle,
  type PrintDocument,
  type PrintItem,
  type PrintNotes,
  type PrintPaper,
  type PrintVersion,
} from "../domain/print.js";
import { blockTokens, inlineTokens, omml, PLACEHOLDER, type Formula } from "./rich-text.js";

const LATIN = "Times New Roman";
const DEVANAGARI = "Nirmala UI"; // ships with Windows; Word falls back to Mangal or Kokila
const KRUTI_DEV = "Kruti Dev 010";
const SIZE = 22; // half-points: 11 pt
const KRUTI_SCALE = 1.3; // Kruti Dev draws small; teachers set it a few points larger
const INDENT = 400; // twips

interface Style {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  mono?: boolean;
}

/**
 * Word files with the docx library (plan v3 step 29): Unicode text with Word's own Devanagari font, or — for
 * centers that print in Kruti Dev — every Hindi run converted to that font's encoding, English left in Times
 * New Roman. Mathematics becomes Word equations (OMML) from KaTeX's MathML, so it stays editable.
 */
export class DocxRenderer implements FileRenderer {
  async render(printed: PrintDocument, options: { krutiDev: boolean }): Promise<Uint8Array> {
    const writer = new Writer(options.krutiDev);
    const children = printed.kind === "paper" ? writer.paper(printed) : writer.notes(printed);
    const document = new Document({
      creator: "Vidyam",
      title: printed.title,
      styles: { default: { document: { run: { font: LATIN, size: SIZE } } } },
      sections: [
        {
          properties: { page: { margin: { top: 800, bottom: 900, left: 800, right: 800 } } },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], size: 16 }),
                  ],
                }),
              ],
            }),
          },
          children,
        },
      ],
    });
    return new Uint8Array(await Packer.toBuffer(document));
  }
}

class Writer {
  constructor(private readonly krutiDev: boolean) {}

  // --- Runs of text ----------------------------------------------------------------------------------

  /** Plain text in the right fonts: Kruti Dev for Hindi in a Kruti Dev file, Word's fonts otherwise. */
  private plain(text: string, style: Style = {}): TextRun[] {
    const size = style.size ?? SIZE;
    const common = { bold: style.bold, italics: style.italics };
    if (style.mono) return [new TextRun({ ...common, text, font: "Consolas", size })];
    if (!this.krutiDev) {
      return [
        new TextRun({
          ...common,
          text,
          size,
          sizeComplexScript: size,
          font: { ascii: LATIN, hAnsi: LATIN, cs: DEVANAGARI, eastAsia: LATIN },
        }),
      ];
    }
    return devanagariRuns(text).map((run) =>
      run.devanagari
        ? new TextRun({
            ...common,
            text: unicodeToKrutiDev(run.text),
            font: KRUTI_DEV,
            size: Math.round(size * KRUTI_SCALE),
          })
        : new TextRun({ ...common, text: run.text, font: LATIN, size }),
    );
  }

  /** Text with its formulas as Word equations (TeX in brackets when KaTeX can't read one). */
  private withMath(text: string, formulas: Formula[], style: Style): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    let last = 0;
    for (const match of text.matchAll(PLACEHOLDER)) {
      if (match.index > last) out.push(...this.plain(text.slice(last, match.index), style));
      const formula = formulas[Number(match[1])];
      const xml = formula ? omml(formula) : null;
      if (xml) {
        const parsed = xml2js(xml, { compact: false }) as Element;
        out.push(convertToXmlComponent(parsed.elements![0] as never) as unknown as ParagraphChild);
      } else if (formula) {
        out.push(...this.plain(`[${formula.tex}]`, { ...style, mono: true }));
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) out.push(...this.plain(text.slice(last), style));
    return out;
  }

  private inline(tokens: readonly Token[], formulas: Formula[], style: Style = {}): ParagraphChild[] {
    return tokens.flatMap((token): ParagraphChild[] => {
      switch (token.type) {
        case "strong":
          return this.inline((token as Tokens.Strong).tokens, formulas, { ...style, bold: true });
        case "em":
          return this.inline((token as Tokens.Em).tokens, formulas, { ...style, italics: true });
        case "codespan":
          return this.plain((token as Tokens.Codespan).text, { ...style, mono: true });
        case "br":
          return [new TextRun({ text: "", break: 1 })];
        case "link":
          return this.inline((token as Tokens.Link).tokens, formulas, style);
        case "text": {
          const text = token as Tokens.Text;
          return text.tokens
            ? this.inline(text.tokens, formulas, style)
            : this.withMath(text.text, formulas, style);
        }
        default:
          return "text" in token && typeof token.text === "string"
            ? this.withMath(token.text, formulas, style)
            : [];
      }
    });
  }

  /** One line of Markdown (an option, an answer) as runs. */
  private line(text: string, style: Style = {}): ParagraphChild[] {
    const { tokens, formulas } = inlineTokens(text);
    return this.inline(tokens, formulas, style);
  }

  /** Markdown blocks as paragraphs (and tables); `first` goes before the first paragraph's text. */
  private blocks(
    markdown: string,
    options: { indent?: number; first?: ParagraphChild[] } = {},
  ): (Paragraph | Table)[] {
    const { tokens, formulas } = blockTokens(markdown);
    const indent = options.indent ? { left: options.indent } : undefined;
    let first = options.first ?? [];
    const take = () => {
      const lead = first;
      first = [];
      return lead;
    };
    const out: (Paragraph | Table)[] = [];
    for (const token of tokens) {
      switch (token.type) {
        case "space":
          break;
        case "heading": {
          const heading = token as Tokens.Heading;
          const levels = [
            HeadingLevel.HEADING_1,
            HeadingLevel.HEADING_2,
            HeadingLevel.HEADING_3,
            HeadingLevel.HEADING_4,
          ];
          out.push(new Paragraph({ heading: levels[Math.min(heading.depth, 4) - 1], indent,
                                   children: [...take(), ...this.inline(heading.tokens, formulas, { bold: true })] })); // prettier-ignore
          break;
        }
        case "list": {
          const list = token as Tokens.List;
          list.items.forEach((item, n) => {
            const marker = list.ordered ? `${Number(list.start || 1) + n}. ` : "• ";
            const content = item.tokens.flatMap((child) =>
              "tokens" in child && child.tokens ? this.inline(child.tokens, formulas) : [],
            );
            out.push(new Paragraph({ indent: { left: (options.indent ?? 0) + INDENT, hanging: 280 },
                                     children: [...take(), ...this.plain(marker, {}), ...content] })); // prettier-ignore
          });
          break;
        }
        case "table": {
          const table = token as Tokens.Table;
          const row = (cells: Tokens.TableCell[], bold: boolean) =>
            new TableRow({
              children: cells.map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph({ children: this.inline(cell.tokens, formulas, { bold }) })],
                  }),
              ),
            });
          out.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [row(table.header, true), ...table.rows.map((cells) => row(cells, false))],
            }),
          );
          break;
        }
        case "code":
          out.push(
            new Paragraph({
              indent,
              children: [...take(), ...this.plain((token as Tokens.Code).text, { mono: true })],
            }),
          );
          break;
        case "blockquote": {
          const quote = token as Tokens.Blockquote;
          for (const child of quote.tokens) {
            if ("tokens" in child && child.tokens) {
              out.push(
                new Paragraph({
                  indent: { left: (options.indent ?? 0) + INDENT },
                  children: this.inline(child.tokens, formulas, { italics: true }),
                }),
              );
            }
          }
          break;
        }
        default: {
          const children =
            "tokens" in token && token.tokens
              ? this.inline(token.tokens, formulas)
              : "text" in token && typeof token.text === "string"
                ? this.withMath(token.text, formulas, {})
                : [];
          out.push(new Paragraph({ indent, children: [...take(), ...children] }));
        }
      }
    }
    if (first.length) out.unshift(new Paragraph({ indent, children: first }));
    return out;
  }

  // --- Documents ---------------------------------------------------------------------------------------

  private header(lines: string[], title: string, facts: string[]): Paragraph[] {
    return [
      ...lines.map(
        (line, n) =>
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: this.plain(line, n === 0 ? { bold: true, size: 28 } : { size: 20 }),
          }),
      ),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 60 },
        children: this.plain(title, { bold: true, size: 30 }),
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "000000", space: 4 } },
        spacing: { after: 160 },
        children: this.plain(facts.join("     "), { size: 20 }),
      }),
    ];
  }

  paper(paper: PrintPaper): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = this.header(paper.headerLines, paper.title, paper.facts);
    paper.instructions.forEach((line, n) =>
      out.push(
        new Paragraph({
          indent: { left: INDENT, hanging: 280 },
          children: this.plain(`${n + 1}. ${line}`, { size: 20 }),
        }),
      ),
    );
    if (paper.variant === "answer_key") {
      out.push(this.key(paper));
    } else {
      for (const section of paper.sections) {
        out.push(
          new Paragraph({
            spacing: { before: 240, after: 40 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "888888", space: 2 } },
            children: this.plain(section.title, { bold: true, size: 24 }),
          }),
        );
        if (section.note)
          out.push(new Paragraph({ children: this.plain(section.note, { size: 18, italics: true }) }));
        for (const line of section.instructions) out.push(new Paragraph({ children: this.plain(line) }));
        for (const item of section.items)
          out.push(...this.item(item, paper.sideBySide, paper.variant === "solutions"));
      }
    }
    if (paper.footer)
      out.push(new Paragraph({ spacing: { before: 240 }, children: this.plain(paper.footer, { size: 18 }) }));
    return out;
  }

  private item(item: PrintItem, sideBySide: boolean, solutions: boolean): (Paragraph | Table)[] {
    const number = this.plain(`${item.number}.  `, { bold: true });
    const marks = this.plain(`  [${item.marks}]`, { size: 18 });
    if (!item.versions.length) {
      return [
        new Paragraph({
          spacing: { before: 160 },
          children: [...number, ...this.plain("[No question here yet]", { italics: true }), ...marks],
        }),
      ];
    }
    const version = (v: PrintVersion, first: boolean): (Paragraph | Table)[] => [
      ...this.blocks(v.stem, { first: first ? [...number] : [], indent: first ? 0 : INDENT }),
      ...(v.options.length ? [this.options(v)] : []),
      ...(solutions && v.solution ? this.blocks(v.solution, { indent: INDENT }) : []),
    ];
    const answer =
      solutions && item.answer
        ? [
            new Paragraph({
              indent: { left: INDENT },
              children: this.line(`✓ ${item.answer}`, { bold: true }),
            }),
          ]
        : [];
    const tail = new Paragraph({ alignment: AlignmentType.RIGHT, children: marks });
    if (sideBySide && item.versions.length === 2) {
      const cells = item.versions.map(
        (v, n) =>
          new TableCell({
            borders: TableBorders.NONE,
            children: version(v, n === 0).filter((p): p is Paragraph => p instanceof Paragraph),
          }),
      );
      return [
        new Table({
          borders: TableBorders.NONE,
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ children: cells })],
        }),
        ...answer,
        tail,
      ];
    }
    return [
      new Paragraph({ spacing: { before: 120 }, children: [] }),
      ...item.versions.flatMap((v, n) => version(v, n === 0)),
      ...answer,
      tail,
    ];
  }

  /** Options two to a row, without borders. */
  private options(version: PrintVersion): Table {
    const rows: TableRow[] = [];
    for (let i = 0; i < version.options.length; i += 2) {
      const pair = version.options.slice(i, i + 2);
      rows.push(
        new TableRow({
          children: [0, 1].map(
            (n) =>
              new TableCell({
                borders: TableBorders.NONE,
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    children: pair[n]
                      ? [...this.plain(`(${pair[n]!.label}) `, {}), ...this.line(pair[n]!.text)]
                      : [],
                  }),
                ],
              }),
          ),
        }),
      );
    }
    return new Table({
      borders: TableBorders.NONE,
      width: { size: 95, type: WidthType.PERCENTAGE },
      indent: { size: INDENT, type: WidthType.DXA },
      rows,
    });
  }

  /** The answer key: five answers to a row. */
  private key(paper: PrintPaper): Table {
    const items = paper.sections.flatMap((section) => section.items);
    const rows: TableRow[] = [];
    for (let i = 0; i < items.length; i += 5) {
      rows.push(
        new TableRow({
          children: [0, 1, 2, 3, 4].map((n) => {
            const item = items[i + n];
            return new TableCell({
              width: { size: 20, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: item
                    ? [...this.plain(`${item.number}. `, { bold: true }), ...this.line(item.answer ?? "—")]
                    : [],
                }),
              ],
            });
          }),
        }),
      );
    }
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
  }

  notes(notes: PrintNotes): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = this.header(notes.headerLines, notes.title, notes.facts);
    for (const section of notes.sections) {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240 },
          children: this.plain(section.title, { bold: true, size: 26 }),
        }),
      );
      for (const body of section.bodies) out.push(...this.blocks(body.markdown));
      if (section.sources.length) {
        out.push(
          new Paragraph({
            children: [
              ...this.plain(`${sourcesTitle(notes.languages)}: `, { bold: true, size: 17 }),
              ...this.plain(section.sources.join("; "), { size: 17 }),
            ],
          }),
        );
      }
    }
    if (notes.footer)
      out.push(new Paragraph({ spacing: { before: 240 }, children: this.plain(notes.footer, { size: 18 }) }));
    return out;
  }
}
