/** PPK2 interpreter selection remains host-owned and preserves virtual environment identity. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolvePpk2Environment } from "../src/core/power/ppk2-environment.js";
let root: string, project: string, environment: string;
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-ppk2-env-")),
  );
  project = path.join(root, "project");
  environment = path.join(root, "venv");
  await fs.mkdir(project);
  await fs.mkdir(environment);
  const bin = path.join(
    environment,
    process.platform === "win32" ? "Scripts" : "bin",
  );
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(bin, process.platform === "win32" ? "python.exe" : "python"),
    "fixture",
  );
  await fs.writeFile(
    path.join(environment, "pyvenv.cfg"),
    "include-system-site-packages = false\n",
  );
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));
it("requires explicit host configuration", async () => {
  await expect(resolvePpk2Environment(project, {})).rejects.toMatchObject({
    code: "PPK2_ENV_UNCONFIGURED",
  });
});
it("selects a native venv interpreter without trusting setup receipt paths", async () => {
  await fs.writeFile(
    path.join(environment, "ppk2-setup.json"),
    JSON.stringify({ pythonExecutable: "attacker.cmd" }),
  );
  const result = await resolvePpk2Environment(project, {
    PIO_MCP_PPK2_ENV: environment,
  });
  expect(result.environmentRoot).toBe(environment);
  expect(result.pythonExecutable).toBe(
    path.join(
      environment,
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
  );
});
it("rejects project-contained environments and project-containing environments", async () => {
  for (const pair of [
    [root, environment],
    [environment, root],
  ])
    await expect(
      resolvePpk2Environment(pair[0], { PIO_MCP_PPK2_ENV: pair[1] }),
    ).rejects.toMatchObject({ code: "PPK2_ENV_INVALID" });
});
it("rejects inherited system packages and missing venv configuration", async () => {
  await fs.writeFile(
    path.join(environment, "pyvenv.cfg"),
    "include-system-site-packages = true\n",
  );
  await expect(
    resolvePpk2Environment(project, { PIO_MCP_PPK2_ENV: environment }),
  ).rejects.toMatchObject({ code: "PPK2_ENV_INVALID" });
  await fs.unlink(path.join(environment, "pyvenv.cfg"));
  await expect(
    resolvePpk2Environment(project, { PIO_MCP_PPK2_ENV: environment }),
  ).rejects.toMatchObject({ code: "PPK2_ENV_INVALID" });
});

it.each([
  "include-system-site-packages = false\ninclude-system-site-packages = true\n",
  "include-system-site-packages = true\ninclude-system-site-packages = false\n",
  "include-system-site-packages = false\n include-system-site-packages = false\n",
])(
  "rejects ambiguous virtual environment configuration: %s",
  async (settings) => {
    await fs.writeFile(path.join(environment, "pyvenv.cfg"), settings);
    await expect(
      resolvePpk2Environment(project, { PIO_MCP_PPK2_ENV: environment }),
    ).rejects.toMatchObject({ code: "PPK2_ENV_INVALID" });
  },
);
