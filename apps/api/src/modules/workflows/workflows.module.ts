import { Module } from "@nestjs/common";

import { ChatModule } from "../chat/chat.module.js";
import { StudioModule } from "../studio/studio.module.js";
import { ApiActivities } from "./api-activities.js";
import { ApiWorker } from "./api-worker.js";

/** The API's side of workflows (ADR 0017): its Temporal worker and the activities it runs. */
@Module({
  imports: [ChatModule, StudioModule],
  providers: [ApiActivities, ApiWorker],
  exports: [ApiWorker],
})
export class WorkflowsModule {}
