/** Public power deny rules stop both collector routes before either service is invoked. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executePowerCompatibility } from "../src/adapters/power-compat.js";
import { PowerMeterClient } from "../src/adapters/power-meter-client.js";
import type { SerialClientContext } from "../src/adapters/serial-client.js";
let root: string, project: string;
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-power-route-")),
  );
  project = path.join(root, "project");
  await fs.mkdir(project);
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "state"));
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "policy.json"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
it.each(["pio_power_profile", "start_monitor"])(
  "honors %s denial before serial or meter execution",
  async (denied) => {
    await fs.writeFile(
      path.join(root, "policy.json"),
      JSON.stringify({
        profile: "lab_admin",
        overrides: {
          allow: ["start_monitor"],
          deny: [denied],
          approval_required: [],
          audit_all_agent_actions: false,
        },
      }),
    );
    const meter = new PowerMeterClient(),
      run = vi.spyOn(meter, "run"),
      serialRun = vi.fn();
    const serial = { run: serialRun } as unknown as SerialClientContext;
    for (const input of [
      { source: "serial", port: "FAKE" },
      {
        source: "ppk2",
        port: "meter",
        dut_port: "dut",
        mode: "source",
        voltage_mv: 3300,
        current_limit_ma: 50,
      },
    ])
      await expect(
        executePowerCompatibility(
          serial,
          meter,
          input,
          { projectDir: project },
          {},
        ),
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(run).not.toHaveBeenCalled();
    expect(serialRun).not.toHaveBeenCalled();
  },
);
