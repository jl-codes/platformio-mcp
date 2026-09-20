/** Compose a fresh owned serial trigger with meter execution without releasing DUT custody early. */
import type { z } from "zod";
import type { SerialClientContext } from "./serial-client.js";
import type {
  PowerMeterClient,
  Ppk2CompatibilitySchema,
} from "./power-meter-client.js";
import type { CompatibilityProjectDefaults } from "./compatibility-project.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";

/** The meter owner adopts the hold, including failed cleanup; this adapter must never release it speculatively. */
export async function executeTriggeredMeter(
  serial: SerialClientContext,
  meter: PowerMeterClient,
  params: z.infer<typeof Ppk2CompatibilitySchema>,
  defaults: CompatibilityProjectDefaults,
  caller: PolicyEvaluationContext,
  guard: () => void = () => {},
) {
  guard();
  if (!params.trigger || !params.trigger_session_id)
    return meter.run(params, defaults, caller, undefined, guard);
  return serial.run(
    { caller, readApprovalId: params.trigger_approval_id },
    async (service, owner) => {
      const trigger = await service.waitPowerTrigger(
        owner,
        params.trigger_session_id!,
        { trigger: params.trigger!, seconds: params.trigger_seconds },
      );
      guard();
      const hold = service.sessions.holdForPower(
        owner,
        params.trigger_session_id!,
      );
      return {
        ...(await meter.run(params, defaults, caller, hold, guard)),
        ...trigger,
      };
    },
  );
}
