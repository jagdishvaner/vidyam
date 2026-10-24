import { z } from "zod";

/**
 * Every schema shared across services is registered here under a stable id. The export script turns this
 * registry into one JSON Schema document (`generated/json-schema/contracts.schema.json`) from which the Python
 * AI engine's Pydantic models are generated, so TypeScript and Python can never disagree on a shape.
 */
export const contracts = z.registry<{ id: string; description?: string }>();

export function contract<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  // T is already a Zod schema; widening lets TypeScript resolve register()'s conditional parameter type.
  (schema as z.ZodType).register(contracts, description ? { id, description } : { id });
  return schema;
}
