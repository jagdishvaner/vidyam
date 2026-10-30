import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import {
  sourcesTitle,
  type PrintDocument,
  type PrintItem,
  type PrintNotes,
  type PrintPaper,
  type PrintVersion,
} from "../domain/print.js";
import { blockHtml, inlineHtml } from "./rich-text.js";

const require = createRequire(import.meta.url);

function dataUrl(file: string): string {
  return `data:font/woff2;base64,${readFileSync(file).toString("base64")}`;
}

/** The page's fonts and styles, read once: everything is inlined, so a PDF never depends on the machine. */
function loadStyles(): string {
  const katexCss = require.resolve("katex/dist/katex.min.css");
  const fonts = path.join(path.dirname(katexCss), "fonts");
  const katex = readFileSync(katexCss, "utf8").replace(
    /url\(fonts\/([^)]+\.woff2)\)/g,
    (_, name: string) => `url(${dataUrl(path.join(fonts, name))})`,
  );
  const face = (family: string, pkg: string, file: string, weight: number, style = "normal") => {
    const src = dataUrl(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "files", file));
    return `@font-face{font-family:"${family}";src:url(${src}) format("woff2");font-weight:${weight};font-style:${style}}`;
  };
  return [
    face("Noto Serif", "@fontsource/noto-serif", "noto-serif-latin-400-normal.woff2", 400),
    face("Noto Serif", "@fontsource/noto-serif", "noto-serif-latin-700-normal.woff2", 700),
    face("Noto Serif", "@fontsource/noto-serif", "noto-serif-latin-400-italic.woff2", 400, "italic"),
    face("Noto Serif Devanagari", "@fontsource/noto-serif-devanagari", "noto-serif-devanagari-devanagari-400-normal.woff2", 400),
    face("Noto Serif Devanagari", "@fontsource/noto-serif-devanagari", "noto-serif-devanagari-devanagari-700-normal.woff2", 700),
    katex,
    PAGE_CSS,
  ].join("\n"); // prettier-ignore
}

const PAGE_CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: "Noto Serif", "Noto Serif Devanagari", serif; font-size: 11pt; line-height: 1.45;
       color: #000; }
p { margin: 0 0 0.35em; }
ul, ol { margin: 0.2em 0 0.4em; padding-left: 1.4em; }
table { border-collapse: collapse; margin: 0.4em 0; }
td, th { border: 1px solid #555; padding: 2pt 5pt; vertical-align: top; }
.header { text-align: center; border-bottom: 1.5pt solid #000; padding-bottom: 6pt; margin-bottom: 8pt; }
.center { font-weight: 700; font-size: 13pt; }
.header-line { font-size: 10pt; }
h1 { font-size: 15pt; margin: 4pt 0; }
.facts { display: flex; flex-wrap: wrap; justify-content: center; gap: 2pt 14pt; font-size: 10pt; }
.instructions { font-size: 10pt; margin: 0 0 8pt; }
h2 { font-size: 12pt; margin: 10pt 0 2pt; border-bottom: 0.5pt solid #888; }
.note { font-size: 9pt; color: #333; margin-bottom: 4pt; }
.item { display: grid; grid-template-columns: 2.2em 1fr 3.2em; gap: 0 4pt; margin: 6pt 0; break-inside: avoid; }
.number { font-weight: 700; }
.marks { text-align: right; font-size: 9pt; color: #333; }
.versions.side { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12pt; }
.version + .version { margin-top: 3pt; }
.versions.side .version + .version { margin-top: 0; }
.options { display: grid; grid-template-columns: 1fr 1fr; gap: 1pt 12pt; margin-top: 2pt; }
.option { display: flex; gap: 4pt; }
.label { white-space: nowrap; }
.answer { font-weight: 700; margin-top: 2pt; }
.solution { margin-top: 2pt; padding-left: 6pt; border-left: 1.5pt solid #999; }
.missing { color: #666; font-style: italic; }
.key { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2pt 10pt; }
.key div { border-bottom: 0.5pt dotted #999; }
.sources { font-size: 8.5pt; color: #333; margin-top: 3pt; }
.katex { font-size: 1.05em; }
.katex-display { margin: 0.3em 0; }
`;

let styles: string | null = null;

/** A printed document as one self-contained HTML page (fonts, mathematics and all), for Chromium to print. */
export function renderHtml(document: PrintDocument): string {
  styles ??= loadStyles();
  const body = renderToStaticMarkup(
    document.kind === "paper" ? <Paper paper={document} /> : <Notes notes={document} />,
  );
  const language = document.languages[0] ?? "hi";
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><style>${styles}</style></head><body>${body}</body></html>`;
}

function Html({ html, inline = false }: { html: string; inline?: boolean }) {
  return inline ? (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function Header({ lines, title, facts }: { lines: string[]; title: string; facts: string[] }) {
  return (
    <header className="header">
      {lines.map((line, n) => (
        <div key={n} className={n === 0 ? "center" : "header-line"}>
          {line}
        </div>
      ))}
      <h1>{title}</h1>
      <div className="facts">
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </div>
    </header>
  );
}

function Paper({ paper }: { paper: PrintPaper }) {
  return (
    <main>
      <Header lines={paper.headerLines} title={paper.title} facts={paper.facts} />
      {paper.instructions.length > 0 && (
        <ol className="instructions">
          {paper.instructions.map((line, n) => (
            <li key={n}>{line}</li>
          ))}
        </ol>
      )}
      {paper.variant === "answer_key" ? (
        <div className="key">
          {paper.sections.flatMap((section) =>
            section.items.map((item) => (
              <div key={item.number}>
                <b>{item.number}.</b> <Html inline html={inlineHtml(item.answer ?? "—")} />
              </div>
            )),
          )}
        </div>
      ) : (
        paper.sections.map((section, n) => (
          <section key={n}>
            <h2>{section.title}</h2>
            {section.note && <div className="note">{section.note}</div>}
            {section.instructions.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
            {section.items.map((item) => (
              <Item
                key={item.number}
                item={item}
                sideBySide={paper.sideBySide}
                solutions={paper.variant === "solutions"}
              />
            ))}
          </section>
        ))
      )}
      {paper.footer && <footer className="note">{paper.footer}</footer>}
    </main>
  );
}

function Item({ item, sideBySide, solutions }: { item: PrintItem; sideBySide: boolean; solutions: boolean }) {
  return (
    <div className="item">
      <div className="number">{item.number}.</div>
      <div>
        {item.versions.length === 0 ? (
          <p className="missing">[No question here yet]</p>
        ) : (
          <div className={sideBySide ? "versions side" : "versions"}>
            {item.versions.map((version) => (
              <Version key={version.language} version={version} solutions={solutions} />
            ))}
          </div>
        )}
        {solutions && item.answer && (
          <div className="answer">
            ✓ <Html inline html={inlineHtml(item.answer)} />
          </div>
        )}
      </div>
      <div className="marks">[{item.marks}]</div>
    </div>
  );
}

function Version({ version, solutions }: { version: PrintVersion; solutions: boolean }) {
  return (
    <div className="version" lang={version.language}>
      <Html html={blockHtml(version.stem)} />
      {version.options.length > 0 && (
        <div className="options">
          {version.options.map((option) => (
            <div key={option.label} className="option">
              <span className="label">({option.label})</span>
              <Html inline html={inlineHtml(option.text)} />
            </div>
          ))}
        </div>
      )}
      {solutions && version.solution && (
        <div className="solution">
          <Html html={blockHtml(version.solution)} />
        </div>
      )}
    </div>
  );
}

function Notes({ notes }: { notes: PrintNotes }) {
  return (
    <main>
      <Header lines={notes.headerLines} title={notes.title} facts={notes.facts} />
      {notes.sections.map((section, n) => (
        <section key={n}>
          <h2>{section.title}</h2>
          {section.bodies.map((body) => (
            <div key={body.language} lang={body.language}>
              <Html html={blockHtml(body.markdown)} />
            </div>
          ))}
          {section.sources.length > 0 && (
            <div className="sources">
              <b>{sourcesTitle(notes.languages)}:</b> {section.sources.join("; ")}
            </div>
          )}
        </section>
      ))}
      {notes.footer && <footer className="note">{notes.footer}</footer>}
    </main>
  );
}
