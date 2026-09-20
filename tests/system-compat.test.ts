/** System compatibility reports must obey canonical policy before querying the host. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeSystemCompatibility } from "../src/adapters/system-compat.js";
import { execPioCommand } from "../src/platformio.js";
import { getSystemInfo } from "../src/tools/projects.js";
import { PlatformIONotInstalledError } from "../src/utils/errors.js";
import { SerialClientContext } from "../src/adapters/serial-client.js";
vi.mock("../src/platformio.js", () => ({ execPioCommand: vi.fn() }));
vi.mock("../src/tools/projects.js", () => ({ getSystemInfo: vi.fn() }));
let project: string;
let operator: string;
beforeEach(() => {
  vi.resetAllMocks();
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-system-"));
  operator = fs.mkdtempSync(path.join(os.tmpdir(), "pio-system-state-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", operator);
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(operator, { recursive: true, force: true });
});
it("reports missing Core without querying metadata or sessions", async () => {
  vi.mocked(execPioCommand).mockRejectedValue(
    new PlatformIONotInstalledError(),
  );
  const run = vi.fn();
  const result = await executeSystemCompatibility(
    {},
    { run } as unknown as SerialClientContext,
    "test-version",
    { cwd: project },
  );
  expect(result).toMatchObject({
    ok: false,
    error: "pio_not_found",
    server_version: "test-version",
    policy: "read_only",
  });
  expect(getSystemInfo).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
it("rejects a denied system query before launching Core", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { deny: ["system_info"], audit_all_agent_actions: false },
    }),
  );
  await expect(
    executeSystemCompatibility(
      {},
      { run: vi.fn() } as unknown as SerialClientContext,
      "test-version",
      { cwd: project },
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(execPioCommand).not.toHaveBeenCalled();
});
it("projects metadata and warnings without fabricating missing values", async () => {
  vi.mocked(execPioCommand).mockResolvedValue({
    stdout: "PlatformIO Core 6.1",
    stderr: "Obsolete PIO Core",
    exitCode: 0,
  } as Awaited<ReturnType<typeof execPioCommand>>);
  vi.mocked(getSystemInfo).mockResolvedValue({
    core_version: { value: "6.1" },
    platformio_exe: { value: "/trusted/pio" },
    dev_platform_nums: { value: 2 },
  });
  const client = new SerialClientContext();
  try {
    const result = await executeSystemCompatibility(
      {},
      client,
      "test-version",
      { cwd: project },
    );
    expect(result).toMatchObject({
      ok: true,
      core_version: "6.1",
      pio_command: ["/trusted/pio"],
      installed_platforms: 2,
      python: null,
      obsolete_core_warning: true,
      open_monitor_sessions: [],
    });
  } finally {
    await client.close();
  }
});
