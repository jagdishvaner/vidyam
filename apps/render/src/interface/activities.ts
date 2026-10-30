import { ApplicationFailure } from "@temporalio/common";
import { RENDER_ACTIVITIES, RenderExportInput, type RenderExportResult } from "@vidyam/contracts";

import { ExportNotFound, type RenderExport } from "../application/render-export.js";

/**
 * The activities the render worker runs on the `render` queue (plan v3 step 29), called by name from the
 * AI engine's ExportDocument workflow. Inputs are checked against the contracts; a missing export is final.
 */
export function renderActivities(render: RenderExport): Record<string, (input: unknown) => Promise<unknown>> {
  return {
    [RENDER_ACTIVITIES.renderExport]: async (raw): Promise<RenderExportResult> => {
      const input = RenderExportInput.safeParse(raw);
      if (!input.success) {
        throw ApplicationFailure.nonRetryable(
          `invalid render_export input: ${input.error.message}`,
          "InvalidPayload",
        );
      }
      try {
        return await render.execute(input.data.orgId, input.data.exportId);
      } catch (error) {
        if (error instanceof ExportNotFound) throw ApplicationFailure.nonRetryable(error.message, "NotFound");
        throw error; // a database or storage hiccup, or Chromium crashing: Temporal retries
      }
    },
  };
}
