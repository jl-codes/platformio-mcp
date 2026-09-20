/** Named target execution must preserve policy effects and full-log report behavior. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeNamedTarget } from "../src/tools/run-target.js";
import { buildTarget } from "../src/tools/build.js";
import { SerialClientContext } from "../src/adapters/serial-client.js";
vi.mock("../src/tools/build.js", () => ({ buildTarget: vi.fn() }));
vi.mock("../src/utils/lock-manager.js", () => ({
  hardwareLockManager: {
    withImplicitLock: (run: () => Promise<unknown>) => run(),
  },
}));
vi.mock("../src/utils/command-log.js", () => ({
  readCommandOutput: vi.fn(
    async () =>
      "Processing native (platform: native)\n===== [SUCCESS] Took 1 seconds =====",
  ),
  retainCommandLog: vi.fn(async () => "retained.log"),
}));
let project: string;
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-run-target-"));
  fs.writeFileSync(
    path.join(project, "platformio.ini"),
    "[env:native]\nplatform=native\n",
  );
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "build_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
  vi.mocked(buildTarget).mockReset();
  vi.mocked(buildTarget).mockImplementation(
    async (_project, _target, _env, _verbose, execution) => {
      await execution?.onResult?.({
        exitCode: 0,
        finalOutput: "ok",
        fullLogPath: "spool.log",
      });
      return { success: true, environment: "native" };
    },
  );
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));
it("executes a permitted named build and retains the reference result shape", async () => {
  const client = { run: vi.fn() } as unknown as SerialClientContext;
  const result = await executeNamedTarget(
    { target: "buildfs", project_dir: project },
    client,
  );
  expect(result).toMatchObject({
    ok: true,
    status: "success",
    log_path: "retained.log",
    exit_code: 0,
  });
  expect(result.summary).toContain("target-buildfs success");
  expect(buildTarget).toHaveBeenCalledOnce();
  expect(client.run).not.toHaveBeenCalled();
});
it.each(["upload", "uploadfs", "erase", "custom-flash"])(
  "denies %s before touching sessions or spawning",
  async (target) => {
    const client = { run: vi.fn() } as unknown as SerialClientContext;
    await expect(
      executeNamedTarget({ target, project_dir: project }, client),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(buildTarget).not.toHaveBeenCalled();
    expect(client.run).not.toHaveBeenCalled();
  },
);
it("preserves uncertain process custody errors", async () => {
  const error = Object.assign(new Error("cleanup pending"), {
    code: "PROCESS_CLEANUP_PENDING",
  });
  vi.mocked(buildTarget).mockRejectedValue(error);
  await expect(
    executeNamedTarget(
      { target: "buildfs", project_dir: project },
      {} as SerialClientContext,
    ),
  ).rejects.toBe(error);
});
