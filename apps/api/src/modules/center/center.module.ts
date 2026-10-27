import { Module } from "@nestjs/common";

import { bucketName, ENV, type Env } from "../../config/env.js";
import { createS3Client } from "../../shared/storage/s3.js";
import { CENTER_STORE, CenterSettings, LOGO_STORE } from "./application/manage-center.js";
import { DrizzleCenterStore } from "./infrastructure/drizzle-center-store.js";
import { S3LogoStore } from "./infrastructure/s3-logo-store.js";
import { CenterController } from "./interface/center.controller.js";

/** Composition root for Admin → Center profile: branding used in exports, and the center's AI policy. */
@Module({
  controllers: [CenterController],
  providers: [
    CenterSettings,
    { provide: CENTER_STORE, useClass: DrizzleCenterStore },
    {
      provide: LOGO_STORE,
      inject: [ENV],
      useFactory: (env: Env) => new S3LogoStore(createS3Client(env), bucketName(env, "derived")),
    },
  ],
})
export class CenterModule {}
