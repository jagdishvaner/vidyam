import { createHash } from "node:crypto";

export type LogoType = "image/png" | "image/jpeg" | "image/webp";

/**
 * The image type from the file's own bytes, never the browser's claim, so a renamed HTML or SVG file can't be
 * served back as a "logo". SVG is not accepted at all: it can carry scripts.
 */
export function sniffLogo(bytes: Uint8Array): LogoType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

const EXTENSIONS: Record<LogoType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Content-addressed, so a new logo gets a new key and browsers never show a stale one. */
export function logoKey(orgId: string, bytes: Uint8Array, type: LogoType): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return `org/${orgId}/branding/logo-${hash}.${EXTENSIONS[type]}`;
}
