/** Connection composition keeps cleanup ownership after failures and cancels work on disconnect. */
import type { AuthorizedPpk2Options } from "../src/core/power/authorized-ppk2.js";
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  selection: vi.fn(),
  collect: vi.fn(),
  cleanup: vi.fn(),
  pending: true,
  options: undefined as unknown as AuthorizedPpk2Options,
}));
vi.mock("../src/adapters/compatibility-project.js", () => ({
  resolveCompatibilityProject: async () => "/fixture/project",
}));
vi.mock("../src/core/power/ppk2-environment.js", () => ({
  resolvePpk2Environment: async () => ({ pythonExecutable: "/host/python" }),
}));
vi.mock("../src/core/power/power-serial-discovery.js", () => ({
  selectPpk2Port: fixture.selection,
  withPowerSerialDiscovery: async (
    _input: unknown,
    _caller: unknown,
    execute: (read: () => Promise<never[]>) => Promise<unknown>,
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
    constructor(options: AuthorizedPpk2Options) {
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

it("returns unused holds when admission fails or the monitor project differs", async () => {
  const hold = {
    projectDir: "/other",
    resources: [{ kind: "serial" as const, identity: "dut" }],
    signal: new AbortController().signal,
    prepareSpawn: vi.fn(),
    releaseAfterExit: vi.fn(),
  };
  const args = { ...input, trigger: "READY", trigger_session_id: "monitor" };
  const client = new PowerMeterClient();
  await expect(client.run(args, {}, {}, hold)).rejects.toMatchObject({
    code: "POWER_DUT_SCOPE_MISMATCH",
  });
  expect(hold.releaseAfterExit).toHaveBeenCalledOnce();
  await client.close();
  await expect(client.run(args, {}, {}, hold)).rejects.toMatchObject({
    code: "POWER_CLIENT_CLOSED",
  });
  expect(hold.releaseAfterExit).toHaveBeenCalledTimes(2);
  expect(fixture.collect).not.toHaveBeenCalled();
});
it("transfers monitor custody to retained failed cleanup without releasing it at adapter return", async () => {
  const hold = {
    projectDir: "/fixture/project",
    resources: [{ kind: "serial" as const, identity: "dut" }],
    signal: new AbortController().signal,
    prepareSpawn: vi.fn(),
    releaseAfterExit: vi.fn(),
  };
  fixture.collect.mockRejectedValueOnce(new Error("interrupted"));
  fixture.cleanup.mockRejectedValueOnce(new Error("still powered"));
  const client = new PowerMeterClient();
  const error = await client
    .run(
      { ...input, trigger: "READY", trigger_session_id: "monitor" },
      {},
      {},
      hold,
    )
    .catch((error) => error);
  expect(fixture.options.dutHold).toBe(hold);
  expect(error.context.cleanupPending).toBe(true);
  expect(hold.releaseAfterExit).not.toHaveBeenCalled();
  await client.cleanup(error.context.powerOperationId);
});

it("binds the discovered meter before authorizing or collecting", async () => {
  fixture.selection.mockReturnValue("discovered-meter");
  const client = new PowerMeterClient();
  await client.run({ ...input, port: undefined }, {}, {});
  expect(fixture.options.request.port).toBe("discovered-meter");
  expect(fixture.options.meter.resources).toContainEqual({
    kind: "serial",
    identity: "discovered-meter",
  });
  await client.close();
});
it("never collects when automatic selection is ambiguous", async () => {
  fixture.selection.mockImplementation(() => {
    throw new PlatformIOError("select", "POWER_DEVICE_SELECTION_REQUIRED");
  });
  const client = new PowerMeterClient();
  await expect(
    client.run({ ...input, port: null }, {}, {}),
  ).rejects.toMatchObject({ code: "POWER_DEVICE_SELECTION_REQUIRED" });
  expect(fixture.collect).not.toHaveBeenCalled();
  await client.close();
});
