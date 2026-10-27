import { Inject, Injectable } from "@nestjs/common";
import {
  LOGO_MAX_BYTES,
  type AiPolicy,
  type CenterProfile,
  type OrgBranding,
  type SelectableModel,
  type UpdateBrandingRequest,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";
import { logoKey, sniffLogo } from "../domain/logo.js";

/** Port: the center's settings row (org_settings) and the model registry. */
export interface CenterStore {
  load(orgId: string): Promise<Omit<CenterProfile, "logoUrl" | "selectableModels"> | null>;
  /** Enabled models the platform marks teacher-selectable. */
  selectableModels(): Promise<SelectableModel[]>;
  saveBranding(orgId: string, branding: OrgBranding): Promise<void>;
  saveAiPolicy(orgId: string, policy: AiPolicy): Promise<void>;
}
export const CENTER_STORE = Symbol("CENTER_STORE");

/** Port: where the logo image lives (S3, derived bucket). */
export interface LogoStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}
export const LOGO_STORE = Symbol("LOGO_STORE");

const logoUrl = (key: string | null) =>
  key ? `/api/center/logo?v=${key.split("logo-")[1]?.split(".")[0] ?? ""}` : null;

@Injectable()
export class CenterSettings {
  constructor(
    @Inject(CENTER_STORE) private readonly store: CenterStore,
    @Inject(LOGO_STORE) private readonly logos: LogoStore,
  ) {}

  async profile(orgId: string): Promise<CenterProfile> {
    const center = await this.require(orgId);
    return {
      ...center,
      logoUrl: logoUrl(center.branding.logoKey),
      selectableModels: await this.store.selectableModels(),
    };
  }

  async updateBranding(orgId: string, branding: UpdateBrandingRequest): Promise<void> {
    const center = await this.require(orgId);
    await this.store.saveBranding(orgId, { ...branding, logoKey: center.branding.logoKey });
  }

  /** Teachers may only be offered models the platform allows; an empty list means all of those. */
  async updateAiPolicy(orgId: string, policy: AiPolicy): Promise<void> {
    await this.require(orgId);
    const known = new Set((await this.store.selectableModels()).map((m) => m.id));
    const unknown = policy.allowedModelIds.filter((id) => !known.has(id));
    if (unknown.length)
      throw new DomainError(`Not models teachers can use: ${unknown.join(", ")}`, "invalid");
    await this.store.saveAiPolicy(orgId, policy);
  }

  async setLogo(orgId: string, bytes: Uint8Array): Promise<string> {
    if (bytes.byteLength > LOGO_MAX_BYTES)
      throw new DomainError("The logo must be 1 MB or smaller.", "invalid");
    const type = sniffLogo(bytes);
    if (!type) throw new DomainError("The logo must be a PNG, JPEG or WebP image.", "invalid");
    const center = await this.require(orgId);
    const key = logoKey(orgId, bytes, type);
    await this.logos.put(key, bytes, type);
    await this.store.saveBranding(orgId, { ...center.branding, logoKey: key });
    const previous = center.branding.logoKey;
    if (previous && previous !== key) await this.logos.delete(previous);
    return logoUrl(key)!;
  }

  async removeLogo(orgId: string): Promise<void> {
    const center = await this.require(orgId);
    if (!center.branding.logoKey) return;
    await this.store.saveBranding(orgId, { ...center.branding, logoKey: null });
    await this.logos.delete(center.branding.logoKey);
  }

  async logo(orgId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const key = (await this.require(orgId)).branding.logoKey;
    const logo = key ? await this.logos.get(key) : null;
    if (!logo) throw new DomainError("This center has no logo.", "not_found");
    return logo;
  }

  private async require(orgId: string) {
    const center = await this.store.load(orgId);
    if (!center) throw new DomainError("No such center.", "not_found");
    return center;
  }
}
