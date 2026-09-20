/** Serial power windows preserve ownership, loss and post-analysis authorization. */
import { expect, it, vi } from "vitest";
import { SerialSessionBuffer } from "../src/core/serial/session-buffer.js";
import { captureSessionPower } from "../src/core/serial/power-capture.js";
const owner = { id: "fixture" };
it("reports batch observation timing without inventing an interval between buffered lines", async () => {
  const buffer = new SerialSessionBuffer();
  buffer.append(Buffer.from("500uA 3.3V\n1500uA 3.3V\n"));
  const read = vi.fn(async (_owner, _id, options) => buffer.read(options));
  const result = await captureSessionPower({ read }, owner, "owned", {
    seconds: 0.001,
  });
  expect(result).toMatchObject({
    ok: true,
    lineCount: 2,
    timingBasis: "host_read_observation",
    analysis: {
      sample_count: 2,
      average_ma: 1,
      duration_s: 0,
      voltage_mv: 3300,
      energy_mwh: 0,
    },
  });
  expect(read).toHaveBeenCalledTimes(2);
});
it("marks truncated/dropped collection incomplete while preserving useful readings", async () => {
  const buffer = new SerialSessionBuffer({ maxLines: 1 });
  buffer.append(Buffer.from("1mA\n2mA\n"));
  const read = vi.fn(async (_owner, _id, options) => buffer.read(options));
  expect(
    await captureSessionPower({ read }, owner, "owned", { seconds: 0.001 }),
  ).toMatchObject({
    ok: false,
    droppedLines: 1,
    collectionComplete: false,
    analysis: { average_ma: 2 },
  });
});
it("refuses final disclosure after authorization is revoked", async () => {
  const buffer = new SerialSessionBuffer();
  buffer.append(Buffer.from("1mA\n"));
  const read = vi
    .fn()
    .mockResolvedValueOnce(await buffer.read())
    .mockRejectedValueOnce(new Error("revoked"));
  await expect(
    captureSessionPower({ read }, owner, "owned", { seconds: 0.001 }),
  ).rejects.toThrow("revoked");
});
it("rejects bad custom patterns before reading a session", async () => {
  const read = vi.fn();
  await expect(
    captureSessionPower({ read }, owner, "owned", { pattern: "(" }),
  ).rejects.toMatchObject({ code: "PATTERN_INVALID" });
  expect(read).not.toHaveBeenCalled();
});
it("does not call an early disconnected collection complete", async () => {
  const buffer = new SerialSessionBuffer();
  buffer.append(Buffer.from("1mA\n"));
  buffer.close("disconnected");
  const read = vi.fn(async (_owner, _id, options) => buffer.read(options));
  expect(
    await captureSessionPower({ read }, owner, "owned", { seconds: 10 }),
  ).toMatchObject({
    ok: false,
    collectionComplete: false,
    state: "disconnected",
  });
});
