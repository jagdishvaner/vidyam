import { Module } from "@nestjs/common";

import { CommitResults, STUDIO_STORE } from "./application/commit-results.js";
import { DrizzleStudioStore } from "./infrastructure/drizzle-studio-store.js";

/** Documents and their generation (plan v3 §7). Workflows commit results through CommitResults (ADR 0017). */
@Module({
  providers: [CommitResults, { provide: STUDIO_STORE, useClass: DrizzleStudioStore }],
  exports: [CommitResults],
})
export class StudioModule {}
