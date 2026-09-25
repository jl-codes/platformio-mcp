/**
 * Strict policy document validation.
 *
 * Provides:
 * - PolicyConfigError: A typed, non-permissive configuration failure.
 * - PolicyOverridesSchema: Validates known actions and typed safety switches.
 * - PolicyProfileConfigSchema: Validates the supported profile document.
 * - parsePolicyDocument: Parses one bounded JSON or YAML document.
 */
import path from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import { PlatformIOError } from "../../utils/errors.js";
import { actionRiskLevels, defaultPolicy } from "./default-policy.js";

/** Profile names supported by the existing runtime. */
export const PolicyProfileNameSchema = z.enum([
  "read_only",
  "build_only",
  "monitor_only",
  "flash_requires_approval",
  "lab_runner",
  "lab_admin",
]);

/** Known actions include explicit hard-deny names and the legacy status action. */
const KNOWN_ACTIONS = new Set([
  ...Object.keys(actionRiskLevels),
  ...defaultPolicy.deny,
  "check_task_status",
]);
const ActionListSchema = z
  .array(
    z
      .string()
      .refine((action) => KNOWN_ACTIONS.has(action), "Unknown policy action"),
  )
  .max(256);

/** Strict partial policy; an explicitly empty list remains empty. */
export const PolicyOverridesSchema = z
  .object({
    approval_required: ActionListSchema.optional(),
    allow: ActionListSchema.optional(),
    deny: ActionListSchema.optional(),
    require_workspace_boundary: z.boolean().optional(),
    require_device_lock_for_upload: z.boolean().optional(),
    redact_secrets_from_logs: z.boolean().optional(),
    audit_all_agent_actions: z.boolean().optional(),
  })
  .strict();

/** Strict profile selection with optional validated action overrides. */
export const PolicyProfileConfigSchema = z
  .object({
    profile: PolicyProfileNameSchema,
    overrides: PolicyOverridesSchema.optional(),
  })
  .strict();

/** A flat override or a profile document, never an ambiguous mixture. */
export const PolicyDocumentSchema = z.union([
  PolicyProfileConfigSchema,
  PolicyOverridesSchema,
]);

/** Maximum policy source size before parsing or expansion. */
const MAX_POLICY_BYTES = 64 * 1024;

/** A policy error carries its source but never includes full file contents. */
export class PolicyConfigError extends PlatformIOError {
  /** Creates an actionable configuration error without exposing source contents. */
  constructor(
    public readonly source: string,
    detail: string,
  ) {
    super(`Invalid policy at ${source}: ${detail}`, "POLICY_CONFIG_INVALID", {
      source,
    });
    this.name = "PolicyConfigError";
  }
}

/**
 * Parses one strict, bounded policy source; JSON is never retried as YAML.
 * @param text - Source file contents.
 * @param source - File path used for format selection and diagnostics.
 * @returns Validated profile or partial-policy document.
 */
export function parsePolicyDocument(text: string, source: string) {
  if (Buffer.byteLength(text, "utf8") > MAX_POLICY_BYTES) {
    throw new PolicyConfigError(source, "Policy exceeds the 64 KiB limit.");
  }
  const extension = path.extname(source).toLowerCase();
  if (![".json", ".yaml", ".yml"].includes(extension)) {
    throw new PolicyConfigError(
      source,
      "Use a .json, .yaml or .yml policy file.",
    );
  }
  try {
    // JSON.parse enforces JSON syntax; YAML's document parser also detects duplicate keys.
    if (extension === ".json") JSON.parse(text);
    const document = parseDocument(text, {
      version: "1.2",
      strict: true,
      uniqueKeys: true,
      prettyErrors: false,
    });
    if (document.errors.length || document.warnings.length) {
      throw new PolicyConfigError(
        source,
        "Malformed, duplicate-key or unsupported YAML/JSON document.",
      );
    }
    const value: unknown = document.toJS({ maxAliasCount: 0 });
    const parsed = PolicyDocumentSchema.safeParse(value);
    if (!parsed.success) {
      throw new PolicyConfigError(
        source,
        "Expected a known profile or typed policy fields containing known actions; unknown fields are not allowed.",
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof PolicyConfigError) throw error;
    throw new PolicyConfigError(
      source,
      "Malformed JSON/YAML or unsupported aliases. Repair this file before executing operations.",
    );
  }
}
