/**
 * Validated, provenance-aware policy resolution.
 *
 * Provides:
 * - loadEffectivePolicyState: Resolves layers and preserves operator restrictions.
 * - loadEffectivePolicy: Returns the resolved policy for existing callers.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { PolicyConfig, PolicyProfileName } from "./types.js";
import { resolvePolicyProfile } from "./profiles.js";
import {
  parsePolicyDocument,
  PolicyConfigError,
  PolicyProfileConfigSchema,
} from "./policy-schema.js";
import { resolvePolicyDirectory, resolvePolicyFile } from "./policy-sources.js";

/** A configured layer, including missing optional sources. */
export interface PolicySource {
  kind: "builtin" | "project-profile" | "operator" | "project-override";
  source: string;
  present: boolean;
  sha256?: string;
}

/** Complete policy resolution and provenance used by execution and diagnostics. */
export interface EffectivePolicyState {
  profile: PolicyProfileName;
  source: string;
  policy: PolicyConfig;
  sources: PolicySource[];
  digest: string;
}

/** Applies only fields present in an already-validated override. */
function mergePolicy(
  base: PolicyConfig,
  override: Partial<PolicyConfig>,
): PolicyConfig {
  return { ...base, ...override };
}

/** Reads once, distinguishing a missing optional file from other I/O failures. */
function readLayer(source: string, required: boolean): string | undefined {
  try {
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > 64 * 1024) {
      throw new PolicyConfigError(
        source,
        "Expected a regular policy file no larger than 64 KiB.",
      );
    }
    return fs.readFileSync(source, "utf8");
  } catch (error) {
    if (error instanceof PolicyConfigError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !required)
      return undefined;
    throw new PolicyConfigError(
      source,
      required
        ? "The selected policy file is missing or unreadable."
        : "The configured policy file is unreadable.",
    );
  }
}

/** Adds policy-file content identity without storing its contents in diagnostic output. */
function recordSource(
  sources: PolicySource[],
  kind: PolicySource["kind"],
  source: string,
  text: string | undefined,
) {
  sources.push({
    kind,
    source,
    present: text !== undefined,
    ...(text === undefined
      ? {}
      : { sha256: crypto.createHash("sha256").update(text).digest("hex") }),
  });
}

/**
 * Restores operator restrictions after project overrides.
 * Explicit operator allow lists are ceilings, including an explicitly empty list.
 */
function applyOperatorCeiling(
  policy: PolicyConfig,
  operator: Partial<PolicyConfig>,
): PolicyConfig {
  const union = (left: string[], right: string[] = []) => [
    ...new Set([...left, ...right]),
  ];
  const approvalRequired = union(
    policy.approval_required,
    operator.approval_required,
  );
  const operatorActions =
    operator.allow === undefined
      ? undefined
      : new Set([...operator.allow, ...(operator.approval_required ?? [])]);
  const permitted = (action: string) =>
    operatorActions === undefined || operatorActions.has(action);
  return {
    ...policy,
    allow: policy.allow.filter(permitted),
    approval_required: approvalRequired.filter(permitted),
    deny: union(policy.deny, operator.deny),
    require_workspace_boundary:
      operator.require_workspace_boundary === true ||
      policy.require_workspace_boundary,
    require_device_lock_for_upload:
      operator.require_device_lock_for_upload === true ||
      policy.require_device_lock_for_upload,
    redact_secrets_from_logs:
      operator.redact_secrets_from_logs === true ||
      policy.redact_secrets_from_logs,
    audit_all_agent_actions:
      operator.audit_all_agent_actions === true ||
      policy.audit_all_agent_actions,
  };
}

/**
 * Resolves the project profile, operator policy and project overrides in legacy order.
 * Invalid sources throw; only absent optional sources use the built-in default.
 * @param workspaceDir - Explicit project scope, if any.
 * @returns Effective policy, source provenance and digest.
 */
export function loadEffectivePolicyState(
  workspaceDir?: string,
): EffectivePolicyState {
  let profile: PolicyProfileName = "flash_requires_approval";
  const sources: PolicySource[] = [
    {
      kind: "builtin",
      source: "built-in:flash_requires_approval",
      present: true,
    },
  ];
  let policy = resolvePolicyProfile({ profile });
  if (workspaceDir) {
    const source = path.join(
      path.resolve(workspaceDir),
      ".pio-mcp-policy.json",
    );
    const text = readLayer(source, false);
    recordSource(sources, "project-profile", source, text);
    if (text !== undefined) {
      const document = PolicyProfileConfigSchema.safeParse(
        parsePolicyDocument(text, source),
      );
      if (!document.success)
        throw new PolicyConfigError(
          source,
          "Project profile requires a valid profile name.",
        );
      profile = document.data.profile;
      policy = resolvePolicyProfile(document.data);
    }
  }
  const explicit = resolvePolicyFile();
  const operatorPath =
    explicit ?? path.join(resolvePolicyDirectory(), "policy.yaml");
  const operatorText = readLayer(operatorPath, explicit !== undefined);
  recordSource(sources, "operator", operatorPath, operatorText);
  let operator: Partial<PolicyConfig> = {};
  if (operatorText !== undefined) {
    const document = parsePolicyDocument(operatorText, operatorPath);
    if ("profile" in document) {
      profile = document.profile;
      operator = resolvePolicyProfile(document);
    } else operator = document;
    policy = mergePolicy(policy, operator);
  }
  if (workspaceDir) {
    const source = path.join(
      path.resolve(workspaceDir),
      ".pio-mcp-workspace",
      "policy.yaml",
    );
    const text = readLayer(source, false);
    recordSource(sources, "project-override", source, text);
    if (text !== undefined) {
      const document = parsePolicyDocument(text, source);
      if ("profile" in document)
        throw new PolicyConfigError(
          source,
          "Select a project profile in .pio-mcp-policy.json; this file contains overrides only.",
        );
      policy = mergePolicy(policy, document);
    }
  }
  policy = applyOperatorCeiling(policy, operator);
  const source = sources.filter((item) => item.present).at(-1)!.source;
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({ profile, policy, sources }))
    .digest("hex");
  return { profile, source, policy, sources, digest };
}

/** Returns the same validated policy used by the provenance-aware API. */
export function loadEffectivePolicy(workspaceDir?: string): PolicyConfig {
  return loadEffectivePolicyState(workspaceDir).policy;
}
