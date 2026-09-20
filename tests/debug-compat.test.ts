/** Startup composition must preserve retry scope and deny work after disconnect. */
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  forget: vi.fn(),
  close: vi.fn(),
  start: vi.fn(),
  inventory: vi.fn(),
  project: vi.fn(),
}));
vi.mock("../src/core/debug/debug-preparation-cache.js", () => ({
  DebugPreparationCache: class {
    prepare = mocks.prepare;
    forget = mocks.forget;
    close = mocks.close;
  },
}));
vi.mock("../src/core/debug/debug-local-startup.js", () => ({
  startLocalPreparedDebugger: mocks.start,
}));
vi.mock("../src/adapters/compatibility-project.js", () => ({
  resolveCompatibilityProject: mocks.project,
}));
vi.mock("../src/core/devices/debug-probe-discovery.js", () => ({
  withDebugProbeDiscovery: async (
    _project: unknown,
    _approval: unknown,
    _caller: unknown,
    execute: (read: typeof mocks.inventory) => Promise<unknown>,
  ) => execute(mocks.inventory),
}));
import { DebugCompatibilityClient } from "../src/adapters/debug-compat.js";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.project.mockResolvedValue("/project");
  mocks.prepare.mockResolvedValue({
    projectDir: "/project",
    environment: "debug",
    load: false,
  });
  mocks.forget.mockResolvedValue(undefined);
  mocks.inventory.mockResolvedValue({ devices: [], unidentified: 0 });
  mocks.start.mockResolvedValue("owned-id");
});
it("forwards load, selection and grants without accepting caller executable authority", async () => {
  const confirm = vi.fn();
  const client = new DebugCompatibilityClient(confirm);
  const args = {
    load: false,
    timeout_s: 10,
    probe: { serial_number: "1234" },
    backend_host_approval_id: "host",
    backend_target_approval_id: "target",
  };
  expect(await client.start(args)).toMatchObject({
    session_id: "owned-id",
    load: false,
  });
  expect(mocks.start.mock.calls[0][1]).toMatchObject({
    timeoutMs: 10000,
    selector: { serialNumber: "1234" },
    confirmProbeReleased: confirm,
    backendHostApprovalId: "host",
    backendTargetApprovalId: "target",
  });
  expect(mocks.forget).toHaveBeenCalledOnce();
  await expect(
    client.start({ executable: "/untrusted/gdb" }),
  ).rejects.toMatchObject({ code: "COMPAT_ARGUMENT_INVALID" });
});
it("keeps preparation checkpoints and stable timeout scope when startup requires approval", async () => {
  mocks.start.mockRejectedValueOnce(new Error("approval pending"));
  const client = new DebugCompatibilityClient(async () => false);
  await expect(client.start({ timeout_s: 10 })).rejects.toThrow(
    "approval pending",
  );
  expect(mocks.forget).not.toHaveBeenCalled();
  await client.start(
    { timeout_s: 10, approval_id: "approved" },
    {},
    { taskId: "next-mcp-activity" },
  );
  expect(mocks.prepare.mock.calls[0][1].taskId).toBe(
    mocks.prepare.mock.calls[1][1].taskId,
  );
  expect(mocks.start.mock.calls.map((call) => call[1].timeoutMs)).toEqual([
    10000, 10000,
  ]);
});
it("excludes unidentified peripherals and closes admission on disconnect", async () => {
  mocks.inventory.mockResolvedValue({ devices: [], unidentified: 1 });
  mocks.start.mockImplementation(async (_sessions, input) => {
    await input.readInventory();
    return "id";
  });
  const client = new DebugCompatibilityClient(async () => false);
  await expect(client.start({})).resolves.toMatchObject({ session_id: "id" });
  expect(await mocks.start.mock.calls[0][1].readInventory()).toEqual([]);
  expect(await client.close()).toMatchObject({ cleanupPending: false });
  await expect(client.start({})).rejects.toMatchObject({
    code: "DEBUG_CLIENT_CLOSED",
  });
});
it("returns the initial observed stop frame instead of requiring a later list call", async () => {
  mocks.start.mockImplementation(async (sessions) =>
    sessions.start("/project", "debug", async () => ({
      command: vi.fn(),
      cleanupProcess: vi.fn(async () => {}),
      state: () => ({
        running: false,
        closed: false,
        exitCode: null,
        failed: false,
        cleanupPending: false,
        stderr: "",
        lastStop: {
          kind: "exec",
          class: "stopped",
          fields: [
            { name: "reason", value: "breakpoint-hit" },
            {
              name: "frame",
              value: {
                kind: "tuple",
                fields: [
                  { name: "func", value: "main" },
                  { name: "line", value: "12" },
                ],
              },
            },
          ],
        },
      }),
    })),
  );
  const client = new DebugCompatibilityClient();
  expect(await client.start({ load: false })).toMatchObject({
    running: false,
    closed: false,
    stopped: {
      reason: "breakpoint-hit",
      frame: { function: "main", line: "12" },
    },
  });
  await client.close();
});
