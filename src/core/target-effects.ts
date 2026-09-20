/**
 * Named-target effect classification and canonical authorization.
 * Unknown/custom targets require privileged host-code permission, never a build-name heuristic.
 */
import { dispatchAuthorizedAction } from "./action-dispatcher.js";
import type { PolicyEvaluationContext } from "./policy/types.js";
import { PlatformIOError } from "../utils/errors.js";

/** Minimum known effects; project build scripts remain trusted host code under build permission. */
export interface TargetEffects {
  operation: string; // Internal action whose canonical policy category matches the effect.
  effect:
    | "build"
    | "cleanup"
    | "firmware-upload"
    | "filesystem-upload"
    | "erase"
    | "custom";
  deviceAccess: "none" | "write" | "unknown"; // Does not itself resolve or lease a physical device.
}

/** Exact built-in names only; punctuation, casing and composed/custom names never downgrade privilege. */
export function classifyTargetEffects(target: string): TargetEffects {
  if (
    typeof target !== "string" ||
    !target.trim() ||
    target.length > 4096 ||
    target.startsWith("-") ||
    /[\x00-\x1f\x7f]/.test(target)
  )
    throw new PlatformIOError("Invalid named target.", "TARGET_INVALID");
  if (["buildprog", "buildfs", "size", "idedata", "compiledb"].includes(target))
    return { operation: "target_build", effect: "build", deviceAccess: "none" };
  if (["clean", "fullclean"].includes(target))
    return {
      operation: "target_cleanup",
      effect: "cleanup",
      deviceAccess: "none",
    };
  if (["upload", "nobuild"].includes(target))
    return {
      operation: "target_upload",
      effect: "firmware-upload",
      deviceAccess: "write",
    };
  if (["uploadfs", "uploadfsota"].includes(target))
    return {
      operation: "target_upload_filesystem",
      effect: "filesystem-upload",
      deviceAccess: "write",
    };
  if (target === "erase")
    return {
      operation: "target_erase",
      effect: "erase",
      deviceAccess: "write",
    };
  return {
    operation: "target_custom",
    effect: "custom",
    deviceAccess: "unknown",
  };
}

/**
 * Authorize the exact target and arguments before invoking trusted execution code.
 * Callbacks remain responsible for artifact binding, device custody and policy-revision checks.
 */
export function dispatchAuthorizedTarget<T>(
  target: string,
  args: Record<string, unknown>,
  caller: PolicyEvaluationContext,
  execute: (effects: Readonly<TargetEffects>) => Promise<T>,
): Promise<T> {
  const effects = Object.freeze(classifyTargetEffects(target));
  return dispatchAuthorizedAction(
    effects.operation,
    { ...args, target },
    caller,
    () => execute(effects),
  );
}
