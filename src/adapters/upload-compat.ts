/** Reference firmware upload delegates to the shared authorized target and owned-session workflow. */
import { RunTargetSchema, executeNamedTarget } from "../tools/run-target.js";
import type { SerialClientContext } from "./serial-client.js";
import type { CompatibilityProjectDefaults } from "./compatibility-project.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";

const UploadCompatibilitySchema = RunTargetSchema.omit({ target: true });

/** Preserve reference upload parameters without allowing an alternate target to be injected. */
export function executeUploadCompatibility(
  input: unknown,
  client: SerialClientContext,
  defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const params = UploadCompatibilitySchema.parse(input);
  return executeNamedTarget(
    { ...params, target: "upload" },
    client,
    defaults,
    caller,
    onAuthorized,
  );
}
