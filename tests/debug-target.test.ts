/** Target startup exercises real policy and MI ordering without contacting a probe. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GdbMiSession } from "../src/core/debug/gdb-mi-session.js";
import { attachDebuggerTarget } from "../src/core/debug/debug-target.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-debug-target-"));
  const policy = path.join(root, "operator.json");
  vi.stubEnv("PIO_MCP_POLICY_FILE", policy);
  fs.writeFileSync(
    policy,
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware"],
        deny: [],
        approval_required: [],
        audit_all_agent_actions: false,
      },
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function fixture(fail = false) {
  const lines: string[] = [];
  const session = new GdbMiSession(async (line) => {
    lines.push(line);
    const token = /^(\d+)/.exec(line)![1];
    queueMicrotask(() =>
      session.accept(
        Buffer.from(
          token +
            (fail
              ? '^error,msg="failed"\n'
              : lines.length === 1
                ? "^connected\n"
                : "^done\n"),
        ),
      ),
    );
  });
  return { session, lines };
}
function selection(load: boolean) {
  return {
    projectDir: root,
    sessionId: "owned",
    host: "127.0.0.1",
    port: 3333,
    load,
    elfSha256: "a".repeat(64),
  };
}
it.each([false, true])(
  "downloads only when requested (load=%s)",
  async (load) => {
    const { session, lines } = fixture();
    await attachDebuggerTarget(session, selection(load), {});
    expect(lines.map((line) => line.replace(/^\d+/, "").trim())).toEqual([
      "-target-select extended-remote 127.0.0.1:3333",
      ...(load ? ["-target-download"] : []),
    ]);
  },
);
it("never downloads after a failed attachment", async () => {
  const { session, lines } = fixture(true);
  await expect(
    attachDebuggerTarget(session, selection(true), {}),
  ).rejects.toMatchObject({ code: "DEBUG_TARGET_FAILED" });
  expect(lines).toHaveLength(1);
  await expect(session.execute("-target-download")).rejects.toMatchObject({
    code: "GDB_TRANSPORT_FAILED",
  });
});
it("rejects command-bearing destinations before transport writes", async () => {
  const { session, lines } = fixture();
  await expect(
    attachDebuggerTarget(session, { ...selection(false), host: "|evil" }, {}),
  ).rejects.toMatchObject({ code: "DEBUG_TARGET_INVALID" });
  expect(lines).toEqual([]);
});
it("denies target access before connecting", async () => {
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
  const { session, lines } = fixture();
  await expect(
    attachDebuggerTarget(session, selection(true), {}),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(lines).toEqual([]);
});

it("requires exact image identity for download authorization", async () => {
  const { session, lines } = fixture();
  await expect(
    attachDebuggerTarget(
      session,
      { ...selection(true), elfSha256: undefined },
      {},
    ),
  ).rejects.toMatchObject({ code: "DEBUG_TARGET_INVALID" });
  expect(lines).toEqual([]);
});

it("orders initialization around download and retains the temporary entry breakpoint", async () => {
  const { session, lines } = fixture();
  await attachDebuggerTarget(
    session,
    {
      ...selection(true),
      beforeLoadCommands: [
        { command: "monitor init" },
        { command: "monitor reset halt" },
      ],
      afterLoadCommands: [{ command: "tbreak main" }],
    },
    {},
  );
  expect(lines.map((line) => line.replace(/^\d+/, "").trim())).toEqual([
    "-target-select extended-remote 127.0.0.1:3333",
    '-interpreter-exec console "monitor init"',
    '-interpreter-exec console "monitor reset halt"',
    "-target-download",
    '-break-insert -t -- "main"',
  ]);
});
it("denies privileged initialization before even attaching to the target", async () => {
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware"],
        deny: ["run_shell_command"],
        approval_required: [],
        audit_all_agent_actions: false,
      },
    }),
  );
  const { session, lines } = fixture();
  await expect(
    attachDebuggerTarget(
      session,
      {
        ...selection(false),
        afterLoadCommands: [{ command: "source project.gdb" }],
      },
      {},
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(lines).toEqual([]);
});
it("validates every initialization command before any transport write", async () => {
  const { session, lines } = fixture();
  await expect(
    attachDebuggerTarget(
      session,
      {
        ...selection(true),
        beforeLoadCommands: [{ command: "monitor init; shell bad" }],
      },
      {},
    ),
  ).rejects.toMatchObject({ code: "DEBUG_COMMAND_UNSUPPORTED" });
  expect(lines).toEqual([]);
});
it("waits for the initial stop event after continuing to an entry breakpoint", async () => {
  const lines: string[] = [];
  const session = new GdbMiSession(async (line) => {
    lines.push(line);
    const token = /^(\d+)/.exec(line)![1];
    queueMicrotask(() =>
      session.accept(
        Buffer.from(
          token +
            (line.includes("-exec-continue")
              ? '^running\n*stopped,reason="breakpoint-hit"\n'
              : lines.length === 1
                ? "^connected\n"
                : "^done\n"),
        ),
      ),
    );
  });
  await attachDebuggerTarget(
    session,
    {
      ...selection(false),
      afterLoadCommands: [{ command: "tbreak main" }, { command: "continue" }],
    },
    {},
  );
  expect(session.state().running).toBe(false);
  expect(session.state().lastStop?.class).toBe("stopped");
});
