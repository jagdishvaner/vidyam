import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";

import { ENV, type Env } from "../../config/env.js";

export const CACHE_REDIS = Symbol("CACHE_REDIS");

/** One shared connection to valkey-cache (LRU-evicting): sessions cache, rate limits, later SSE streams. */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_REDIS,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.VIDYAM_CACHE_REDIS_URL, { maxRetriesPerRequest: 2 }),
    },
  ],
  exports: [CACHE_REDIS],
})
export class CacheModule implements OnApplicationShutdown {
  constructor(@Inject(CACHE_REDIS) private readonly redis: Redis) {}

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
