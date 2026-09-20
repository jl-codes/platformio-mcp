/** Public power routing shares explicit policy, serial ownership and PPK2 cleanup capabilities. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import type { CompatibilityProjectDefaults } from "./compatibility-project.js";
import type { SerialClientContext } from "./serial-client.js";
import {
  PowerMeterClient,
  Ppk2CompatibilitySchema,
} from "./power-meter-client.js";
import {
  executeSerialPowerCompatibility,
  SerialPowerCompatibilitySchema,
} from "./power-serial-compat.js";
import { projectCompatibilityDevices } from "./device-compat.js";

/** Route validated modes; cleanup remains possible without granting further hardware effects. */
export async function executePowerCompatibility(
  serial: SerialClientContext,
  meter: PowerMeterClient,
  input: unknown,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  operationName: "power_profile" | "pio_power_profile" = "pio_power_profile",
) {
  const raw = z.record(z.unknown()).parse(input);
  if (raw.operation === "cleanup") {
    const args = z
      .object({
        operation: z.literal("cleanup"),
        power_operation_id: z.string().uuid(),
      })
      .strict()
      .parse(raw);
    return { ok: true, ...(await meter.cleanup(args.power_operation_id)) };
  }
  if (raw.operation === "list") {
    z.object({ operation: z.literal("list") })
      .strict()
      .parse(raw);
    return dispatchAuthorizedAction("query_logs", {}, caller, async () => ({
      ok: true,
      operations: meter.list(),
    }));
  }
  const { operation, profile_approval_id, ...request } = raw;
  z.literal("profile").optional().parse(operation);
  const approvalId = z.string().max(256).optional().parse(profile_approval_id);
  const params =
    request.source === "ppk2"
      ? Ppk2CompatibilitySchema.parse(request)
      : SerialPowerCompatibilitySchema.parse(request);
  let selected =
    params.project_dir || defaults.projectDir || defaults.cwd || process.cwd();
  if (
    selected === "~" ||
    selected.startsWith("~/") ||
    selected.startsWith("~\\")
  )
    selected = path.join(defaults.home ?? os.homedir(), selected.slice(2));
  const projectDir = await fs.realpath(
    path.resolve(defaults.cwd ?? process.cwd(), selected),
  );
  const scope = Object.fromEntries(
    Object.entries(params).filter(([key]) => !key.endsWith("approval_id")),
  );
  return dispatchAuthorizedAction(
    operationName,
    { ...scope, projectDir, approvalId },
    { ...caller, workspaceDir: projectDir },
    async () =>
      params.source === "ppk2"
        ? meter.run(params, defaults, caller)
        : executeSerialPowerCompatibility(
            serial,
            params,
            defaults,
            caller,
            projectCompatibilityDevices,
          ),
  );
}
