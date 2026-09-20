/** Canonical build controls must reach the engine without bypassing existing locks. */
import { expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ build: vi.fn().mockResolvedValue({ success: true }), lock: vi.fn(callback => callback()) }));
vi.mock("../src/tools/build.js", () => ({ buildProject: mocks.build }));
vi.mock("../src/utils/lock-manager.js", () => ({ hardwareLockManager: { withImplicitLock: mocks.lock } }));
import { buildProjectCore } from "../src/core/build.js";
import { BuildProjectParamsSchema, CleanProjectParamsSchema } from "../src/types.js";

test("canonical parsed options reach build under the existing implicit lock", async () => {
  const input = BuildProjectParamsSchema.parse({ projectDir: "workspace", jobs: 4, forceExecution: true });
  await buildProjectCore(input);
  expect(mocks.lock).toHaveBeenCalledOnce();
  expect(mocks.build).toHaveBeenCalledWith("workspace", undefined, undefined, undefined, { jobs: 4, forceExecution: true });
});

test("old inputs remain valid and new destructive options are type checked", () => {
  expect(BuildProjectParamsSchema.parse({ projectDir: "workspace" })).toEqual({ projectDir: "workspace" });
  expect(CleanProjectParamsSchema.parse({ projectDir: "workspace", environment: "esp32", full: true })).toMatchObject({ environment: "esp32", full: true });
  expect(CleanProjectParamsSchema.safeParse({ projectDir: "workspace", full: "false" }).success).toBe(false);
  expect(BuildProjectParamsSchema.safeParse({ projectDir: "workspace", jobs: 0 }).success).toBe(false);
});
