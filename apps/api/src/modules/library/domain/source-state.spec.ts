import { describe, expect, it } from "vitest";

import { pageReadingState, sourceState } from "./source-state.js";

const progress = { sections: 0, ocrPages: 0 };

describe("sourceState", () => {
  it("follows a file from upload to ready", () => {
    expect(sourceState({ ...progress, stage: "uploaded", status: "pending" })).toBe("queued");
    expect(sourceState({ ...progress, stage: "parsed", status: "running" })).toBe("reading");
    expect(sourceState({ ...progress, stage: "parsed", status: "done" })).toBe("reading");
    expect(sourceState({ ...progress, stage: "chunked", status: "running" })).toBe("reading");
    expect(sourceState({ stage: "chunked", status: "done", sections: 12, ocrPages: 3 })).toBe("ready");
    expect(sourceState({ ...progress, stage: "tagged", status: "running" })).toBe("reading");
    expect(sourceState({ stage: "tagged", status: "done", sections: 12, ocrPages: 0 })).toBe("ready");
    expect(sourceState({ stage: "indexed", status: "done", sections: 12, ocrPages: 0 })).toBe("ready");
  });

  it("tells apart a scan waiting for OCR, an empty file and a failure", () => {
    expect(sourceState({ stage: "chunked", status: "pending", sections: 0, ocrPages: 40 })).toBe(
      "waiting_for_ocr",
    );
    expect(sourceState({ stage: "tagged", status: "pending", sections: 0, ocrPages: 40 })).toBe(
      "waiting_for_ocr",
    );
    expect(sourceState({ stage: "chunked", status: "pending", sections: 0, ocrPages: 0 })).toBe("ready");
    expect(sourceState({ ...progress, stage: "parsed", status: "failed" })).toBe("failed");
  });
});

describe("pageReadingState", () => {
  it("names how each page's text was obtained", () => {
    expect(pageReadingState("text_layer", {})).toBe("text");
    expect(pageReadingState("legacy_font", {})).toBe("converted");
    expect(pageReadingState("vision_ocr", { awaitingOcr: true, note: "scanned page" })).toBe(
      "waiting_for_ocr",
    );
    expect(pageReadingState("text_layer", { note: "blank page" })).toBe("blank");
  });
});
