import { describe, expect, it } from "vitest";

import { devanagariRuns, unicodeToKrutiDev } from "./krutidev.js";

// Each pair also converts back to the same Unicode with the engine's krutidev_to_unicode (checked over all
// 2,171 Hindi words of the demo pack when this was written).
describe("unicodeToKrutiDev", () => {
  it.each([
    ["भारत", "Hkkjr"],
    ["न्यूटन", "U;wVu"],
    ["प्रतिक्रिया", "çfrfØ;k"],
    ["धर्म", "/keZ"],
    ["आशीर्वाद", "vk'khokZn"],
    ["स्त्री", "L=h"],
    ["क्षेत्र", "{ks="],
    ["ज्ञान", "Kku"],
    ["विद्युत्", "fo|qr~"],
    ["द्वितीय", "f}rh;"],
    ["शुद्ध", "'kq)"],
    ["ज़िला", "ft+yk"],
    ["फ़ोटो", "Q+ksVks"],
    ["श्रीमान्", "Jheku~"],
  ])("%s → %s", (unicode, krutiDev) => {
    expect(unicodeToKrutiDev(unicode)).toBe(krutiDev);
  });

  it("redraws digits and punctuation as the font expects", () => {
    expect(unicodeToKrutiDev("धर्म, कर्म (और) आशीर्वाद? २०२५ में ५ प्रश्न।")).toBe(
      "/keZ] deZ ¼vkSj½ vk'khokZn\\ „å„‡ esa ‡ ç'uA",
    );
    expect(unicodeToKrutiDev("उत्तर: क")).toBe("mÙkj% d"); // the visarga stands in for a colon
  });
});

describe("devanagariRuns", () => {
  it("keeps Hindi phrases together and leaves English and formulas apart", () => {
    expect(devanagariRuns("बल (force) का मात्रक N है।")).toEqual([
      { text: "बल", devanagari: true },
      { text: " (force) ", devanagari: false },
      { text: "का मात्रक", devanagari: true },
      { text: " N ", devanagari: false },
      { text: "है।", devanagari: true },
    ]);
  });

  it("ends a run at a dash, which the font would draw as a letter", () => {
    expect(devanagariRuns("बल एवं गति — अध्याय").map((run) => run.text)).toEqual([
      "बल एवं गति",
      " — ",
      "अध्याय",
    ]);
  });
});
