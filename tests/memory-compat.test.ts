/** Memory compatibility projection keeps observed metrics and explicitly unknown time rates. */
import { expect, it } from "vitest";
import { SerialSessionBuffer } from "../src/core/serial/session-buffer.js";
import { captureSessionMemory } from "../src/core/serial/memory-capture.js";
import { projectMemoryCompatibility } from "../src/adapters/memory-compat.js";
it("projects actual bounded collection without inventing rates or a confirmed leak", async () => {
  const buffer = new SerialSessionBuffer();
  buffer.append(Buffer.from("Free heap: 1000 min: 900 largest: 800\n"));
  const report = await captureSessionMemory(
    { read: async (_owner, _id, options) => buffer.read(options) },
    { id: "fixture" },
    "owned",
    { seconds: 0 },
  );
  const projected = projectMemoryCompatibility(report, {
    port: "COM42",
    baud: 115200,
    sessionId: "owned",
  });
  expect(projected).toMatchObject({
    ok: true,
    session_id: "owned",
    line_count: 1,
    recognized: true,
    metrics: {
      free_heap: {
        first: 1000,
        bytes_per_second: null,
        verdict: "insufficient_samples",
        leak_suspected: false,
      },
    },
  });
  expect(
    projectMemoryCompatibility(report, {
      port: "COM42",
      baud: 115200,
      sessionId: "owned",
      cleanupPending: true,
    }),
  ).toMatchObject({
    ok: false,
    collection_complete: false,
    cleanup_pending: true,
  });
});
