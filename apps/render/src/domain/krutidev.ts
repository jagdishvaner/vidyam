/**
 * Unicode Devanagari → Kruti Dev 010, for Word files teachers open with that font (plan v3 step 29). Many
 * centers in Rajasthan still type and print in Kruti Dev: it is a keyboard font, whose Latin characters
 * ("Hkkjr") the font draws as Devanagari ("भारत"). This is the reverse of the engine's
 * `krutidev_to_unicode` (apps/ai domain/devanagari.py), checked against it by a round trip.
 *
 * Two signs sit elsewhere in Kruti Dev than in Unicode: the short i (ि) is typed before its consonant
 * cluster, and the reph (र्) after the syllable it tops. They are moved first, then the text is mapped.
 */

const VIRAMA = "\u094D";
const NUKTA = "\u093C";
const RA = "\u0930";
const PRE_I = "\uE000"; // markers while reordering (Private Use Area, never in real text)
const REPH = "\uE001";

const C = "[\u0915-\u0939\u0958-\u095F]\u093C?"; // a consonant, with its nukta
const CLUSTER = `${C}(?:\u094D${C})*`;
const SIGNS = "[\u0901-\u0903\u093E-\u094C\u0962\u0963]*";

/** र् starting a cluster (not after a virama) moves after the cluster and its signs. */
const REPH_ON = new RegExp(`(?<!\u094D)\u0930\u094D(${CLUSTER})(${SIGNS})`, "gu");
/** ि moves before the cluster it follows. */
const SIGN_I_AFTER = new RegExp(`(${CLUSTER})\u093F`, "gu");

const FULL: Record<string, string> = {
  क: "d", ख: "[k", ग: "x", घ: "?k", ङ: "³", च: "p", छ: "N", ज: "t", झ: ">", ञ: "¥",
  ट: "V", ठ: "B", ड: "M", ढ: "<", ण: ".k", त: "r", थ: "Fk", द: "n", ध: "/k", न: "u",
  प: "i", फ: "Q", ब: "c", भ: "Hk", म: "e", य: ";", र: "j", ल: "y", ळ: "G", व: "o",
  श: "'k", ष: '"k', स: "l", ह: "g",
}; // prettier-ignore

/** Half forms (consonant + virama before another consonant); the rest are written full + ~. */
const HALF: Record<string, string> = {
  क: "D", ख: "[", ग: "X", घ: "?", च: "P", ज: "T", झ: "÷", ण: ".", त: "R", थ: "F", ध: "/",
  न: "U", प: "I", फ: "¶", ब: "C", भ: "H", म: "E", य: "¸", ल: "Y", व: "O", श: "'", ष: '"',
  स: "L", ह: "º",
}; // prettier-ignore

/** Conjuncts and syllables with glyphs of their own, longest first when matched. */
const CONJUNCTS: Record<string, string> = {
  "क्ष्": "{", "त्र्": "«", "त्त्": "Ù", "न्न्": "™",
  "क्ष": "{k", "त्र": "=", "ज्ञ": "K", "श्र": "J", "त्त": "Ùk", "क्त": "ä", "न्न": "é",
  "द्ध": ")", "द्व": "}", "द्य": "|", "द्द": "í", "द्र": "æ", "प्र": "ç", "क्र": "Ø", "फ्र": "Ý",
  "ग्र": "xz", "ह्र": "ºz", "ट्र": "Vª", "ड्र": "Mª", "ढ्र": "<ª", "छ्र": "Nª", "क्क": "ô",
  "ट्ट": "ê", "ट्ठ": "ë", "ड्ड": "ì", "ड्ढ": "ï", "ह्न": "à", "ह्य": "á", "ह्म": "ã", "हृ": "â",
  "दृ": "–", "कृ": "—", "छ्य": "Nî", "ट्य": "Vî", "ठ्य": "Bî", "ड्य": "Mî", "ढ्य": "<î",
  "रु": "#", "रू": ":", "ईं": "b±",
}; // prettier-ignore

const OTHERS: Record<string, string> = {
  // vowels
  ऑ: "v‚", ओ: "vks", औ: "vkS", आ: "vk", अ: "v", ई: "bZ", इ: "b", उ: "m", ऊ: "Å", ऐ: ",s", ए: ",",
  ऋ: "_",
  // vowel signs and other marks
  "ा": "k", "ी": "h", "ु": "q", "ू": "w", "ृ": "`", "े": "s", "ै": "S", "ो": "ks", "ौ": "kS",
  "ं": "a", "ँ": "¡", "ः": "%", "ॅ": "W", "ॉ": "‚", "्": "~", "़": "+", "ऽ": "•",
  // digits
  "०": "å", "१": "ƒ", "२": "„", "३": "…", "४": "†", "५": "‡", "६": "ˆ", "७": "‰", "८": "Š", "९": "‹",
  // punctuation, which the font also redraws
  "।": "A", "॥": "AA", "॰": "Œ", "(": "¼", ")": "½", ",": "]", ".": "-", "-": "&", "?": "\\",
  ";": "(", ":": "%", "=": "¾", "/": "@", "{": "¿", "}": "À", "‘": "^", "’": "*", "'": "*",
  "“": "Þ", "”": "ß", '"': "ß",
}; // prettier-ignore

const LONGEST = Math.max(...Object.keys(CONJUNCTS).map((key) => key.length));

function withNukta(full: string): string {
  // The nukta sits on the consonant's stem, before a trailing "k" (ख़ is "[+k").
  return full.length === 2 && full.endsWith("k") ? `${full[0]}+k` : `${full}+`;
}

function isConsonant(char: string | undefined): boolean {
  return char !== undefined && char in FULL;
}

/** Devanagari text in Kruti Dev 010's encoding. Only pass Devanagari: Latin letters mean other things there. */
export function unicodeToKrutiDev(text: string): string {
  // Nukta letters (ज़) are split into consonant + nukta; joiners carry nothing the font can show.
  const s = text
    .normalize("NFD")
    .replace(/[\u200C\u200D]/g, "")
    .replace(REPH_ON, `$1$2${REPH}`)
    .replace(SIGN_I_AFTER, `${PRE_I}$1`);
  let out = "";
  let i = 0;
  while (i < s.length) {
    const char = s[i]!;
    if (char === PRE_I || char === REPH) {
      out += char === PRE_I ? "f" : "Z";
      i += 1;
      continue;
    }
    const conjunct = conjunctAt(s, i);
    if (conjunct) {
      out += CONJUNCTS[conjunct];
      i += conjunct.length;
      continue;
    }
    if (isConsonant(char)) {
      const nukta = s[i + 1] === NUKTA;
      const full = nukta ? withNukta(FULL[char]!) : FULL[char]!;
      const next = i + (nukta ? 2 : 1);
      if (s[next] === VIRAMA && s[next + 1] === RA && s[next + 2] !== VIRAMA) {
        out += `${full}z`; // a consonant with the rakar below it: ब्र is "cz"
        i = next + 2;
      } else if (s[next] === VIRAMA) {
        // Before another consonant, the half form; at a word's end, the full form with a halant.
        const half = !nukta && isConsonant(s[next + 1]) ? HALF[char] : undefined;
        out += half ?? `${full}~`;
        i = next + 1;
      } else {
        out += full;
        i = next;
      }
      continue;
    }
    out += OTHERS[char] ?? char;
    i += 1;
  }
  return out;
}

function conjunctAt(s: string, i: number): string | null {
  for (let length = LONGEST; length >= 2; length -= 1) {
    const piece = s.slice(i, i + length);
    if (piece.length === length && piece in CONJUNCTS) return piece;
  }
  return null;
}

/** Text split into runs of Devanagari (with the spaces and punctuation between its words) and the rest. */
export function devanagariRuns(text: string): { text: string; devanagari: boolean }[] {
  const runs: { text: string; devanagari: boolean }[] = [];
  // Dashes end a run: the font draws "–" and "—" as दृ and कृ, so they print in the Latin font.
  const span =
    /[\u0900-\u097F](?:[\u0900-\u097F\u200C\u200D\s,.;:!?()'"\u2018\u2019\u201C\u201D\-/0-9]*[\u0900-\u097F])?/gu;
  let last = 0;
  for (const match of text.matchAll(span)) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index), devanagari: false });
    runs.push({ text: match[0], devanagari: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), devanagari: false });
  return runs;
}
