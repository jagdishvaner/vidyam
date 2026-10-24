import { Inject, Injectable } from "@nestjs/common";
import type { DependencyStatus, ServiceHealth, SystemStatus } from "@vidyam/contracts";

/** Port: one dependency this service needs. `check` resolves with an optional detail or throws. */
export interface DependencyProbe {
  readonly name: string;
  check(signal: AbortSignal): Promise<string | null>;
}
export const DEPENDENCY_PROBES = Symbol("DEPENDENCY_PROBES");

/** Port: the AI engine's own health report. */
export interface AiEngineHealthReader {
  read(signal: AbortSignal): Promise<ServiceHealth>;
}
export const AI_ENGINE_HEALTH = Symbol("AI_ENGINE_HEALTH");

export const API_VERSION = "0.1.0";
const TIMEOUT_MS = 2_000;

@Injectable()
export class CheckSystemStatus {
  constructor(
    @Inject(DEPENDENCY_PROBES) private readonly probes: DependencyProbe[],
    @Inject(AI_ENGINE_HEALTH) private readonly aiEngine: AiEngineHealthReader,
  ) {}

  async execute(): Promise<SystemStatus> {
    const [dependencies, ai] = await Promise.all([
      Promise.all(this.probes.map((probe) => runProbe(probe))),
      this.readAiEngine(),
    ]);
    const api: ServiceHealth = {
      service: "api",
      version: API_VERSION,
      ok: dependencies.every((d) => d.ok),
      dependencies,
    };
    return { ok: api.ok && ai.ok, services: [api, ai] };
  }

  private async readAiEngine(): Promise<ServiceHealth> {
    try {
      return await this.aiEngine.read(AbortSignal.timeout(TIMEOUT_MS));
    } catch (error) {
      return {
        service: "ai",
        version: "unknown",
        ok: false,
        dependencies: [{ name: "reachable", ok: false, latencyMs: 0, detail: describe(error) }],
      };
    }
  }
}

async function runProbe(probe: DependencyProbe): Promise<DependencyStatus> {
  const started = performance.now();
  try {
    const detail = await probe.check(AbortSignal.timeout(TIMEOUT_MS));
    return { name: probe.name, ok: true, latencyMs: elapsed(started), detail };
  } catch (error) {
    return { name: probe.name, ok: false, latencyMs: elapsed(started), detail: describe(error) };
  }
}

const elapsed = (started: number) => Math.round(performance.now() - started);
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
