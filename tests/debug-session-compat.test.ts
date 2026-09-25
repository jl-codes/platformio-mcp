/** Compatibility replies preserve target uncertainty and connection ownership. */
import { expect, it, vi } from "vitest";
import {
  DebugClientSessions,
  type OwnedDebugProcess,
} from "../src/core/debug/debug-client-sessions.js";
import {
  executeDebugSessionCompatibility,
  formatDebuggerCommandResult,
  formatDebuggerSessionInfo,
  normalizeDebuggerStop,
} from "../src/adapters/debug-session-compat.js";
import { parseGdbMiRecord } from "../src/core/debug/gdb-mi.js";
import { GdbMiSession } from "../src/core/debug/gdb-mi-session.js";
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
    frame: { function: "main", file: "/project/main.cpp", line: 42 },
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
it.each([true, false])(
  "cleans an exited debugger without target claims (process_only=%s)",
  async (processOnly) => {
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
    const args = { session_id: id, process_only: processOnly };
    await expect(
      executeDebugSessionCompatibility("pio_debug_stop", args, sessions),
    ).rejects.toThrow("still owned");
    expect(sessions.list()).toHaveLength(1);
    expect(
      await executeDebugSessionCompatibility("pio_debug_stop", args, sessions),
    ).toMatchObject({
      ok: true,
      project_dir: "/project",
      env: "debug",
      debug_tool: null,
      uptime_s: expect.any(Number),
      reset_run_acknowledged: false,
      target_running_verified: false,
    });
    expect(sessions.list()).toHaveLength(0);
    expect(process.command).not.toHaveBeenCalled();
    expect(process.command).not.toHaveBeenCalled();
  },
);
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
it.each([
  '^done,value="42"',
  '^done,stack=[frame={level="0",func="main",file="main.cpp",line="12"}]',
  '^done,register-values=[{number="0",value="0x1234"}]',
  '^done,name="first",name="second",__proto__="untrusted"',
])(
  "preserves structured inspection output without console text: %s",
  (line) => {
    const record = parseGdbMiRecord(line) as NonNullable<
      GdbMiCommandResult["result"]
    >;
    const formatted = formatDebuggerCommandResult({
      ...result,
      result: record,
      timedOut: false,
      running: false,
    });
    expect(formatted.ok).toBe(true);
    expect(formatted.console).toEqual([]);
    expect(formatted.result_fields).toEqual(record.fields);
    expect(JSON.parse(JSON.stringify(formatted)).result_fields).toEqual(
      record.fields,
    );
    expect(Object.getPrototypeOf(formatted)).toBe(Object.prototype);
  },
);

it("preserves reference payload, separate streams and stopped-frame arguments from an MI transcript", async () => {
  const session = new GdbMiSession(async () => {});
  const pending = session.execute("-exec-next", 1000, true);
  session.accept(
    Buffer.from(
      [
        '~"console part"',
        '~" two\\nnext\\n"',
        '&"probe log\\n"',
        '@"device text\\n"',
        "backend banner",
        '1^running,value="a",value="b",__proto__="inert"',
        '*stopped,reason="breakpoint-hit",bkptno="2",disp="keep",frame={func="main",line="42",args=[{name="argc",value="1"}]}',
      ].join("\n") + "\n",
    ),
  );
  const formatted = formatDebuggerCommandResult(await pending);
  expect(formatted).toMatchObject({
    ok: true,
    result: { value: ["a", "b"] },
    console: ["console part two", "next"],
    log: ["probe log"],
    target_output: ["device text"],
    other_output: ["backend banner"],
    stopped: {
      bkptno: "2",
      disp: "keep",
      frame: { line: 42, args: [{ name: "argc", value: "1" }] },
    },
    duration_s: expect.any(Number),
    note: null,
  });
  expect(Object.getPrototypeOf(formatted.result)).toBeNull();
  expect(Object.hasOwn(formatted.result, "__proto__")).toBe(true);
  expect(JSON.parse(JSON.stringify(formatted)).result.__proto__).toBe("inert");
  expect(formatted.records).toContainEqual({
    kind: "target",
    text: "device text\n",
  });
  expect(formatted.records.at(-1)).toMatchObject({
    kind: "exec",
    class: "stopped",
  });
});

it("shares reference session metadata without discarding the existing stopped field", () => {
  const stopped = parseGdbMiRecord(
    '*stopped,reason="breakpoint-hit",frame={func="main",line="12"}',
  );
  const row = {
    session_id: "owned",
    project_dir: "/project",
    env: "debug",
    debug_tool: "openocd",
    uptime_s: 1,
    running: false,
    closed: false,
    exitCode: null,
    failed: false,
    lastStop: stopped,
    stopCount: 2,
    recordsBuffered: 10,
    error: null,
    pid: 42,
    cleanupPending: true,
    stderr: "",
    init_script: "target extended-remote 127.0.0.1:3333",
    init_script_path: "/private/initialization.gdb",
  } as Parameters<typeof formatDebuggerSessionInfo>[0];
  const info = formatDebuggerSessionInfo(row);
  expect(info).toMatchObject({
    stop_count: 2,
    records_buffered: 10,
    error: null,
    exit_code: null,
    last_stop: { frame: { line: 12 } },
    init_script_path: "/private/initialization.gdb",
    pid: 42,
  });
  expect(info.last_stop).toEqual(info.stopped);
  expect(info.init_script).toBe(row.init_script);
});
