/** Background dispatch retains operation semantics and consumes approval only in its worker. */
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  authorize: vi.fn(),
  approve: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
}));
vi.mock("../src/core/action-dispatcher.js", async (original) => ({
  ...(await original<typeof import("../src/core/action-dispatcher.js")>()),
  authorizeAction: mocks.authorize,
}));
vi.mock("../src/core/policy/approvals.js", async (original) => ({
  ...(await original<typeof import("../src/core/policy/approvals.js")>()),
  approveRequest: mocks.approve,
}));
vi.mock("../src/cli/prompt.js", () => ({ promptApproval: mocks.prompt }));

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-cli-worker-"));
const previousDataDir = process.env.PIO_MCP_DATA_DIR;
process.env.PIO_MCP_DATA_DIR = testDataDir;
const { COMMANDS, runCliCommand } = await import("../src/cli.js");
const { configurePolicyFileFromArgs } =
  await import("../src/core/policy/policy-sources.js");
const { getCommandHistory } = await import("../src/utils/command-registry.js");
const originalBuild = COMMANDS.build;
const handler = vi.fn();
let savedExitCode: typeof process.exitCode;

beforeEach(() => {
  vi.clearAllMocks();
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.authorize.mockResolvedValue({ status: "allow", reason: "test" });
  mocks.approve.mockReturnValue({ status: "approved" });
  mocks.prompt.mockResolvedValue(true);
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      pid: 123456,
      unref: vi.fn(),
    });
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  handler.mockResolvedValue({ status: "running" });
  COMMANDS.build = handler;
});

afterEach(() => {
  COMMANDS.build = originalBuild;
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.PIO_MCP_DATA_DIR;
  else process.env.PIO_MCP_DATA_DIR = previousDataDir;
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

describe("background worker dispatch", () => {
  it.each([
    ["--background"],
    ["--background=true"],
    ["--background=1"],
    ["--background=yes"],
    ["--background=on"],
    ["--background", "true"],
  ])("dispatches exactly one worker for %j", async (...backgroundArgs) => {
    const rawArgs = ["--project-dir", testDataDir, ...backgroundArgs, "--json"];
    await runCliCommand("build", rawArgs);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const childArgs = mocks.spawn.mock.calls[0][1] as string[];
    const routedArgs = childArgs.slice(childArgs.indexOf("build") + 1);
    expect(routedArgs.slice(0, rawArgs.length)).toEqual(rawArgs);
    const taskId = routedArgs[routedArgs.indexOf("--__task-id") + 1];
    expect(
      getCommandHistory(testDataDir).some((item) => item.id === taskId),
    ).toBe(true);

    await runCliCommand("build", routedArgs);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    const options = handler.mock.calls[0][0].options;
    expect(options.background).toBe(
      backgroundArgs[0] === "--background" && backgroundArgs.length === 1
        ? true
        : backgroundArgs[0].includes("=")
          ? backgroundArgs[0].split("=")[1]
          : "true",
    );
    expect(mocks.authorize.mock.calls[1][1]).not.toHaveProperty("__task-id");
  });

  it.each(["false", "0", "no", "off"])(
    "does not detach for --background=%s",
    async (value) => {
      await runCliCommand("build", ["--background=" + value, "--json"]);
      expect(mocks.spawn).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  it("propagates an explicit launch policy", async () => {
    const policyFile = path.join(testDataDir, "operator-policy.json");
    const routed = configurePolicyFileFromArgs([
      "--policy-file",
      policyFile,
      "build",
      "--project-dir",
      testDataDir,
      "--background",
      "--json",
    ]);
    await runCliCommand(routed[0], routed.slice(1));
    expect(mocks.spawn.mock.calls[0][2].env.PIO_MCP_POLICY_FILE).toBe(
      policyFile,
    );
  });

  it.each([
    { flags: [], prompts: 1 },
    { flags: ["--json=true", "--approve"], prompts: 0 },
  ])(
    "hands the unconsumed scoped grant to the worker with $flags",
    async ({ flags, prompts }) => {
      const approvalId = "approval-" + crypto.randomUUID();
      mocks.authorize.mockResolvedValueOnce({
        status: "requires_approval",
        reason: "upload",
        approvalId,
      });
      const args = ["--project-dir", testDataDir, "--background=yes", ...flags];
      await runCliCommand("build", args);
      expect(mocks.prompt).toHaveBeenCalledTimes(prompts);
      expect(mocks.approve).toHaveBeenCalledWith(approvalId);
      expect(mocks.authorize).toHaveBeenCalledTimes(1);
      const spawned = mocks.spawn.mock.calls[0][1] as string[];
      const workerArgs = spawned.slice(spawned.indexOf("build") + 1);
      expect(workerArgs).toContain(approvalId);
      await runCliCommand("build", workerArgs);
      expect(mocks.prompt).toHaveBeenCalledTimes(prompts);
      const parentScope = mocks.authorize.mock.calls[0][1];
      expect(mocks.authorize.mock.calls[1][1]).toEqual({
        ...parentScope,
        approvalId,
      });
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  it("fails closed when the worker no longer has a valid grant", async () => {
    mocks.authorize.mockResolvedValue({
      status: "requires_approval",
      reason: "grant no longer matches",
    });
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await runCliCommand("build", [
      "--background=true",
      "--approve",
      "--__task-id",
      crypto.randomUUID(),
      "--json",
    ]);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("records a terminal task when the worker process cannot start", async () => {
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      queueMicrotask(() =>
        child.emit("error", new Error("Worker executable unavailable")),
      );
      return child;
    });
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await runCliCommand("build", [
      "--project-dir",
      testDataDir,
      "--background",
      "--json",
    ]);
    expect(process.exit).toHaveBeenCalledWith(1);
    const recorded = getCommandHistory(testDataDir).find(
      (item) => item.error === "Worker executable unavailable",
    );
    expect(recorded?.status).toBe("error");
    expect(recorded?.tasks[0].status).toBe("error");
  });
});
