import fs from "node:fs";
import path from "node:path";
import type {
  PolicyConfig,
  PolicyProfileConfig,
  PolicyProfileName,
} from "./types.js";
import { resolvePolicyProfile } from "./profiles.js";
import { SERVER_DATA_DIR, ensureDir } from "../../utils/paths.js";

function parseBoolean(value: string): boolean {
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseSimpleYamlPolicy(yamlText: string): Partial<PolicyConfig> {
  const out: Partial<PolicyConfig> = {};
  const lines = yamlText.split(/\r?\n/);
  let currentListKey: keyof PolicyConfig | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("- ")) {
      if (!currentListKey) continue;
      const item = line.slice(2).trim();
      if (!item) continue;
      const existing = (out[currentListKey] as string[] | undefined) ?? [];
      (out as Record<string, unknown>)[currentListKey] = [...existing, item];
      continue;
    }

    currentListKey = undefined;
    const sepIdx = line.indexOf(":");
    if (sepIdx === -1) continue;
    const key = line.slice(0, sepIdx).trim() as keyof PolicyConfig;
    const value = line.slice(sepIdx + 1).trim();

    if (key === "approval_required" || key === "allow" || key === "deny") {
      if (value.startsWith("[") && value.endsWith("]")) {
        const parsed = value
          .slice(1, -1)
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x.length > 0);
        (out as Record<string, unknown>)[key] = parsed;
      } else {
        (out as Record<string, unknown>)[key] = [];
        currentListKey = key;
      }
      continue;
    }

    if (
      key === "require_workspace_boundary" ||
      key === "require_device_lock_for_upload" ||
      key === "redact_secrets_from_logs" ||
      key === "audit_all_agent_actions"
    ) {
      (out as Record<string, unknown>)[key] = parseBoolean(value);
    }
  }

  return out;
}

function mergePolicy(
  base: PolicyConfig,
  override: Partial<PolicyConfig>,
): PolicyConfig {
  return {
    approval_required: override.approval_required ?? base.approval_required,
    allow: override.allow ?? base.allow,
    deny: override.deny ?? base.deny,
    require_workspace_boundary:
      override.require_workspace_boundary ?? base.require_workspace_boundary,
    require_device_lock_for_upload:
      override.require_device_lock_for_upload ?? base.require_device_lock_for_upload,
    redact_secrets_from_logs:
      override.redact_secrets_from_logs ?? base.redact_secrets_from_logs,
    audit_all_agent_actions:
      override.audit_all_agent_actions ?? base.audit_all_agent_actions,
  };
}

function loadPolicyFile(policyPath: string): Partial<PolicyConfig> {
  if (!fs.existsSync(policyPath)) return {};
  const text = fs.readFileSync(policyPath, "utf8");
  try {
    return JSON.parse(text) as Partial<PolicyConfig>;
  } catch {
    return parseSimpleYamlPolicy(text);
  }
}

function isPolicyProfileName(value: string): value is PolicyProfileName {
  return (
    value === "read_only" ||
    value === "build_only" ||
    value === "flash_requires_approval" ||
    value === "lab_admin"
  );
}

function loadProfileConfig(
  workspaceDir?: string,
): { profile: PolicyProfileName; source: string; overrides?: Partial<PolicyConfig> } {
  const fallbackProfile: PolicyProfileName = "flash_requires_approval";
  if (!workspaceDir) {
    return {
      profile: fallbackProfile,
      source: "built-in:flash_requires_approval",
    };
  }

  const profilePath = path.join(workspaceDir, ".pio-mcp-policy.json");
  if (!fs.existsSync(profilePath)) {
    return {
      profile: fallbackProfile,
      source: "built-in:flash_requires_approval",
    };
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(profilePath, "utf8"),
    ) as PolicyProfileConfig;

    if (!parsed || typeof parsed.profile !== "string" || !isPolicyProfileName(parsed.profile)) {
      return {
        profile: fallbackProfile,
        source: `invalid-profile:${profilePath}`,
      };
    }

    return {
      profile: parsed.profile,
      source: profilePath,
      overrides: parsed.overrides,
    };
  } catch {
    return {
      profile: fallbackProfile,
      source: `invalid-profile:${profilePath}`,
    };
  }
}

export interface EffectivePolicyState {
  profile: PolicyProfileName;
  source: string;
  policy: PolicyConfig;
}

export function loadEffectivePolicyState(workspaceDir?: string): EffectivePolicyState {
  ensureDir(SERVER_DATA_DIR);
  const globalPath = path.join(SERVER_DATA_DIR, "policy.yaml");
  const localPath = workspaceDir
    ? path.join(workspaceDir, ".pio-mcp-workspace", "policy.yaml")
    : undefined;

  const profileConfig = loadProfileConfig(workspaceDir);
  const basePolicy = resolvePolicyProfile({
    profile: profileConfig.profile,
    overrides: profileConfig.overrides,
  });
  const globalOverride = loadPolicyFile(globalPath);
  const localOverride = localPath ? loadPolicyFile(localPath) : {};

  const withGlobal = mergePolicy(basePolicy, globalOverride);
  const policy = mergePolicy(withGlobal, localOverride);

  return {
    profile: profileConfig.profile,
    source: profileConfig.source,
    policy,
  };
}

export function loadEffectivePolicy(workspaceDir?: string): PolicyConfig {
  return loadEffectivePolicyState(workspaceDir).policy;
}
