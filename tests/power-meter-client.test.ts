/** Connection composition keeps cleanup ownership after failures and cancels work on disconnect. */
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  collect: vi.fn(),
  cleanup: vi.fn(),
  pending: true,
  options: undefined as any,
}));
vi.mock("../src/adapters/compatibility-project.js", () => ({
  resolveCompatibilityProject: async () => "/fixture/project",
}));
vi.mock("../src/core/power/ppk2-environment.js", () => ({
  resolvePpk2Environment: async () => ({ pythonExecutable: "/host/python" }),
}));
vi.mock("../src/core/power/power-serial-discovery.js", () => ({
  withPowerSerialDiscovery: async (
    _input: unknown,
    _caller: unknown,
    execute: any,
  ) => execute(async () => []),
  bindPowerSerialDevice: (port: string) => ({
    port,
    custody: {
      resources: [{ kind: "serial", identity: port }],
      revalidate: async () => {},
    },
  }),
}));
vi.mock("../src/core/power/authorized-ppk2.js", () => ({
  AuthorizedPpk2Operation: class {
    constructor(options: unknown) {
      fixture.options = options;
    }
    collect = fixture.collect;
    cleanupProcess = fixture.cleanup;
    state() {
      return { cleanupPending: fixture.pending, powerMayBeOn: fixture.pending };
    }
  },
}));
vi.mock("../src/core/power/ppk2-report.js", () => ({
  projectPpk2PowerReport: () => ({ ok: true }),
}));
import { PowerMeterClient } from "../src/adapters/power-meter-client.js";
import { PlatformIOError } from "../src/utils/errors.js";
const input = {
  source: "ppk2",
  port: "meter",
  dut_port: "dut",
  mode: "source",
  voltage_mv: 3300,
  current_limit_ma: 50,
};
beforeEach(() => {
  vi.resetAllMocks();
  fixture.pending = true;
  fixture.collect.mockImplementation(async () => {
    fixture.pending = false;
    return {};
  });
  fixture.cleanup.mockImplementation(async () => {
    fixture.pending = false;
  });
});
it("composes explicit device/electrical settings and forgets confirmed cleanup", async () => {
  const client = new PowerMeterClient();
  expect(await client.run(input, {}, {})).toMatchObject({
    ok: true,
    dut_port: "dut",
  });
  expect(fixture.options.request).toMatchObject({
    mode: "source",
    voltageMv: 3300,
    currentLimitMa: 50,
    seconds: 10,
  });
  expect(client.list()).toEqual([]);
  await client.close();
});
it("preserves policy errors and disposes inert owners after approval rejection", async () => {
  fixture.collect.mockRejectedValueOnce(
    new PlatformIOError("approval", "APPROVAL_REQUIRED", {
      policyDecision: { approvalId: "grant" },
    }),
  );
  const client = new PowerMeterClient();
  await expect(client.run(input, {}, {})).rejects.toMatchObject({
    code: "APPROVAL_REQUIRED",
    context: { policyDecision: { approvalId: "grant" } },
  });
  expect(fixture.cleanup).toHaveBeenCalledOnce();
  expect(client.list()).toEqual([]);
});
it("retains cleanup failure under an ID unavailable to another connection", async () => {
  fixture.collect.mockRejectedValueOnce(new Error("interrupted"));
  fixture.cleanup.mockRejectedValueOnce(new Error("pending"));
  const client = new PowerMeterClient();
  const error = await client.run(input, {}, {}).catch((error) => error);
  const id = error.context.powerOperationId;
  expect(error.context.cleanupPending).toBe(true);
  expect(client.list()).toHaveLength(1);
  await expect(new PowerMeterClient().cleanup(id)).rejects.toMatchObject({
    code: "POWER_OPERATION_NOT_FOUND",
  });
  await client.cleanup(id);
  expect(client.list()).toEqual([]);
});
it("cancels active collection on disconnect and rejects new work", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  fixture.collect.mockImplementation(
    (signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
        started();
      }),
  );
  const client = new PowerMeterClient();
  const running = client.run(input, {}, {}).catch((error) => error);
  await ready;
  await client.close();
  expect((await running).message).toBe("cancelled");
  expect(client.list()).toEqual([]);
  await expect(client.run(input, {}, {})).rejects.toMatchObject({
    code: "POWER_CLIENT_CLOSED",
  });
});
