import fs from "node:fs";
import path from "node:path";
import type { PolicyConfig } from "./types.js";
import { defaultPolicy } from "./default-policy.js";
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

export function loadEffectivePolicy(workspaceDir?: string): PolicyConfig {
  ensureDir(SERVER_DATA_DIR);
  const globalPath = path.join(SERVER_DATA_DIR, "policy.yaml");
  const localPath = workspaceDir
    ? path.join(workspaceDir, ".pio-mcp-workspace", "policy.yaml")
    : undefined;

  const globalOverride = loadPolicyFile(globalPath);
  const localOverride = localPath ? loadPolicyFile(localPath) : {};

  return mergePolicy(
    mergePolicy(defaultPolicy, globalOverride),
    localOverride,
  );
}
