/** Command correlation and timeout behavior without launching GDB or accessing a probe. */
import { afterEach, expect, it, vi } from "vitest";
import { GdbMiSession } from "../src/core/debug/gdb-mi-session.js";
afterEach(() => vi.useRealTimers());
const feed = (session: GdbMiSession, text: string) =>
  session.accept(Buffer.from(text));

it("ignores prompts and mismatched tokens until the matching result arrives", async () => {
  const write = vi.fn(async () => {});
  const session = new GdbMiSession(write);
  const request = session.execute("-stack-list-frames");
  expect(write).toHaveBeenCalledWith("1-stack-list-frames\n");
  feed(session, '(gdb)\n999^done\n~"frames\\n"\n');
  await expect(session.execute("-thread-info")).rejects.toMatchObject({
    code: "GDB_COMMAND_BUSY",
  });
  feed(session, "1^done,stack=[]\n");
  expect(await request).toMatchObject({
    token: "1",
    result: { class: "done" },
    console: ["frames\n"],
    timedOut: false,
  });
});
it("waits for a target stop after the execution acknowledgement", async () => {
  const session = new GdbMiSession(async () => {});
  const request = session.execute("-exec-continue", 30000, true);
  feed(session, '1^running\n(gdb)\n*running,thread-id="all"\n');
  await expect(session.execute("-thread-info")).rejects.toMatchObject({
    code: "GDB_COMMAND_BUSY",
  });
  feed(session, '*stopped,reason="breakpoint-hit",frame={func="main"}\n');
  expect(await request).toMatchObject({
    running: false,
    stopped: { class: "stopped" },
    timedOut: false,
  });
});
it("does not undo an already observed stop when a result acknowledgement arrives later", async () => {
  const session = new GdbMiSession(async () => {});
  const request = session.execute("-exec-next", 30000, true);
  feed(session, '*stopped,reason="end-stepping-range"\n1^running\n');
  expect(await request).toMatchObject({
    running: false,
    stopped: { class: "stopped" },
  });
});
it("times out without declaring the running target stopped and supports a later interrupt", async () => {
  vi.useFakeTimers();
  const session = new GdbMiSession(async () => {});
  const request = session.execute("-exec-continue", 10, true);
  feed(session, "1^running\n");
  await vi.advanceTimersByTimeAsync(10);
  expect(await request).toMatchObject({
    timedOut: true,
    running: true,
    closed: false,
  });
  const interrupt = session.execute("-exec-interrupt", 10, true);
  feed(session, '1^done\n2^done\n*stopped,reason="signal-received"\n');
  expect(await interrupt).toMatchObject({
    token: "2",
    running: false,
    timedOut: false,
  });
  expect(vi.getTimerCount()).toBe(0);
});
it("returns debugger errors immediately even when waiting for a stop", async () => {
  const session = new GdbMiSession(async () => {});
  const request = session.execute("-exec-next", 30000, true);
  feed(session, '1^error,msg="target unavailable"\n');
  expect(await request).toMatchObject({
    result: { class: "error" },
    timedOut: false,
  });
});
it("bounds collected console output", async () => {
  const session = new GdbMiSession(async () => {});
  const request = session.execute("-stack-list-frames");
  for (let count = 0; count < 3; count++)
    feed(session, '~"' + "x".repeat(400000) + '"\n');
  feed(session, "1^done\n");
  const result = await request;
  expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(result.console.join(""))).toBe(1024 * 1024);
});
it("retains cleanup uncertainty after a transport failure", async () => {
  const session = new GdbMiSession(async () => {
    throw new Error("fixture pipe failure");
  });
  await expect(session.execute("-thread-info")).rejects.toMatchObject({
    code: "GDB_TRANSPORT_FAILED",
    context: { cleanupPending: true },
  });
  expect(session.state()).toMatchObject({ failed: true, closed: false });
  await expect(session.execute("-thread-info")).rejects.toMatchObject({
    code: "GDB_TRANSPORT_FAILED",
  });
  session.end(1);
  expect(session.state().closed).toBe(true);
});
it("poisons malformed protocol without claiming the debugger process exited", async () => {
  const session = new GdbMiSession(async () => {});
  const request = expect(session.execute("-thread-info")).rejects.toMatchObject(
    { code: "GDB_TRANSPORT_FAILED" },
  );
  expect(() => feed(session, "1^done,value={\n")).toThrow("Malformed");
  await request;
  expect(session.state()).toMatchObject({ failed: true, closed: false });
});
it("reports confirmed EOF while a command is pending", async () => {
  const session = new GdbMiSession(async () => {});
  const request = session.execute("-thread-info");
  session.end(2);
  expect(await request).toMatchObject({
    closed: true,
    exitCode: 2,
    timedOut: false,
  });
});
it.each(["-exec-next\n-exec-continue", "shell whoami", "", "-exec-next\u0000"])(
  "rejects invalid transport framing %j before write",
  async (command) => {
    const write = vi.fn(async () => {});
    const session = new GdbMiSession(write);
    await expect(session.execute(command)).rejects.toMatchObject({
      code: "GDB_COMMAND_INVALID",
    });
    expect(write).not.toHaveBeenCalled();
  },
);

it("does not exceed the output byte limit when truncating a multibyte character", async () => {
  const session = new GdbMiSession(async () => {});
  const request = session.execute("-thread-info");
  feed(session, '~"' + "x".repeat(600000) + '"\n');
  feed(session, '~"' + "\u6e2c".repeat(200000) + '"\n');
  feed(session, '1^done\n');
  const result = await request;
  expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(result.console.join(""))).toBeLessThanOrEqual(1024 * 1024);
  expect(result.console.join("")).not.toContain("\ufffd");
});
