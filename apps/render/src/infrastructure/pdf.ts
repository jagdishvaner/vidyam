import { chromium, type Browser } from "playwright";

import type { FileRenderer } from "../application/render-export.js";
import type { PrintDocument } from "../domain/print.js";
import { renderHtml } from "./html.js";

const FOOTER = `<div style="width:100%;font-size:8pt;text-align:center;color:#555;">
  <span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

/**
 * PDFs through Chromium (Playwright): the page is laid out like a browser would, with real Devanagari
 * shaping and KaTeX mathematics. One browser per worker, one page per file.
 */
export class PdfRenderer implements FileRenderer {
  private browser: Promise<Browser> | null = null;

  async render(printed: PrintDocument): Promise<Uint8Array> {
    const browser = await this.open();
    const page = await browser.newPage();
    try {
      await page.setContent(renderHtml(printed), { waitUntil: "load" });
      await page.evaluate("document.fonts.ready"); // the embedded fonts, before printing
      return await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "14mm", bottom: "16mm", left: "14mm", right: "14mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: FOOTER,
      });
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser) await (await browser).close();
  }

  private open(): Promise<Browser> {
    // A browser that crashed is started again on the next file.
    this.browser ??= chromium.launch().then((browser) => {
      browser.on("disconnected", () => (this.browser = null));
      return browser;
    });
    return this.browser;
  }
}
