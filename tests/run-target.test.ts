/** Named target execution must preserve policy effects and full-log report behavior. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  executeNamedTarget,
  resolveTargetSerialSelection,
} from "../src/tools/run-target.js";
import { executeProjectInspection } from "../src/tools/project-inspection.js";
import { listDevicesCore } from "../src/core/devices.js";
import { approveRequest } from "../src/core/policy/approvals.js";
import { buildTarget } from "../src/tools/build.js";
import { SerialClientContext } from "../src/adapters/serial-client.js";
vi.mock("../src/tools/project-inspection.js", () => ({
  executeProjectInspection: vi.fn(),
}));
vi.mock("../src/core/devices.js", () => ({ listDevicesCore: vi.fn() }));
vi.mock("../src/core/devices/serial-endpoint.js", () => ({
  resolveSerialEndpoint: (port: string) => ({
    canonicalPort: port,
    resource: { kind: "serial", identity: port },
    revalidate: () => {},
  }),
}));
vi.mock("../src/tools/build.js", () => ({ buildTarget: vi.fn() }));
vi.mock("../src/utils/lock-manager.js", () => ({
  hardwareLockManager: {
    withImplicitLock: (run: () => Promise<unknown>) => run(),
  },
}));
vi.mock("../src/utils/command-log.js", () => ({
  readCommandOutput: vi.fn(
    async () =>
      "Processing native (platform: native)\n===== [SUCCESS] Took 1 seconds =====",
  ),
  retainCommandLog: vi.fn(async () => "retained.log"),
}));
let project: string;
let operator: string;
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-run-target-"));
  operator = fs.mkdtempSync(path.join(os.tmpdir(), "pio-target-operator-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", operator);
  fs.writeFileSync(
    path.join(project, "platformio.ini"),
    "[env:native]\nplatform=native\n",
  );
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "build_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
  vi.mocked(buildTarget).mockReset();
  vi.mocked(buildTarget).mockImplementation(
    async (_project, _target, _env, _verbose, execution) => {
      await execution?.onResult?.({
        exitCode: 0,
        finalOutput: "ok",
        fullLogPath: "spool.log",
      });
      return { success: true, environment: "native" };
    },
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(operator, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});
it("executes a permitted named build and retains the reference result shape", async () => {
  const client = { run: vi.fn() } as unknown as SerialClientContext;
  const result = await executeNamedTarget(
    { target: "buildfs", project_dir: project },
    client,
  );
  expect(result).toMatchObject({
    ok: true,
    status: "success",
    log_path: "retained.log",
    exit_code: 0,
  });
  expect(result.summary).toContain("target-buildfs success");
  expect(buildTarget).toHaveBeenCalledOnce();
  expect(client.run).not.toHaveBeenCalled();
});
it.each(["upload", "uploadfs", "erase", "custom-flash"])(
  "denies %s before touching sessions or spawning",
  async (target) => {
    const client = { run: vi.fn() } as unknown as SerialClientContext;
    await expect(
      executeNamedTarget({ target, project_dir: project }, client),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(buildTarget).not.toHaveBeenCalled();
    expect(client.run).not.toHaveBeenCalled();
  },
);
it("preserves uncertain process custody errors", async () => {
  const error = Object.assign(new Error("cleanup pending"), {
    code: "PROCESS_CLEANUP_PENDING",
  });
  vi.mocked(buildTarget).mockRejectedValue(error);
  await expect(
    executeNamedTarget(
      { target: "buildfs", project_dir: project },
      {} as SerialClientContext,
    ),
  ).rejects.toBe(error);
});

it("uses the configured upload port and selected default environment without enumeration", async () => {
  vi.mocked(executeProjectInspection).mockResolvedValue({
    ok: true,
    defaultEnvironments: ["chosen"],
    envs: [
      { name: "other", uploadPort: "COM8" },
      { name: "chosen", uploadPort: "COM9" },
    ],
  } as never);
  vi.mocked(listDevicesCore).mockReset();
  await expect(
    resolveTargetSerialSelection(project, undefined, {}, {}),
  ).resolves.toEqual({ environment: "chosen", port: "COM9" });
  expect(listDevicesCore).not.toHaveBeenCalled();
});
it("refuses ambiguous devices instead of choosing the first board", async () => {
  vi.mocked(executeProjectInspection).mockResolvedValue({
    ok: true,
    defaultEnvironments: ["native"],
    envs: [{ name: "native" }],
  } as never);
  vi.mocked(listDevicesCore).mockResolvedValue([
    { port: "COM8", description: "ESP32", hwid: "USB VID:PID=1234:5678 SER=A" },
    { port: "COM9", description: "ESP32", hwid: "USB VID:PID=1234:5678 SER=B" },
  ]);
  await expect(
    resolveTargetSerialSelection(project, undefined, {}, {}),
  ).rejects.toMatchObject({ code: "TARGET_PORT_SELECTION_REQUIRED" });
  expect(buildTarget).not.toHaveBeenCalled();
});
it("resolves one likely board when no upload port is configured", async () => {
  vi.mocked(executeProjectInspection).mockResolvedValue({
    ok: true,
    defaultEnvironments: [],
    envs: [{ name: "native" }],
  } as never);
  vi.mocked(listDevicesCore).mockResolvedValue([
    { port: "COM9", description: "ESP32", hwid: "USB VID:PID=1234:5678 SER=B" },
  ]);
  await expect(
    resolveTargetSerialSelection(project, undefined, {}, {}),
  ).resolves.toEqual({ environment: "native", port: "COM9" });
});

it.each([
  [false, false, "TARGET_PORT_BUSY"],
  [true, true, "DEVICE_CLEANUP_PENDING"],
  [true, false, null],
] as const)(
  "handles monitor cleanup enabled=%s pending=%s",
  async (stopOpen, cleanupPending, code) => {
    fs.writeFileSync(
      path.join(project, ".pio-mcp-policy.json"),
      JSON.stringify({
        profile: "lab_runner",
        overrides: { audit_all_agent_actions: false },
      }),
    );
    const stop = vi.fn(async () => ({ cleanupPending }));
    const service = {
      sessions: {
        list: () => [
          {
            sessionId: "owned",
            path: "COM9",
            projectDir: project,
            state: "open",
            cleanupPending: false,
          },
        ],
        stop,
      },
    };
    const owner = {};
    const client = {
      run: async (
        _context: unknown,
        execute: (service: unknown, owner: unknown) => Promise<unknown>,
      ) => execute(service, owner),
    } as unknown as SerialClientContext;
    const request = {
      target: "uploadfs",
      project_dir: project,
      upload_port: "COM9",
      stop_open_sessions: stopOpen,
    };
    const decision = await executeNamedTarget(request, client).catch(
      (error) => error,
    );
    expect(decision.code).toBe("APPROVAL_REQUIRED");
    const approvalId = decision.context.policyDecision.approvalId;
    approveRequest(approvalId);
    const operation = executeNamedTarget(
      { ...request, approval_id: approvalId },
      client,
    );
    if (code) {
      await expect(operation).rejects.toMatchObject({ code });
      expect(buildTarget).not.toHaveBeenCalled();
    } else {
      await expect(operation).resolves.toMatchObject({
        ok: true,
        stopped_sessions: ["owned"],
      });
      expect(buildTarget).toHaveBeenCalledWith(
        expect.any(String),
        "uploadfs",
        undefined,
        false,
        expect.objectContaining({ uploadPort: "COM9", serialPort: "COM9" }),
      );
    }
    expect(stop).toHaveBeenCalledTimes(stopOpen ? 1 : 0);
    if (stopOpen) expect(stop).toHaveBeenCalledWith(owner, "owned");
  },
);

it("honors a public run_target denial before executing an allowed build category", async () => {
  fs.writeFileSync(path.join(project, ".pio-mcp-policy.json"), JSON.stringify({
    profile: "build_only", deny: ["run_target"],
    overrides: { audit_all_agent_actions: false },
  }));
  await expect(executeNamedTarget({ target: "buildfs", project_dir: project },
    {} as SerialClientContext)).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(buildTarget).not.toHaveBeenCalled();
});
