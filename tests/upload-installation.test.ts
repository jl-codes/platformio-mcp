/** Host upload discovery rejects unregistered or project-controlled tool installations. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import { discoverUploadInstallation } from "../src/core/analysis/upload-installation.js";
let root: string, project: string, core: string, compiler: string;
const packageRecord = async (folder: string, name: string) => {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({ name, version: "1.0.0" }),
  );
  await fs.writeFile(
    path.join(folder, ".piopm"),
    JSON.stringify({ type: "tool", name, version: "1.0.0" }),
  );
};
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-upload-install-")),
  );
  project = path.join(root, "project");
  core = path.join(root, "core");
  await fs.mkdir(project);
  const tools = path.join(core, "packages", "toolchain-fixture");
  await packageRecord(tools, "toolchain-fixture");
  compiler = path.join(tools, "compiler.exe");
  await fs.writeFile(compiler, "fixture");
  const uploader = path.join(core, "packages", "tool-esptoolpy");
  await packageRecord(uploader, "tool-esptoolpy");
  await fs.writeFile(path.join(uploader, "esptool.py"), "fixture");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const info = () => ({
  core_dir: { value: core },
  python_exe: { value: process.execPath },
});
it("returns canonical registered tool identities and excludes unregistered image roots", async () => {
  await fs.mkdir(path.join(core, "packages", "unregistered"));
  const selected = await discoverUploadInstallation(info(), project, compiler);
  expect(selected.toolchain).toEqual({
    id: "toolchain-fixture",
    version: "1.0.0",
  });
  expect(selected.trustedImageRoots).toHaveLength(2);
  expect(selected.esptoolPath).toBe(
    path.join(core, "packages", "tool-esptoolpy", "esptool.py"),
  );
});
it("rejects registration/version mismatch for the selected uploader", async () => {
  await fs.writeFile(
    path.join(core, "packages", "tool-esptoolpy", ".piopm"),
    JSON.stringify({ name: "tool-esptoolpy", type: "tool", version: "other" }),
  );
  await expect(
    discoverUploadInstallation(info(), project, compiler),
  ).rejects.toMatchObject({ code: "UPLOAD_INSTALLATION_INVALID" });
});
it("rejects compiler and interpreter selected from inside the project", async () => {
  const executable = path.join(project, "python.exe");
  await fs.writeFile(executable, "fixture");
  await expect(
    discoverUploadInstallation(info(), project, executable),
  ).rejects.toThrow();
  await expect(
    discoverUploadInstallation(
      { ...info(), python_exe: { value: executable } },
      project,
      compiler,
    ),
  ).rejects.toThrow();
});
it("does not choose arbitrarily between two registered uploader packages", async () => {
  await packageRecord(
    path.join(core, "packages", "other-esptool"),
    "tool-esptoolpy",
  );
  await expect(
    discoverUploadInstallation(info(), project, compiler),
  ).rejects.toMatchObject({ code: "UPLOAD_INSTALLATION_INVALID" });
});
