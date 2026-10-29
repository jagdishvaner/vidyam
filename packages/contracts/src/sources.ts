import { z } from "zod";

import { Uuid } from "./common.js";
import { contract } from "./registry.js";

/** Where something came from in the center's material: a passage of a file, and its page. */
export const CitationRef = contract(
  "CitationRef",
  z.object({
    chunkId: Uuid,
    sourceId: Uuid,
    filename: z.string(),
    pageStart: z.number().int().nullable(),
    pageEnd: z.number().int().nullable(),
    /** The page number as printed in the book. */
    pageLabel: z.string().nullable(),
    quote: z.string(),
  }),
);
export type CitationRef = z.infer<typeof CitationRef>;
