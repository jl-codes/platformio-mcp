/** Startup composition must preserve retry scope and deny work after disconnect. */
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  forget: vi.fn(),
  close: vi.fn(),
  start: vi.fn(),
  remote: vi.fn(),
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
vi.mock("../src/core/debug/debug-remote-startup.js", () => ({
  startRemotePreparedDebugger: mocks.remote,
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
import { PlatformIOError } from "../src/utils/errors.js";
import { compatibilityErrorResult } from "../src/adapters/compatibility-error.js";
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
      frame: { function: "main", line: 12 },
    },
  });
  await client.close();
});

it("requires a host remote binding and never falls back to local USB discovery", async () => {
  mocks.prepare.mockResolvedValue({
    projectDir: "/project",
    environment: "debug",
    load: false,
    configuration: { server: null, port: "192.0.2.1:3333" },
  });
  await expect(new DebugCompatibilityClient().start({})).rejects.toMatchObject({
    code: "DEBUG_REMOTE_BINDING_REQUIRED",
  });
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.inventory).not.toHaveBeenCalled();
  const binding = {
    endpoint: "192.0.2.1:3333",
    identity: "host-target",
    revalidate: vi.fn(),
    acquireTarget: vi.fn(async () => ({
      prepareSpawn: vi.fn(),
      releaseAfterExit: vi.fn(),
    })),
  };
  const resolve = vi.fn(async () => binding);
  mocks.remote.mockResolvedValue("remote-id");
  const client = new DebugCompatibilityClient(undefined, resolve);
  await expect(client.start({ load: false })).resolves.toMatchObject({
    session_id: "remote-id",
  });
  expect(resolve).toHaveBeenCalledWith({
    projectDir: "/project",
    environment: "debug",
    endpoint: "192.0.2.1:3333",
  });
  expect(mocks.remote.mock.calls[0][1].binding).toBe(binding);
  await expect(client.start({ binding })).rejects.toMatchObject({
    code: "COMPAT_ARGUMENT_INVALID",
  });
  expect(resolve).toHaveBeenCalledOnce();
});

it("does not silently ignore a local probe selector for a remote target", async () => {
  mocks.prepare.mockResolvedValue({
    projectDir: "/project",
    environment: "debug",
    load: false,
    configuration: { server: null, port: "192.0.2.1:3333" },
  });
  const resolve = vi.fn();
  await expect(
    new DebugCompatibilityClient(undefined, resolve).start({
      probe: { serial_number: "1234" },
    }),
  ).rejects.toMatchObject({ code: "DEBUG_REMOTE_PROBE_SELECTOR_UNSUPPORTED" });
  expect(resolve).not.toHaveBeenCalled();
  expect(mocks.remote).not.toHaveBeenCalled();
});

it("uses the operator resolver by default for standalone MCP and CLI clients", async () => {
  const operator = await import("../src/core/debug/debug-operator-binding.js");
  const binding = {
    endpoint: "192.0.2.1:3333",
    identity: "operator-target",
    revalidate: vi.fn(),
    acquireTarget: vi.fn(),
  };
  const resolver = vi
    .spyOn(operator, "resolveOperatorRemoteDebugBinding")
    .mockResolvedValue(binding);
  try {
    mocks.prepare.mockResolvedValue({
      projectDir: "/project",
      environment: "debug",
      load: false,
      configuration: { server: null, port: "192.0.2.1:3333" },
    });
    mocks.remote.mockResolvedValue("standalone-remote");
    await expect(
      new DebugCompatibilityClient().start({ load: false }),
    ).resolves.toMatchObject({ session_id: "standalone-remote" });
    expect(resolver).toHaveBeenCalledWith({
      projectDir: "/project",
      environment: "debug",
      endpoint: "192.0.2.1:3333",
    });
    expect(mocks.remote.mock.calls[0][1].binding).toBe(binding);
  } finally {
    resolver.mockRestore();
  }
});

it("returns reference startup diagnostics while retaining canonical failure identity", async () => {
  mocks.prepare.mockRejectedValue(
    new PlatformIOError("Debug build failed", "DEBUG_BUILD_FAILED", {
      environment: "selected-debug",
      debugTool: "stlink",
      outputTail: "x".repeat(3000),
    }),
  );
  const client = new DebugCompatibilityClient();
  const error = await client.start({}).catch((error) => error);
  expect(error.code).toBe("DEBUG_BUILD_FAILED");
  expect(compatibilityErrorResult(error).structuredContent).toMatchObject({
    ok: false,
    error: "build_failed",
    env: "selected-debug",
    debug_tool: "stlink",
    output_tail: "x".repeat(2500),
    details: { code: "DEBUG_BUILD_FAILED" },
  });
});
it("does not translate or replace startup approval errors", async () => {
  const denied = new PlatformIOError("Approval needed", "APPROVAL_REQUIRED", {
    policyDecision: { approvalId: "retained" },
  });
  mocks.prepare.mockRejectedValue(denied);
  const client = new DebugCompatibilityClient();
  expect(await client.start({}).catch((error) => error)).toBe(denied);
});
