/** Exact script snapshots require both privileges, retain their lifetime, and fail before transport on tampering. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPrivateAnalysisDirectory } from "../src/core/analysis/private-analysis-directory.js";
import {
  retainDebugInitialization,
  retainDebugInitializationTemplate,
  ownDebugInitialization,
  type DebugInitArtifact,
} from "../src/core/debug/debug-init-artifact.js";
import { executeDebugInitialization } from "../src/core/debug/debug-init-execution.js";
import { approveRequest } from "../src/core/policy/approvals.js";
import { GdbMiSession } from "../src/core/debug/gdb-mi-session.js";
import type { OwnedDebugProcess } from "../src/core/debug/debug-client-sessions.js";
vi.mock("../src/core/analysis/private-analysis-directory.js", () => ({
  createPrivateAnalysisDirectory: vi.fn(),
}));
let root: string;
const binding = {
  elfSha256: "a".repeat(64),
  host: "127.0.0.1",
  port: 3333,
  load: true,
};
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-init-execution-")),
  );
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "operator.json"));
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "data"));
  await policy([]);
  vi.mocked(createPrivateAnalysisDirectory).mockImplementation(() =>
    fs.mkdtemp(path.join(root, "private init ")),
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
async function policy(deny: string[]) {
  await fs.writeFile(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "run_shell_command"].filter(
          (name) => !deny.includes(name),
        ),
        deny,
        approval_required: [],
        audit_all_agent_actions: false,
      },
    }),
  );
}
function transport(fail = false) {
  const lines: string[] = [];
  const session = new GdbMiSession(async (line) => {
    lines.push(line);
    const token = /^(\d+)/.exec(line)![1];
    queueMicrotask(() =>
      session.accept(
        Buffer.from(
          token + (fail ? '^error,msg="script failed"\n' : "^done\n"),
        ),
      ),
    );
  });
  return { session, lines };
}
function input() {
  return { projectDir: root, sessionId: "owned", timeoutMs: 1000 };
}
it("sources exact retained bytes and restores controlled inspection settings", async () => {
  const artifact = await retainDebugInitialization(
    "monitor reset halt\n",
    binding,
  );
  const { session, lines } = transport();
  await executeDebugInitialization(session, artifact, input());
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain("source ");
  expect(lines[1]).toContain("-gdb-set auto-load off");
  expect(lines[2]).toContain("-gdb-set may-call-functions off");
  await artifact.release();
  await expect(artifact.verify()).rejects.toMatchObject({
    code: "DEBUG_INIT_ARTIFACT_INVALID",
  });
});
it.each(["upload_firmware", "run_shell_command"])(
  "denies %s before source execution",
  async (denied) => {
    await policy([denied]);
    const artifact = await retainDebugInitialization(
      "monitor reset halt\n",
      binding,
    );
    const { session, lines } = transport();
    await expect(
      executeDebugInitialization(session, artifact, input()),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(lines).toEqual([]);
    await artifact.release();
  },
);
it("detects modified snapshot bytes before any debugger command", async () => {
  const artifact = await retainDebugInitialization(
    "monitor reset halt\n",
    binding,
  );
  await fs.writeFile(artifact.path, "monitor reset run!\n");
  const { session, lines } = transport();
  await expect(
    executeDebugInitialization(session, artifact, input()),
  ).rejects.toMatchObject({ code: "DEBUG_INIT_ARTIFACT_CHANGED" });
  expect(lines).toEqual([]);
  await artifact.release();
});
it("rejects serialized or forged artifact capabilities", async () => {
  const artifact = await retainDebugInitialization(
    "monitor reset halt\n",
    binding,
  );
  const { session, lines } = transport();
  await expect(
    executeDebugInitialization(
      { ...session } as GdbMiSession,
      { ...artifact } as DebugInitArtifact,
      input(),
    ),
  ).rejects.toMatchObject({ code: "DEBUG_INIT_ARTIFACT_INVALID" });
  expect(lines).toEqual([]);
  await artifact.release();
});
it("invalidates transport after initialization errors", async () => {
  const artifact = await retainDebugInitialization(
    "monitor reset halt\n",
    binding,
  );
  const { session, lines } = transport(true);
  await expect(
    executeDebugInitialization(session, artifact, input()),
  ).rejects.toMatchObject({ code: "DEBUG_INIT_FAILED" });
  expect(lines).toHaveLength(1);
  await expect(session.execute("-stack-list-frames")).rejects.toMatchObject({
    code: "GDB_TRANSPORT_FAILED",
  });
  await artifact.release();
});
it("retains the script until process cleanup succeeds", async () => {
  const artifact = await retainDebugInitialization(
    "monitor reset halt\n",
    binding,
  );
  const cleanupProcess = vi
    .fn(async () => {})
    .mockRejectedValueOnce(new Error("pending"));
  const process = {
    command: vi.fn(),
    state: vi.fn(),
    cleanupProcess,
  } as OwnedDebugProcess;
  const owner = ownDebugInitialization(process, artifact);
  expect(owner.state().init_script).toBe(artifact.script);
  expect(owner.state().init_script_path).toBe(artifact.path);
  expect(artifact.script).toBe(await fs.readFile(artifact.path, "utf8"));
  await expect(owner.cleanupProcess()).rejects.toThrow("pending");
  await artifact.verify();
  await owner.cleanupProcess();
  await expect(fs.stat(artifact.path)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("keeps template authorization stable across private ELF locations while checking exact bytes", async () => {
  const template =
    "file __PIO_MCP_INIT_ELF_PATH__\ntarget remote __PIO_MCP_INIT_ENDPOINT__\n";
  const first = await retainDebugInitializationTemplate(
    template,
    binding,
    path.join(root, "first", "firmware.elf"),
  );
  const second = await retainDebugInitializationTemplate(
    template,
    binding,
    path.join(root, "second", "firmware.elf"),
  );
  expect(first.authorization).toEqual(second.authorization);
  expect(first.authorization.kind).toBe("template");
  expect(first.sha256).not.toBe(second.sha256);
  await first.verify();
  await second.verify();
  await fs.writeFile(second.path, await fs.readFile(first.path));
  await expect(second.verify()).rejects.toMatchObject({
    code: "DEBUG_INIT_ARTIFACT_CHANGED",
  });
  await first.release();
  await second.release();
});
it("changes authorization when literal script instructions change", async () => {
  const elf = path.join(root, "firmware.elf");
  const first = await retainDebugInitializationTemplate(
    "monitor reset halt\n",
    binding,
    elf,
  );
  const second = await retainDebugInitializationTemplate(
    "monitor reset run\n",
    binding,
    elf,
  );
  expect(first.authorization.sha256).not.toBe(second.authorization.sha256);
  expect(Object.isFrozen(first.authorization)).toBe(true);
  await first.release();
  await second.release();
});

it("honors a real template approval after retry allocates a different private firmware path", async () => {
  await fs.writeFile(
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
  const template = "file __PIO_MCP_INIT_ELF_PATH__\n";
  const first = await retainDebugInitializationTemplate(
    template,
    binding,
    path.join(root, "attempt-one", "firmware.elf"),
  );
  const { session, lines } = transport();
  const denied = await executeDebugInitialization(
    session,
    first,
    input(),
  ).catch((error: unknown) => error);
  expect(denied).toMatchObject({ code: "APPROVAL_REQUIRED" });
  const approvalId = (
    denied as { context: { policyDecision: { approvalId: string } } }
  ).context.policyDecision.approvalId;
  expect(lines).toEqual([]);
  approveRequest(approvalId);
  await first.release();
  const retried = await retainDebugInitializationTemplate(
    template,
    binding,
    path.join(root, "attempt-two", "firmware.elf"),
  );
  await executeDebugInitialization(session, retried, {
    ...input(),
    hostApprovalId: approvalId,
  });
  expect(lines).toHaveLength(3);
  await retried.release();
});

it("does not source a retained script after the overall startup deadline expires", async () => {
  const artifact = await retainDebugInitialization(
    "monitor reset halt\n",
    binding,
  );
  const { session, lines } = transport();
  try {
    await expect(
      executeDebugInitialization(session, artifact, {
        ...input(),
        deadline: performance.now() - 1,
      }),
    ).rejects.toMatchObject({ code: "DEBUG_INIT_TIMEOUT" });
    expect(lines).toEqual([]);
  } finally {
    await artifact.release();
  }
});
