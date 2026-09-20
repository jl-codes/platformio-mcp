/** Verify serial power projection and trigger-before-open composition without touching hardware. */
import { beforeEach, expect, it, vi } from "vitest";
import { SerialSessionBuffer } from "../src/core/serial/session-buffer.js";
import { captureSessionPower } from "../src/core/serial/power-capture.js";
import {
  executeSerialPowerCompatibility,
  projectSerialPowerCompatibility,
  SerialPowerCompatibilitySchema,
} from "../src/adapters/power-serial-compat.js";
import type { SerialClientContext } from "../src/adapters/serial-client.js";
import { resolveMonitorRequest } from "../src/adapters/monitor-start-compat.js";
vi.mock("../src/adapters/monitor-start-compat.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../src/adapters/monitor-start-compat.js")
    >();
  return { ...original, resolveMonitorRequest: vi.fn() };
});
const owner = { id: "connection-owned" };
async function report(lines = "1mA 3.3V\n3mA 3.3V\n") {
  const buffer = new SerialSessionBuffer();
  buffer.append(Buffer.from(lines));
  return captureSessionPower(
    { read: async (_owner, _id, options) => buffer.read(options) },
    owner,
    "meter",
    { seconds: 0.001, provenance: "firmware_estimate" },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveMonitorRequest).mockResolvedValue({
    request: { path: "FAKE", baudRate: 115200, projectDir: "fixture" },
  } as never);
});
function fixture(value: Awaited<ReturnType<typeof report>>) {
  const order: string[] = [];
  const service = {
    waitPowerTrigger: vi.fn(async () => {
      order.push("trigger");
      return { trigger_line: "READY", trigger_offset_s: 0.1 };
    }),
    capturePowerOnce: vi.fn(async () => {
      order.push("capture");
      return { ...value, port: "FAKE", baud: 115200, cleanupPending: false };
    }),
  };
  const run = vi.fn(async (_context, execute) => execute(service, owner));
  return {
    service,
    order,
    run,
    client: { run } as unknown as SerialClientContext,
  };
}
it("preserves measured results and marks uncertain cleanup incomplete", async () => {
  const result = await report();
  const source = { port: "FAKE", baud: 115200, seconds: 10, sessionId: null };
  expect(projectSerialPowerCompatibility(result, source)).toMatchObject({
    ok: true,
    source: "serial",
    average_ma: 2,
    voltage_mv: 3300,
    sample_count: 2,
    duration_s: 0,
    seconds: 10,
    provenance: "firmware_estimate",
    timing_basis: "host_read_observation",
  });
  expect(
    projectSerialPowerCompatibility(result, {
      ...source,
      cleanupPending: true,
    }),
  ).toMatchObject({
    ok: false,
    cleanup_pending: true,
    collection_complete: false,
  });
});
it("reports absent samples without invented zero-current measurements", async () => {
  expect(
    projectSerialPowerCompatibility(await report("no reading\n"), {
      port: "FAKE",
      baud: 115200,
      seconds: 1,
      sessionId: null,
    }),
  ).toMatchObject({
    ok: false,
    sample_count: 0,
    unparsed_lines: 1,
    error: "No current readings captured.",
  });
});
it("uses separate trigger and capture grants and opens only after trigger success", async () => {
  const f = fixture(await report());
  const result = await executeSerialPowerCompatibility(
    f.client,
    {
      port: "FAKE",
      trigger: "READY",
      trigger_session_id: "firmware",
      trigger_approval_id: "trigger-grant",
      read_approval_id: "read-grant",
      approval_id: "open-grant",
    },
    {},
    {},
    () => ({ likely_ports: [] }),
  );
  expect(f.order).toEqual(["trigger", "capture"]);
  expect(f.run.mock.calls[0][0]).toMatchObject({
    readApprovalId: "trigger-grant",
  });
  expect(f.run.mock.calls[1][0]).toMatchObject({
    readApprovalId: "read-grant",
    approvalId: "open-grant",
  });
  expect(f.service.waitPowerTrigger.mock.calls[0][0]).toBe(owner);
  expect(result).toMatchObject({
    trigger_line: "READY",
    trigger_offset_s: 0.1,
    session_id: null,
  });
});
it("never opens the meter if the trigger session is foreign or fails", async () => {
  const f = fixture(await report());
  f.service.waitPowerTrigger.mockRejectedValueOnce(new Error("not owned"));
  await expect(
    executeSerialPowerCompatibility(
      f.client,
      { trigger: "READY", trigger_session_id: "foreign" },
      {},
      {},
      () => ({ likely_ports: [] }),
    ),
  ).rejects.toThrow("not owned");
  expect(resolveMonitorRequest).not.toHaveBeenCalled();
  expect(f.service.capturePowerOnce).not.toHaveBeenCalled();
});
it("validates patterns before trigger or discovery and rejects incomplete trigger arguments", async () => {
  const f = fixture(await report());
  await expect(
    executeSerialPowerCompatibility(f.client, { pattern: "(" }, {}, {}, () => ({
      likely_ports: [],
    })),
  ).rejects.toMatchObject({ code: "PATTERN_INVALID" });
  expect(f.run).not.toHaveBeenCalled();
  expect(resolveMonitorRequest).not.toHaveBeenCalled();
  expect(
    SerialPowerCompatibilitySchema.safeParse({ trigger: "READY" }).success,
  ).toBe(false);
  expect(
    SerialPowerCompatibilitySchema.safeParse({ source: "ppk2" }).success,
  ).toBe(false);
});
it("returns a recoverable session identifier if one-shot cleanup is pending", async () => {
  const value = await report(),
    f = fixture(value);
  f.service.capturePowerOnce.mockResolvedValueOnce({
    ...value,
    port: "FAKE",
    baud: 115200,
    cleanupPending: true,
  });
  expect(
    await executeSerialPowerCompatibility(f.client, {}, {}, {}, () => ({
      likely_ports: [],
    })),
  ).toMatchObject({
    session_id: "meter",
    cleanup_pending: true,
    ok: false,
    collection_complete: false,
  });
});
