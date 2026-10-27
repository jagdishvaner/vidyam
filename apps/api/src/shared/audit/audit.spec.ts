import { describe, expect, it } from "vitest";

import { redact } from "./audit.js";

describe("audit data", () => {
  it("never keeps passwords, tokens or keys, at any depth", () => {
    expect(
      redact({
        name: "Asha",
        password: "hunter2-long",
        nested: { apiKey: "sk", items: [{ token: "t", ok: 1 }] },
      }),
    ).toEqual({
      name: "Asha",
      password: "[removed]",
      nested: { apiKey: "[removed]", items: [{ token: "[removed]", ok: 1 }] },
    });
  });

  it("keeps a note instead of a huge payload", () => {
    expect(redact({ subject: { children: "x".repeat(5000) } })).toEqual({
      truncated: true,
      fields: ["subject"],
    });
  });
});
