/**
 * Writes every registered contract as one JSON Schema document. The Python AI engine generates its Pydantic
 * models from this file (`pnpm codegen`), and CI fails if the committed output is stale.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { contracts } from "../src/index.js";

export function buildContractsDocument(): Record<string, unknown> {
  const { schemas } = z.toJSONSchema(contracts, {
    uri: (id) => `#/$defs/${id}`,
    target: "draft-2020-12",
    override: ({ jsonSchema }) => {
      // The format is enough; the extra regex makes Pydantic reject the field (no pattern on UUID or datetime
      // types), so a payload with a timestamp could never be validated in Python.
      if (["uuid", "date-time", "date", "time"].includes(String(jsonSchema.format)))
        delete jsonSchema.pattern;
    },
  });
  const defs = Object.fromEntries(
    Object.entries(schemas)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, schema]) => {
        const { $schema: _schema, $id: _id, ...rest } = schema as Record<string, unknown>;
        return [id, { title: id, ...rest }];
      }),
  );
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "VidyamContracts",
    description: "Generated from @vidyam/contracts. Do not edit; run `pnpm codegen`.",
    $defs: defs,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = path.join(import.meta.dirname, "..", "generated", "json-schema", "contracts.schema.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(buildContractsDocument(), null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}
