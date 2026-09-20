/** Startup orchestration preserves artifacts and cleanup ownership across attachment failures. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/core/debug/debug-elf.js", async (original) => ({
  ...(await original<typeof import("../src/core/debug/debug-elf.js")>()),
  retainDebugElf: vi.fn(async () => ({
    path: path.resolve("snapshot.elf"),
    identity: {},
    release: vi.fn(async () => {}),
  })),
}));
vi.mock("../src/core/analysis/private-analysis-directory.js", () => ({
  createPrivateAnalysisDirectory: vi.fn(async () =>
    fs.mkdtempSync(path.join(root, "init-")),
  ),
}));
import { retainDebugElf } from "../src/core/debug/debug-elf.js";
import { DebugProcess } from "../src/core/debug/debug-process.js";
import { DebugClientSessions } from "../src/core/debug/debug-client-sessions.js";
import { approveRequest, getApproval } from "../src/core/policy/approvals.js";
import { GdbMiSession } from "../src/core/debug/gdb-mi-session.js";
import { executeDebugInitialization } from "../src/core/debug/debug-init-execution.js";
import { attachDebuggerTarget } from "../src/core/debug/debug-target.js";
import type { PreparedDebuggerStartup } from "../src/core/debug/debug-startup.js";
import { startPreparedDebugger } from "../src/core/debug/debug-startup.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-debug-startup-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", root);
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "operator.json"));
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "run_shell_command"],
        deny: [],
        approval_required: [],
        audit_all_agent_actions: false,
      },
    }),
  );
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const process = {
    initialize: vi.fn<DebugProcess["initialize"]>(async () => {}),
    attach: vi.fn<DebugProcess["attach"]>(async () => {}),
    command: vi.fn(),
    state: vi.fn(() => ({})),
    cleanupProcess: vi.fn(async () => {}),
  };
  vi.spyOn(DebugProcess, "start").mockResolvedValue(
    process as unknown as DebugProcess,
  );
  const acquireCustody = vi.fn(async () => ({
    custody: { prepareSpawn: vi.fn(), releaseAfterExit: vi.fn() },
    confirmProbeReleased: async () => true,
  }));
  const selection = {
    projectDir: root,
    environment: "esp",
    elfPath: path.join(root, "firmware.elf"),
    expectedElfSha256: "a".repeat(64),
    executable: path.join(root, "host-gdb"),
    trustedDebuggerRoots: [root],
    target: { host: "127.0.0.1", port: 3333, load: false },
    acquireCustody,
  };
  return { process, selection };
}
it("keeps the snapshot until successful session cleanup", async () => {
  const { process, selection } = fixture(),
    sessions = new DebugClientSessions();
  const id = await startPreparedDebugger(sessions, selection);
  const lease = await vi.mocked(retainDebugElf).mock.results[0].value;
  expect(DebugProcess.start).toHaveBeenCalledWith(
    expect.objectContaining({ elfPath: path.resolve("snapshot.elf") }),
  );
  expect(process.attach).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: id, load: false }),
    {},
  );
  expect(lease.release).not.toHaveBeenCalled();
  await sessions.stop(id);
  expect(lease.release).toHaveBeenCalledOnce();
});
it("retains a failed attachment when probe cleanup cannot be confirmed", async () => {
  const { process, selection } = fixture(),
    sessions = new DebugClientSessions();
  process.attach.mockRejectedValueOnce(new Error("attachment failed"));
  process.cleanupProcess.mockRejectedValueOnce(new Error("probe busy"));
  await expect(
    startPreparedDebugger(sessions, selection),
  ).rejects.toMatchObject({ code: "GDB_START_FAILED" });
  const lease = await vi.mocked(retainDebugElf).mock.results[0].value;
  expect(lease.release).not.toHaveBeenCalled();
  const [retained] = sessions.list();
  await sessions.stop(retained.session_id);
  expect(lease.release).toHaveBeenCalledOnce();
});
it("denies startup before allocating artifacts or probe custody", async () => {
  const { selection } = fixture(),
    sessions = new DebugClientSessions();
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({ profile: "read_only" }),
  );
  await expect(
    startPreparedDebugger(sessions, selection),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(retainDebugElf).not.toHaveBeenCalled();
  expect(selection.acquireCustody).not.toHaveBeenCalled();
  expect(DebugProcess.start).not.toHaveBeenCalled();
});

it("consumes real connect, load and host approvals only after the complete request is ready", async () => {
  const { process, selection } = fixture(),
    sessions = new DebugClientSessions();
  const selected: PreparedDebuggerStartup = {
    ...selection,
    target: { ...selection.target, load: true },
  };
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "run_shell_command"],
        deny: [],
        approval_required: ["upload_firmware", "run_shell_command"],
        audit_all_agent_actions: false,
      },
    }),
  );
  const lines: string[] = [];
  const transport = new GdbMiSession(async (line) => {
    lines.push(line);
    const token = /^(\d+)/.exec(line)![1];
    queueMicrotask(() =>
      transport.accept(
        Buffer.from(token + (lines.length === 1 ? "^connected\n" : "^done\n")),
      ),
    );
  });
  process.attach.mockImplementation(async (target, caller) =>
    attachDebuggerTarget(transport, target, caller),
  );
  const requestApproval = async () => {
    const result = await startPreparedDebugger(sessions, selected).catch(
      (error: unknown) => error,
    );
    expect(result).toMatchObject({ code: "APPROVAL_REQUIRED" });
    const approvalId = (
      result as { context: { policyDecision: { approvalId: string } } }
    ).context.policyDecision.approvalId;
    expect(approvalId).toBeTruthy();
    expect(retainDebugElf).not.toHaveBeenCalled();
    expect(DebugProcess.start).not.toHaveBeenCalled();
    approveRequest(approvalId);
    return approvalId;
  };
  selected.target.connectApprovalId = await requestApproval();
  selected.target.loadApprovalId = await requestApproval();
  expect(getApproval(selected.target.connectApprovalId)?.status).toBe(
    "approved",
  );
  selected.approvalId = await requestApproval();
  expect(getApproval(selected.target.loadApprovalId)?.status).toBe("approved");
  const id = await startPreparedDebugger(sessions, selected);
  expect(lines).toHaveLength(2);
  for (const approvalId of [
    selected.target.connectApprovalId,
    selected.target.loadApprovalId,
    selected.approvalId,
  ])
    expect(getApproval(approvalId)?.status).toBe("consumed");
  await sessions.stop(id);
});

it("runs retained Core initialization instead of attaching or downloading twice", async () => {
  const { process, selection } = fixture();
  const sessions = new DebugClientSessions();
  const id = await startPreparedDebugger(sessions, {
    ...selection,
    initialization: {
      template:
        "file __PIO_MCP_INIT_ELF_PATH__\ntarget remote __PIO_MCP_INIT_ENDPOINT__\n",
    },
  });
  expect(process.attach).not.toHaveBeenCalled();
  expect(process.initialize).toHaveBeenCalledOnce();
  const [artifact, scope] = process.initialize.mock.calls[0];
  expect(scope.sessionId).toBe(id);
  expect(artifact.authorization.kind).toBe("template");
  expect(fs.readFileSync(artifact.path, "utf8")).toContain(
    "target remote 127.0.0.1:3333",
  );
  await artifact.verify();
  await sessions.stop(id);
  expect(fs.existsSync(artifact.path)).toBe(false);
});
it("retains initialization and firmware after uncertain cleanup of a script failure", async () => {
  const { process, selection } = fixture();
  const sessions = new DebugClientSessions();
  process.initialize.mockRejectedValueOnce(new Error("initialization failed"));
  process.cleanupProcess.mockRejectedValueOnce(new Error("probe busy"));
  await expect(
    startPreparedDebugger(sessions, {
      ...selection,
      initialization: { template: "monitor reset halt\n" },
    }),
  ).rejects.toMatchObject({ code: "GDB_START_FAILED" });
  const artifact = process.initialize.mock.calls[0][0];
  const elf = await vi.mocked(retainDebugElf).mock.results[0].value;
  await artifact.verify();
  expect(elf.release).not.toHaveBeenCalled();
  await sessions.stop(sessions.list()[0].session_id);
  expect(fs.existsSync(artifact.path)).toBe(false);
  expect(elf.release).toHaveBeenCalledOnce();
});
it("plans initialization authority before firmware allocation or probe custody", async () => {
  const { selection } = fixture();
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "run_shell_command"],
        deny: [],
        approval_required: ["run_shell_command"],
        audit_all_agent_actions: false,
      },
    }),
  );
  await expect(
    startPreparedDebugger(new DebugClientSessions(), {
      ...selection,
      initialization: { template: "monitor reset halt\n" },
    }),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(retainDebugElf).not.toHaveBeenCalled();
  expect(selection.acquireCustody).not.toHaveBeenCalled();
  expect(DebugProcess.start).not.toHaveBeenCalled();
});

it("preflights and consumes all initialization grants through the retained startup reservation", async () => {
  const { process, selection } = fixture();
  const sessions = new DebugClientSessions();
  const selected: PreparedDebuggerStartup = {
    ...selection,
    initialization: { template: "target remote __PIO_MCP_INIT_ENDPOINT__\n" },
  };
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "run_shell_command"],
        deny: [],
        approval_required: ["upload_firmware", "run_shell_command"],
        audit_all_agent_actions: false,
      },
    }),
  );
  const lines: string[] = [];
  const transport = new GdbMiSession(async (line) => {
    lines.push(line);
    const token = /^(\d+)/.exec(line)![1];
    queueMicrotask(() => transport.accept(Buffer.from(token + "^done\n")));
  });
  process.initialize.mockImplementation((artifact, scope, caller) =>
    executeDebugInitialization(
      transport,
      artifact,
      { ...scope, projectDir: root },
      caller,
    ),
  );
  const request = async () => {
    const error = await startPreparedDebugger(sessions, selected).catch(
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(retainDebugElf).not.toHaveBeenCalled();
    expect(selection.acquireCustody).not.toHaveBeenCalled();
    const id = (
      error as { context: { policyDecision: { approvalId: string } } }
    ).context.policyDecision.approvalId;
    approveRequest(id);
    return id;
  };
  selected.initialization!.hostApprovalId = await request();
  selected.initialization!.targetApprovalId = await request();
  selected.approvalId = await request();
  const id = await startPreparedDebugger(sessions, selected);
  expect(lines).toHaveLength(3);
  expect(process.attach).not.toHaveBeenCalled();
  for (const grant of [
    selected.initialization!.hostApprovalId,
    selected.initialization!.targetApprovalId,
    selected.approvalId,
  ])
    expect(getApproval(grant!)?.status).toBe("consumed");
  await sessions.stop(id);
});

it("requests backend approval before allocating retained files or probe custody", async () => {
  const { selection } = fixture();
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "run_shell_command"],
        deny: [],
        approval_required: ["run_shell_command"],
        audit_all_agent_actions: false,
      },
    }),
  );
  const error = await startPreparedDebugger(new DebugClientSessions(), {
    ...selection,
    backend: {
      options: {
        pythonExecutable: path.join(root, "python.exe"),
        command: {
          executable: path.join(root, "openocd.exe"),
          cwd: root,
          arguments: [],
        },
      },
      readyPattern: "Listening on port",
    },
  }).catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(retainDebugElf).not.toHaveBeenCalled();
  expect(selection.acquireCustody).not.toHaveBeenCalled();
  expect(DebugProcess.start).not.toHaveBeenCalled();
});

it("rejects an expired overall deadline before allocating artifacts or custody", async () => {
  const { selection } = fixture();
  await expect(
    startPreparedDebugger(new DebugClientSessions(), {
      ...selection,
      deadline: performance.now() - 1,
    }),
  ).rejects.toMatchObject({ code: "DEBUG_START_TIMEOUT" });
  expect(selection.acquireCustody).not.toHaveBeenCalled();
  expect(retainDebugElf).not.toHaveBeenCalled();
  expect(DebugProcess.start).not.toHaveBeenCalled();
});

it("passes the same overall deadline through GDB startup and target attachment", async () => {
  const { process, selection } = fixture();
  const deadline = performance.now() + 5000;
  const sessions = new DebugClientSessions();
  const id = await startPreparedDebugger(sessions, { ...selection, deadline });
  expect(DebugProcess.start).toHaveBeenCalledWith(
    expect.objectContaining({ startupDeadline: deadline }),
  );
  expect(process.attach).toHaveBeenCalledWith(
    expect.objectContaining({ deadline }),
    {},
  );
  await sessions.stop(id);
});
