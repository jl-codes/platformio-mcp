/** Fresh trigger evidence cannot come from backlog, another owner, loss or revoked permission. */
import { expect, it, vi } from "vitest";
import { SerialSessionBuffer } from "../src/core/serial/session-buffer.js";
import { waitForPowerTrigger } from "../src/core/serial/power-trigger.js";
import type { SerialSessionInfo } from "../src/core/serial/session-manager.js";
const owner = { id: "fixture" };
function fixture() {
  const buffer = new SerialSessionBuffer();
  buffer.append(Buffer.from("READY old\n"));
  const list = () => [
    {
      sessionId: "owned",
      state: "open",
      nextCursor: buffer.metadata().nextCursor,
    } as SerialSessionInfo,
  ];
  return { buffer, list };
}
it("ignores completed backlog and returns the new matching line, then reauthorizes", async () => {
  const f = fixture();
  let first = true;
  const read = vi.fn(async (_owner, _id, options) => {
    if (first) {
      first = false;
      f.buffer.append(Buffer.from("noise\nREADY new\n"));
    }
    return f.buffer.read(options);
  });
  expect(
    await waitForPowerTrigger({ list: f.list, read }, owner, "owned", {
      trigger: "READY",
      seconds: 1,
    }),
  ).toMatchObject({
    trigger_line: "READY new",
    trigger_cursor: 2,
    trigger_session_id: "owned",
  });
  expect(read.mock.calls[0][2].cursor).toBe(1);
  expect(read).toHaveBeenCalledTimes(2);
});
it("does not accept matching buffered history when no new line arrives", async () => {
  const f = fixture();
  const read = vi.fn(async (_owner, _id, options) => f.buffer.read(options));
  await expect(
    waitForPowerTrigger({ list: f.list, read }, owner, "owned", {
      trigger: "READY",
      seconds: 0.01,
    }),
  ).rejects.toMatchObject({ code: "POWER_TRIGGER_TIMEOUT" });
});
it("refuses another connection's session before reading", async () => {
  const read = vi.fn();
  await expect(
    waitForPowerTrigger({ list: () => [], read }, owner, "foreign", {
      trigger: "READY",
    }),
  ).rejects.toMatchObject({ code: "SERIAL_SESSION_NOT_FOUND" });
  expect(read).not.toHaveBeenCalled();
});
it("does not disclose a trigger after final authorization fails", async () => {
  const f = fixture();
  let calls = 0;
  const read = vi.fn(async (_owner, _id, options) => {
    if (++calls === 2) throw new Error("revoked");
    f.buffer.append(Buffer.from("READY new\n"));
    return f.buffer.read(options);
  });
  await expect(
    waitForPowerTrigger({ list: f.list, read }, owner, "owned", {
      trigger: "READY",
      seconds: 1,
    }),
  ).rejects.toThrow("revoked");
});
it("rejects truncated evidence and cancellation", async () => {
  const f = fixture();
  const read = vi.fn(async (_owner, _id, options) => {
    f.buffer.append(Buffer.from("READY new\n"));
    return { ...(await f.buffer.read(options)), lineTruncatedBytes: [1] };
  });
  await expect(
    waitForPowerTrigger({ list: f.list, read }, owner, "owned", {
      trigger: "READY",
      seconds: 1,
    }),
  ).rejects.toMatchObject({ code: "POWER_TRIGGER_LOSS" });
  const controller = new AbortController();
  controller.abort();
  read.mockClear();
  await expect(
    waitForPowerTrigger(
      { list: f.list, read },
      owner,
      "owned",
      { trigger: "READY" },
      controller.signal,
    ),
  ).rejects.toMatchObject({ code: "SERIAL_CANCELLED" });
  expect(read).not.toHaveBeenCalled();
});
