/** Fresh boot capture verdicts using the real bounded buffer and regex workers, without physical hardware. */
import { expect, it, vi } from "vitest";
import { SerialSessionBuffer } from "../src/core/serial/session-buffer.js";
import { captureSessionVerification } from "../src/core/serial/verification-capture.js";
const owner = { id: "fixture" };
function fixture(text: string, limits = {}) {
  const buffer = new SerialSessionBuffer(limits);
  buffer.append(Buffer.from(text));
  const read = vi.fn(async (_owner, _id, options) => buffer.read(options));
  return {
    buffer,
    read,
    capture: (input = {}) =>
      captureSessionVerification({ read }, owner, "session", {
        timeoutSeconds: 0,
        settleSeconds: 0,
        stabilityWindowSeconds: 0,
        ...input,
      }),
  };
}
it("passes only on observed expected output and retains fresh lines", async () => {
  expect(await fixture("ready\n").capture()).toMatchObject({
    ok: true,
    verdict: "pass",
    matched_line: "ready",
    lines: ["ready"],
  });
});
it("never reports an empty capture as a pass", async () => {
  expect(await fixture("").capture()).toMatchObject({
    ok: false,
    verdict: "timeout",
  });
});
it("gives crash evidence precedence over a success marker on the same boot", async () => {
  expect(await fixture("ready\nHardFault\n").capture()).toMatchObject({
    ok: false,
    verdict: "fail",
    matched_line: "HardFault",
  });
});
it("preserves built-in reset-loop detection even with a one-line response and disabled fail regex", async () => {
  expect(
    await fixture("rst:0x1\nrst:0x1\nready\n").capture({
      maxLines: 1,
      failOn: "",
    }),
  ).toMatchObject({
    verdict: "fail",
    runtime_failures: ["BootLoop"],
    lines: ["ready"],
    line_count: 3,
  });
});
it("cannot pass after buffer loss or device disconnection", async () => {
  expect(
    await fixture("lost\nready\n", { maxLines: 1 }).capture(),
  ).toMatchObject({ verdict: "inconclusive", dropped_lines: 1 });
  const f = fixture("ready\n");
  f.buffer.close("disconnected");
  expect(await f.capture()).toMatchObject({
    ok: false,
    verdict: "inconclusive",
  });
});
it("requires the requested quiet window instead of treating first match as stable", async () => {
  expect(
    await fixture("ready\n").capture({ stabilityWindowSeconds: 10 }),
  ).toMatchObject({ verdict: "timeout" });
});
it("rejects malformed regex before accessing the session", async () => {
  const f = fixture("ready\n");
  await expect(f.capture({ expect: "[" })).rejects.toMatchObject({
    code: "PATTERN_INVALID",
  });
  expect(f.read).not.toHaveBeenCalled();
});

it("collects a later crash during the stability window instead of stopping at ready", async () => {
  const buffer = new SerialSessionBuffer();
  buffer.append(Buffer.from("ready\n"));
  let calls = 0;
  const read = vi.fn(async (_owner, _id, options) => {
    if (++calls === 2) buffer.append(Buffer.from("HardFault\n"));
    return buffer.read(options);
  });
  expect(
    await captureSessionVerification({ read }, owner, "session", {
      timeoutSeconds: 2,
      stabilityWindowSeconds: 1,
      settleSeconds: 0,
    }),
  ).toMatchObject({
    ok: false,
    verdict: "fail",
    lines: ["ready", "HardFault"],
  });
});
