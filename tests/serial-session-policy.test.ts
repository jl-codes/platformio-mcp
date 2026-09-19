/** Real serial policy/approval integration with disposable mock ports, never physical hardware. */
import { resolveSerialEndpoint } from "../src/core/devices/serial-endpoint.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SerialPortMock } from "serialport";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PolicySerialSessionService } from "../src/core/serial/session-policy.js";
import {
  DirectSerialTransport,
  type createDirectSerialTransport,
} from "../src/core/serial/serial-transport.js";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
import { approveRequest } from "../src/core/policy/approvals.js";
import { authorizeAction } from "../src/core/action-dispatcher.js";
import {
  MCP_ACTIONS,
  policyNamesForOperation,
} from "../src/core/action-catalog.js";
import type { SerialSessionRequest } from "../src/core/serial/session-manager.js";

let root: string;
const cleanups: Array<() => Promise<unknown>> = [];
beforeEach(() => {
  root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "pio-serial-policy-"),
  );
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "operator"));
  vi.stubEnv("PIO_MCP_POLICY_FILE", undefined);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function fixture(
  extra: ConstructorParameters<typeof PolicySerialSessionService>[0] = {},
) {
  const projectDir = path.join(root, randomUUID());
  fs.mkdirSync(projectDir);
  const ports = new Map<string, SerialPortMock>();
  const transport = vi.fn<typeof createDirectSerialTransport>(
    async (options, onData) => {
      SerialPortMock.binding.createPort(options.path, {
        echo: true,
        record: true,
      });
      const port = new SerialPortMock({
        path: options.path,
        baudRate: options.baudRate,
        autoOpen: false,
      });
      ports.set(options.path, port);
      return new DirectSerialTransport(port, options, onData);
    },
  );
  const leases = new DeviceLeaseStore({
    root: path.join(root, "leases"),
    inspect: () => ({
      status: "running",
      identity: {
        pid: process.pid,
        platform: process.platform,
        startToken: "fixture",
      },
    }),
  });
  const service = new PolicySerialSessionService({
    ...extra,
    leases,
    transport,
  });
  const owner = service.sessions.createOwner();
  const request: SerialSessionRequest = {
    projectDir,
    path: `MOCK_${randomUUID()}`,
    baudRate: 115200,
    resource: { kind: "serial", identity: randomUUID() },
  };
  cleanups.push(() => service.sessions.stopAll(owner));
  const policy = (value: unknown) =>
    fs.writeFileSync(
      path.join(projectDir, ".pio-mcp-policy.json"),
      JSON.stringify(value),
    );
  return { service, owner, request, projectDir, ports, transport, policy };
}
async function approval(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const failure = error as {
      code?: string;
      context?: { policyDecision?: { approvalId?: string } };
    };
    expect(failure.code).toBe("APPROVAL_REQUIRED");
    const id = failure.context?.policyDecision?.approvalId;
    expect(id).toBeTruthy();
    return id!;
  }
  throw new Error("Expected an approval challenge");
}
it("keeps implemented internal actions separate from the advertised MCP registry", () => {
  expect(Object.keys(MCP_ACTIONS)).toHaveLength(53);
  expect(MCP_ACTIONS.serial_session_write).toBeUndefined();
  expect(policyNamesForOperation("serial_session_write")).toEqual([
    "serial_session_write",
    "upload_firmware",
  ]);
});
it.each(["read_only", "build_only"])(
  "blocks serial opening under %s before native construction",
  async (profile) => {
    const f = fixture();
    f.policy({ profile });
    await expect(
      f.service.run({}, () => f.service.sessions.start(f.owner, f.request)),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(f.transport).not.toHaveBeenCalled();
  },
);
it("requires a request context instead of falling back to implicit authorization", async () => {
  const f = fixture();
  await expect(
    f.service.sessions.start(f.owner, f.request),
  ).rejects.toMatchObject({ code: "SERIAL_AUTHORIZATION_CONTEXT_REQUIRED" });
  expect(f.transport).not.toHaveBeenCalled();
});
it("allows monitor-only reads but blocks command writes even with actor=user", async () => {
  const f = fixture();
  f.policy({ profile: "monitor_only" });
  const started = await f.service.run({}, () =>
    f.service.sessions.start(f.owner, f.request),
  );
  f.ports.get(f.request.path)!.port!.emitData("observed\n");
  expect(
    await f.service.run({}, () =>
      f.service.sessions.read(f.owner, started.sessionId, {
        waitFor: "observed",
        timeoutMs: 1000,
      }),
    ),
  ).toMatchObject({ matched: true });
  await expect(
    f.service.run({ caller: { actor: "user" } }, () =>
      f.service.sessions.write(
        f.owner,
        started.sessionId,
        Buffer.from("command"),
      ),
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(f.ports.get(f.request.path)!.port!.recording.length).toBe(0);
});
it("binds default write approvals to exact bytes and consumes them once", async () => {
  const f = fixture();
  const started = await f.service.run({}, () =>
    f.service.sessions.start(f.owner, f.request),
  );
  const write = (text: string, approvalId?: string) =>
    f.service.run({ approvalId, caller: { actor: "user" } }, () =>
      f.service.sessions.write(f.owner, started.sessionId, Buffer.from(text)),
    );
  const id = await approval(write("allowed"));
  approveRequest(id);
  await approval(write("different", id));
  expect(f.ports.get(f.request.path)!.port!.recording.length).toBe(0);
  expect(await write("allowed", id)).toEqual({
    bytesWritten: 7,
    drained: true,
  });
  await approval(write("allowed", id));
  expect(f.ports.get(f.request.path)!.port!.recording.toString()).toBe(
    "allowed",
  );
});
it("retries start approval despite a newly generated session ID and rejects a changed baud", async () => {
  const f = fixture();
  f.policy({
    profile: "flash_requires_approval",
    overrides: { approval_required: ["serial_session_start"] },
  });
  const start = (baudRate: number, approvalId?: string) =>
    f.service.run({ approvalId }, () =>
      f.service.sessions.start(f.owner, { ...f.request, baudRate }),
    );
  const id = await approval(start(115200));
  approveRequest(id);
  await approval(start(9600, id));
  expect(f.transport).not.toHaveBeenCalled();
  const started = await start(115200, id);
  expect(started.state).toBe("open");
  await f.service.sessions.stop(f.owner, started.sessionId);
  await approval(start(115200, id));
});
it("rejects a firmware-upload grant for a serial command", async () => {
  const f = fixture();
  const started = await f.service.run({}, () =>
    f.service.sessions.start(f.owner, f.request),
  );
  const grant = await authorizeAction(
    "upload_firmware",
    { projectDir: f.projectDir, port: f.request.path },
    { workspaceDir: f.projectDir, devicePort: f.request.path },
  );
  approveRequest(grant.approvalId!);
  await approval(
    f.service.run({ approvalId: grant.approvalId }, () =>
      f.service.sessions.write(
        f.owner,
        started.sessionId,
        Buffer.from("command"),
      ),
    ),
  );
  expect(f.ports.get(f.request.path)!.port!.recording.length).toBe(0);
});
it("honors concrete-operation denies without silently denying the category's other operations", async () => {
  const f = fixture();
  f.policy({
    profile: "flash_requires_approval",
    overrides: { deny: ["serial_session_start"] },
  });
  await expect(
    f.service.run({}, () => f.service.sessions.start(f.owner, f.request)),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(
    (
      await authorizeAction(
        "start_monitor",
        { projectDir: f.projectDir, port: f.request.path },
        { workspaceDir: f.projectDir },
      )
    ).status,
  ).toBe("allow");
});
it("uses the canonical session project instead of a supplied caller workspace", async () => {
  const f = fixture();
  f.policy({ profile: "read_only" });
  await expect(
    f.service.run({ caller: { workspaceDir: root, devicePort: "fake" } }, () =>
      f.service.sessions.start(f.owner, f.request),
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
});
it("retains owned cleanup when policy becomes invalid", async () => {
  const f = fixture();
  const started = await f.service.run({}, () =>
    f.service.sessions.start(f.owner, f.request),
  );
  fs.writeFileSync(path.join(f.projectDir, ".pio-mcp-policy.json"), "{invalid");
  await expect(
    f.service.run({}, () =>
      f.service.sessions.read(f.owner, started.sessionId),
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(f.service.sessions.list(f.owner)).toHaveLength(1);
  expect(
    await f.service.sessions.stop(f.owner, started.sessionId),
  ).toMatchObject({ cleanupPending: false });
});
it("rejects a real policy change during backend loading before the port opens", async () => {
  const f = fixture();
  const original = f.transport.getMockImplementation()!;
  f.transport.mockImplementation(async (...args) => {
    const transport = await original(...args);
    f.policy({ profile: "read_only" });
    return transport;
  });
  await expect(
    f.service.run({}, () => f.service.sessions.start(f.owner, f.request)),
  ).rejects.toMatchObject({
    code: "POLICY_CHANGED",
    context: { cleanupPending: false },
  });
  expect(f.ports.get(f.request.path)!.isOpen).toBe(false);
});

it("authorizes native discovery with the real inspection policy before loading", async () => {
  const f = fixture();
  const list = vi.fn(async () => [{ path: "COM42" }]);
  const load = vi.fn(async () => ({ list }));
  const service = new PolicySerialSessionService({ discoveryLoad: load });
  await expect(service.listSerialDevices(f.projectDir)).rejects.toMatchObject({
    code: "SERIAL_AUTHORIZATION_CONTEXT_REQUIRED",
  });
  expect(load).not.toHaveBeenCalled();
  await expect(
    service.run({}, () => service.listSerialDevices(f.projectDir)),
  ).resolves.toEqual([{ path: "COM42" }]);
  f.policy({ profile: "read_only", overrides: { deny: ["list_devices"] } });
  await expect(
    service.run({}, () => service.listSerialDevices(f.projectDir)),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(load).toHaveBeenCalledTimes(1);
});

it("consumes a separate one-use inspection approval and never reuses the session grant", async () => {
  const f = fixture();
  f.policy({
    profile: "flash_requires_approval",
    overrides: { approval_required: ["list_devices"] },
  });
  const load = vi.fn(async () => ({ list: async () => [{ path: "COM42" }] }));
  const service = new PolicySerialSessionService({ discoveryLoad: load });
  const enumerate = (discoveryApprovalId?: string, approvalId?: string) =>
    service.run({ discoveryApprovalId, approvalId }, () =>
      service.listSerialDevices(f.projectDir),
    );
  const id = await approval(enumerate());
  approveRequest(id);
  await approval(enumerate(undefined, id));
  expect(load).not.toHaveBeenCalled();
  await expect(enumerate(id)).resolves.toEqual([{ path: "COM42" }]);
  await approval(enumerate(id));
  expect(load).toHaveBeenCalledTimes(1);
});

it("authorizes bounded startup discovery once without replaying a list_devices grant", async () => {
  const list = vi.fn(async () => [
    {
      path: "COM44",
      vendorId: "10c4",
      productId: "ea60",
      serialNumber: "fixture",
    },
  ]);
  const f = fixture({
    discoveryLoad: async () => ({ list }),
    resolveEndpoint: (port) =>
      resolveSerialEndpoint(port, { platform: "win32" }),
  });
  f.policy({
    profile: "flash_requires_approval",
    overrides: { approval_required: ["list_devices"] },
  });
  const request = { projectDir: f.projectDir, path: "COM44", baudRate: 115200 };
  const start = (discoveryApprovalId?: string) =>
    f.service.run({ discoveryApprovalId }, () =>
      f.service.startWithDiscovery(f.owner, request),
    );
  const id = await approval(start());
  expect(list).not.toHaveBeenCalled();
  approveRequest(id);
  const session = await start(id);
  expect(session.state).toBe("open");
  expect(list).toHaveBeenCalledTimes(4);
  await f.service.sessions.stop(f.owner, session.sessionId);
  await approval(start(id));
  expect(list).toHaveBeenCalledTimes(4);
});
