/** Owned session collection bounds and final authorization without hardware. */
import { expect, it, vi } from "vitest";
import { SerialSessionBuffer } from "../src/core/serial/session-buffer.js";
import { captureSessionMemory } from "../src/core/serial/memory-capture.js";
const owner = { id: "fixture" };
it("analyzes a bounded snapshot and rechecks authorization after analysis", async () => {
  const buffer = new SerialSessionBuffer();
  buffer.append(Buffer.from("Free heap: 1000\nFree heap: 900\n"));
  const read = vi.fn(async (_owner, _id, options) => buffer.read(options));
  const result = await captureSessionMemory({ read }, owner, "session", {
    seconds: 0,
  });
  expect(result).toMatchObject({ ok: true, lineCount: 2, cursor: 2 });
  expect(read).toHaveBeenCalledTimes(2);
  expect(
    read.mock.calls.every((call) => call[0] === owner && call[1] === "session"),
  ).toBe(true);
});
it("marks line limits and does not invent timing from backlog reads", async () => {
  const buffer = new SerialSessionBuffer();
  buffer.append(Buffer.from("Free heap: 1000\nFree heap: 900\n"));
  const read = vi.fn(async (_owner, _id, options) => buffer.read(options));
  const result = await captureSessionMemory({ read }, owner, "session", {
    seconds: 0,
    maxLines: 1,
  });
  expect(result).toMatchObject({
    limitReached: true,
    collectionComplete: false,
    lineCount: 1,
  });
  expect(result.metrics.free_heap.bytesPerSecond).toBeNull();
});
it("rejects a final authorization failure instead of returning analyzed data", async () => {
  const buffer = new SerialSessionBuffer();
  buffer.append(Buffer.from("Free heap: 1000\n"));
  const read = vi
    .fn()
    .mockResolvedValueOnce(await buffer.read())
    .mockRejectedValueOnce(new Error("revoked"));
  await expect(
    captureSessionMemory({ read }, owner, "session", { seconds: 0 }),
  ).rejects.toThrow("revoked");
});
