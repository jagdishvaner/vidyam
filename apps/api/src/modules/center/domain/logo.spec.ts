import { describe, expect, it } from "vitest";

import { logoKey, sniffLogo } from "./logo.js";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

describe("logo", () => {
  it("recognises PNG, JPEG and WebP by their bytes, and nothing else", () => {
    expect(sniffLogo(png)).toBe("image/png");
    expect(sniffLogo(jpeg)).toBe("image/jpeg");
    expect(sniffLogo(webp)).toBe("image/webp");
    expect(sniffLogo(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffLogo(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("names the stored file after its content, so a changed logo gets a new address", () => {
    const org = "0b6f2c1e-0000-4000-8000-000000000001";
    expect(logoKey(org, png, "image/png")).toMatch(
      /^org\/0b6f2c1e-0000-4000-8000-000000000001\/branding\/logo-[0-9a-f]{16}\.png$/,
    );
    expect(logoKey(org, png, "image/png")).not.toBe(logoKey(org, jpeg, "image/jpeg"));
  });
});
