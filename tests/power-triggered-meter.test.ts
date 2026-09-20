/** A fresh trigger precedes meter startup, and failed cleanup stays with the meter owner. */
import { expect, it, vi } from "vitest";
import { executeTriggeredMeter } from "../src/adapters/power-triggered-meter.js";
import {
  Ppk2CompatibilitySchema,
  type PowerMeterClient,
} from "../src/adapters/power-meter-client.js";
import type { SerialClientContext } from "../src/adapters/serial-client.js";
const params = () =>
  Ppk2CompatibilitySchema.parse({
    source: "ppk2",
    port: "meter",
    dut_port: "dut",
    mode: "ampere",
    voltage_mv: 3300,
    current_limit_ma: 100,
    trigger: "READY",
    trigger_session_id: "owned",
    trigger_approval_id: "read-grant",
  });
it("waits for a fresh owned trigger before transferring the hold", async () => {
  const order: string[] = [];
  const owner = { id: "connection" },
    hold = { releaseAfterExit: vi.fn() };
  const service = {
    waitPowerTrigger: vi.fn(async () => {
      order.push("trigger");
      return { trigger_line: "READY" };
    }),
    sessions: {
      holdForPower: vi.fn(() => {
        order.push("hold");
        return hold;
      }),
    },
  };
  const serial = {
    run: vi.fn(async (_context, execute) => execute(service, owner)),
  };
  const meter = {
    run: vi.fn(async () => {
      order.push("meter");
      return { ok: true };
    }),
  };
  const result = await executeTriggeredMeter(
    serial as unknown as SerialClientContext,
    meter as unknown as PowerMeterClient,
    params(),
    {},
    {},
  );
  expect(order).toEqual(["trigger", "hold", "meter"]);
  expect(serial.run.mock.calls[0][0]).toMatchObject({
    readApprovalId: "read-grant",
  });
  expect(service.waitPowerTrigger).toHaveBeenCalledWith(owner, "owned", {
    trigger: "READY",
    seconds: 10,
  });
  expect(meter.run.mock.calls[0]).toEqual([
    params(),
    {},
    {},
    hold,
    expect.any(Function),
  ]);
  expect(result).toMatchObject({ ok: true, trigger_line: "READY" });
  expect(hold.releaseAfterExit).not.toHaveBeenCalled();
});
it("does not open a meter or take custody after trigger failure", async () => {
  const holdForPower = vi.fn(),
    run = vi.fn();
  const service = {
    waitPowerTrigger: async () => {
      throw new Error("trigger timeout");
    },
    sessions: { holdForPower },
  };
  const serial = {
    run: async (
      _context: unknown,
      execute: (value: typeof service, owner: object) => Promise<unknown>,
    ) => execute(service, {}),
  };
  await expect(
    executeTriggeredMeter(
      serial as unknown as SerialClientContext,
      { run } as unknown as PowerMeterClient,
      params(),
      {},
      {},
    ),
  ).rejects.toThrow("trigger timeout");
  expect(holdForPower).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
it("requires both trigger fields", () => {
  expect(() =>
    Ppk2CompatibilitySchema.parse({
      ...params(),
      trigger_session_id: undefined,
    }),
  ).toThrow();
});
