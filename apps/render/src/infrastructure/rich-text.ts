import katex from "katex";
import { Lexer, marked, type Token } from "marked";
import { mml2omml } from "mathml2omml";

/**
 * Text as Vidyam writes it: Markdown with mathematics in LaTeX between $…$ (inline) or $$…$$ (display).
 * Mathematics is taken out before Markdown reads the text (its backslashes and underscores are LaTeX, not
 * Markdown) and put back as KaTeX HTML for the PDF, or as Word equations (OMML) for Word.
 */

export interface Formula {
  tex: string;
  display: boolean;
}

const MATH = /\$\$([\s\S]+?)\$\$|(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$/g;
const OPEN = "\uE010"; // around a formula's number while Markdown reads the text
const CLOSE = "\uE011";
export const PLACEHOLDER = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");

/** The text with each formula replaced by a placeholder, and the formulas. */
export function protect(text: string): { text: string; formulas: Formula[] } {
  const formulas: Formula[] = [];
  const out = text.replace(MATH, (_, display: string | undefined, inline: string | undefined) => {
    formulas.push({ tex: (display ?? inline ?? "").trim(), display: display !== undefined });
    return `${OPEN}${formulas.length - 1}${CLOSE}`;
  });
  return { text: out, formulas };
}

function katexHtml(formula: Formula): string {
  return katex.renderToString(formula.tex, {
    displayMode: formula.display,
    throwOnError: false,
    output: "html",
    strict: "ignore",
  });
}

function restoreHtml(html: string, formulas: Formula[]): string {
  return html.replace(PLACEHOLDER, (_, n: string) =>
    formulas[Number(n)] ? katexHtml(formulas[Number(n)]!) : "",
  );
}

/** Markdown blocks (paragraphs, lists, tables, headings) as HTML. */
export function blockHtml(text: string): string {
  const { text: safe, formulas } = protect(text);
  return restoreHtml(marked.parse(safe, { async: false, gfm: true, breaks: true }), formulas);
}

/** A line of Markdown (an option, a heading) as inline HTML. */
export function inlineHtml(text: string): string {
  const { text: safe, formulas } = protect(text);
  return restoreHtml(marked.parseInline(safe, { async: false, gfm: true, breaks: true }), formulas);
}

/** Markdown tokens, for drawing in Word; formulas stay as placeholders in the tokens' text. */
export function blockTokens(text: string): { tokens: Token[]; formulas: Formula[] } {
  const { text: safe, formulas } = protect(text);
  return { tokens: Lexer.lex(safe, { gfm: true, breaks: true }), formulas };
}

export function inlineTokens(text: string): { tokens: Token[]; formulas: Formula[] } {
  const { text: safe, formulas } = protect(text);
  return { tokens: Lexer.lexInline(safe, { gfm: true, breaks: true }), formulas };
}

/** A formula as a Word equation (OMML), through KaTeX's MathML; null when KaTeX can't read it. */
export function omml(formula: Formula): string | null {
  try {
    const html = katex.renderToString(formula.tex, {
      displayMode: formula.display,
      throwOnError: true,
      output: "mathml",
      strict: "ignore",
    });
    const mathml = /<math[\s\S]*<\/math>/.exec(html)?.[0];
    if (!mathml) return null;
    // KaTeX keeps the TeX as an annotation; Word has no use for it.
    return mml2omml(mathml.replace(/<annotation[\s\S]*?<\/annotation>/g, ""));
  } catch {
    return null;
  }
}
