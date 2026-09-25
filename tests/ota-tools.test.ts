/** OTA executable discovery requires host metadata and matching registered framework identity. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import { resolveOtaTools } from "../src/core/ota/ota-tools.js";
let root: string, project: string, core: string, framework: string;
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-ota-tools-")),
  );
  project = path.join(root, "project");
  core = path.join(root, "core");
  framework = path.join(core, "packages", "framework-arduinoespressif32");
  await fs.mkdir(project);
  await fs.mkdir(path.join(framework, "tools"), { recursive: true });
  await fs.writeFile(
    path.join(framework, "package.json"),
    JSON.stringify({ name: "framework-arduinoespressif32", version: "1.2.3" }),
  );
  await fs.writeFile(
    path.join(framework, ".piopm"),
    JSON.stringify({
      name: "framework-arduinoespressif32",
      version: "1.2.3",
      type: "tool",
    }),
  );
  await fs.writeFile(
    path.join(framework, "tools", "espota.py"),
    "# fixture only\n",
  );
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));
function info() {
  return { python_exe: { value: process.execPath }, core_dir: { value: core } };
}
it("selects the registered framework uploader and binds its exact hash", async () => {
  const result = await resolveOtaTools(project, "espressif32", info(), {});
  expect(result).toMatchObject({
    pythonExecutable: await fs.realpath(process.execPath),
    packageName: "framework-arduinoespressif32",
    packageVersion: "1.2.3",
  });
  expect(result.uploaderSha256).toMatch(/^[a-f0-9]{64}$/);
});
it("rejects mismatched framework registrations", async () => {
  await fs.writeFile(
    path.join(framework, ".piopm"),
    JSON.stringify({ name: "another-package", version: "1.2.3", type: "tool" }),
  );
  await expect(
    resolveOtaTools(project, "espressif32", info(), {}),
  ).rejects.toMatchObject({ code: "OTA_TOOLS_UNTRUSTED" });
});
it("does not trust a workspace interpreter or missing host metadata", async () => {
  const python = path.join(project, "python.exe");
  await fs.writeFile(python, "not executable");
  await expect(
    resolveOtaTools(project, "espressif32", info(), {
      PIO_MCP_OTA_PYTHON: python,
    }),
  ).rejects.toMatchObject({ code: "OTA_TOOLS_UNTRUSTED" });
  await expect(
    resolveOtaTools(project, "espressif32", {}, {}),
  ).rejects.toMatchObject({ code: "OTA_TOOLS_UNAVAILABLE" });
});
