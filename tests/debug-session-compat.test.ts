/** Compatibility replies preserve target uncertainty and connection ownership. */
import { expect, it, vi } from "vitest";
import {
  DebugClientSessions,
  type OwnedDebugProcess,
} from "../src/core/debug/debug-client-sessions.js";
import {
  executeDebugSessionCompatibility,
  formatDebuggerCommandResult,
  normalizeDebuggerStop,
} from "../src/adapters/debug-session-compat.js";
import { parseGdbMiRecord } from "../src/core/debug/gdb-mi.js";
import type { GdbMiCommandResult } from "../src/core/debug/gdb-mi-session.js";
const result: GdbMiCommandResult = {
  token: "1",
  console: [],
  truncated: false,
  timedOut: true,
  running: true,
  closed: false,
  exitCode: null,
};
it("reports a running timeout without claiming success or target stop", () => {
  expect(formatDebuggerCommandResult(result)).toMatchObject({
    ok: false,
    timed_out: true,
    running: true,
    stopped: null,
  });
});
it("maps known stop/frame fields without forwarding arbitrary keys", () => {
  const record = parseGdbMiRecord(
    '*stopped,reason="breakpoint-hit",frame={func="main",fullname="/project/main.cpp",line="42",__proto__="bad"}',
  );
  expect(
    normalizeDebuggerStop(record as GdbMiCommandResult["stopped"]),
  ).toMatchObject({
    reason: "breakpoint-hit",
    frame: { function: "main", file: "/project/main.cpp", line: "42" },
  });
});
it("forwards both scoped grants and refuses another connection's session", async () => {
  const sessions = new DebugClientSessions();
  const command = vi.fn(async () => result);
  const process: OwnedDebugProcess = {
    command,
    cleanupProcess: vi.fn(async () => {}),
    state: vi.fn(),
  };
  const id = await sessions.start("/project", "debug", async () => process);
  const args = {
    session_id: id,
    command: "pio_reset_run_target",
    approval_id: "host",
    target_approval_id: "target",
    timeout_s: 0.001,
  };
  await executeDebugSessionCompatibility("pio_debug_cmd", args, sessions, {});
  expect(command).toHaveBeenCalledWith(args.command, {}, 1, {
    sessionId: id,
    approvalId: "host",
    targetApprovalId: "target",
  });
  await expect(
    executeDebugSessionCompatibility(
      "pio_debug_cmd",
      args,
      new DebugClientSessions(),
    ),
  ).rejects.toMatchObject({ code: "DEBUG_SESSION_NOT_FOUND" });
});
it("retains failed cleanup and offers explicit process-only recovery without target claims", async () => {
  const sessions = new DebugClientSessions();
  const cleanup = vi
    .fn()
    .mockRejectedValueOnce(new Error("still owned"))
    .mockResolvedValue(undefined);
  const process: OwnedDebugProcess = {
    command: vi.fn(),
    cleanupProcess: cleanup,
    state: () => ({
      running: false,
      closed: true,
      exitCode: 0,
      failed: false,
      lastStop: undefined,
      pid: 1,
      cleanupPending: true,
      stderr: "",
    }),
  };
  const id = await sessions.start("/project", "debug", async () => process);
  const args = { session_id: id, process_only: true };
  await expect(
    executeDebugSessionCompatibility("pio_debug_stop", args, sessions),
  ).rejects.toThrow("still owned");
  expect(sessions.list()).toHaveLength(1);
  expect(
    await executeDebugSessionCompatibility("pio_debug_stop", args, sessions),
  ).toMatchObject({
    ok: true,
    reset_run_acknowledged: false,
    target_running_verified: false,
  });
  expect(sessions.list()).toHaveLength(0);
  expect(process.command).not.toHaveBeenCalled();
});
it("rejects owner selection and invalid timeout before dispatch", async () => {
  const sessions = new DebugClientSessions();
  await expect(
    executeDebugSessionCompatibility(
      "pio_debug_list",
      { owner: "other" },
      sessions,
    ),
  ).rejects.toMatchObject({ code: "COMPAT_ARGUMENT_INVALID" });
  await expect(
    executeDebugSessionCompatibility(
      "pio_debug_cmd",
      {
        session_id: "00000000-0000-4000-8000-000000000000",
        command: "bt",
        timeout_s: 0,
      },
      sessions,
    ),
  ).rejects.toMatchObject({ code: "COMPAT_ARGUMENT_INVALID" });
});
