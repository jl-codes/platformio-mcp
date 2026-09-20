/** Device hints are presentation only and must not leak internal claim metadata. */
import { expect, it, vi } from "vitest";
import {
  executeDeviceCompatibility,
  projectCompatibilityDevices,
} from "../src/adapters/device-compat.js";
it("sorts likely ports stably, suppresses noise and excludes internal identities", () => {
  const source = [
    { port: "COM1", description: "Bluetooth USB", hwid: "noise" },
    {
      port: "COM2",
      description: "CP2102",
      hwid: "USB",
      claim: { nonce: "private" },
      detectedBoard: "inferred",
    },
    { port: "COM3", description: "CMSIS-DAP", hwid: "" },
  ];
  const result = projectCompatibilityDevices(source);
  expect(result.likely_ports).toEqual(["COM2", "COM3"]);
  expect(result.devices.map((row) => row.port)).toEqual([
    "COM2",
    "COM3",
    "COM1",
  ]);
  expect(result.devices[0]).toEqual({
    port: "COM2",
    description: "CP2102",
    hwid: "USB",
    likely_dev_board: true,
  });
  expect(source[0].port).toBe("COM1");
  expect(result).not.toHaveProperty("open_monitor_sessions");
});
it("reports no-device evidence without inventing a port", () => {
  expect(projectCompatibilityDevices([])).toMatchObject({
    ok: true,
    devices: [],
    likely_ports: [],
  });
});

it("encodes monitor writes once, defaults the newline and rejects oversized UTF-8 before authorization", async () => {
  const owner = Object.freeze({ id: "private-owner" });
  const write = vi.fn(async () => ({
    bytesWritten: 3,
    drained: true as const,
  }));
  const run = vi.fn(async (_context, execute) =>
    execute(
      {
        sessions: {
          write,
          list: () => [{ sessionId: "session", path: "COM42" }],
        },
      },
      owner,
    ),
  );
  const client = {
    run,
  } as unknown as import("../src/adapters/serial-client.js").SerialClientContext;
  const result = await executeDeviceCompatibility(client, "pio_monitor_write", {
    session_id: "session",
    text: "�",
    approval_id: "grant",
  });
  expect(write).toHaveBeenCalledWith(
    owner,
    "session",
    Buffer.from("�\n", "utf8"),
  );
  expect(run.mock.calls[0][0]).toMatchObject({ approvalId: "grant" });
  expect(result).toMatchObject({ ok: true, session_id: "session", bytes: 3 });
  await expect(
    executeDeviceCompatibility(client, "pio_monitor_write", {
      session_id: "session",
      text: "�".repeat(32768),
    }),
  ).rejects.toMatchObject({ code: "SERIAL_WRITE_LIMIT" });
  expect(run).toHaveBeenCalledTimes(1);
});

it("starts explicit monitor sessions through identity-checked startup with separate opening and discovery grants", async () => {
  const owner = Object.freeze({ id: "private-owner" });
  const startWithDiscovery = vi.fn(async () => ({
    sessionId: "new",
    path: "COM42",
    baudRate: 115200,
    startedAt: new Date().toISOString(),
    state: "open",
    linesBuffered: 0,
    nextCursor: 0,
    bytesReceived: 0,
    cleanupPending: false,
  }));
  const run = vi.fn(async (_context, execute) =>
    execute({ startWithDiscovery }, owner),
  );
  const client = {
    run,
  } as unknown as import("../src/adapters/serial-client.js").SerialClientContext;
  const result = await executeDeviceCompatibility(client, "pio_monitor_start", {
    port: "COM42",
    approval_id: "open-grant",
    discovery_approval_id: "identity-grant",
    max_lines: 100,
  });
  expect(startWithDiscovery).toHaveBeenCalledWith(
    owner,
    expect.objectContaining({
      path: "COM42",
      baudRate: 115200,
      buffer: { maxLines: 100 },
    }),
  );
  expect(run.mock.calls[0][0]).toMatchObject({
    approvalId: "open-grant",
    discoveryApprovalId: "identity-grant",
  });
  expect(result).toMatchObject({
    ok: true,
    session_id: "new",
    port: "COM42",
    baud: 115200,
  });
});
