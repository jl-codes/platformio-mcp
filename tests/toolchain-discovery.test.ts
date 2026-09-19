import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect } from "vitest";
import { discoverAnalysisToolchainRoots } from "../src/core/analysis/toolchain-discovery.js";
let root: string, project: string, core: string, pkg: string, compiler: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-discovery-"));
  project = path.join(root, "project");
  core = path.join(root, "core");
  pkg = path.join(core, "packages/toolchain-test");
  compiler = path.join(pkg, "bin/gcc");
  await fs.mkdir(project);
  await fs.mkdir(path.dirname(compiler), { recursive: true });
  await fs.writeFile(compiler, "fixture");
  await fs.writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "toolchain-test", version: "1" }),
  );
  await fs.writeFile(
    path.join(pkg, ".piopm"),
    JSON.stringify({ type: "tool", name: "toolchain-test", version: "1" }),
  );
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));
const discover = (
  info: unknown = { core_dir: { value: core } },
  env: NodeJS.ProcessEnv = {},
) => discoverAnalysisToolchainRoots(compiler, info, project, env);
it("selects only the registered package containing the compiler", async () =>
  expect(await discover()).toEqual([pkg]));
it("rejects mismatched package records", async () => {
  await fs.writeFile(
    path.join(pkg, ".piopm"),
    '{"type":"tool","name":"toolchain-test","version":"2"}',
  );
  await expect(discover()).rejects.toMatchObject({
    code: "ANALYSIS_TOOLCHAIN_UNTRUSTED",
  });
});
it("requires explicit configuration for compilers outside host packages", async () => {
  compiler = path.join(root, "gcc");
  await fs.writeFile(compiler, "fixture");
  await expect(discover()).rejects.toThrow("outside registered");
});
it("uses explicitly configured operator roots without guessing a system installation", async () =>
  expect(
    await discover(null, { PIO_MCP_TOOLCHAIN_ROOTS: JSON.stringify([pkg]) }),
  ).toEqual([pkg]));
it.each(["", "[]", '["relative"]', "{}"])(
  "rejects malformed explicit configuration %s",
  async (value) =>
    await expect(
      discover(undefined, { PIO_MCP_TOOLCHAIN_ROOTS: value }),
    ).rejects.toThrow(),
);
it("rejects project-owned roots including aliases", async () => {
  const alias = path.join(root, "alias");
  await fs.symlink(project, alias, "junction");
  await expect(
    discover(undefined, { PIO_MCP_TOOLCHAIN_ROOTS: JSON.stringify([alias]) }),
  ).rejects.toThrow("project-owned");
});
it("does not infer Core location from missing system info", async () =>
  await expect(discover({})).rejects.toThrow("Core directory"));

it("rejects broad roots that contain the project",async()=>await expect(discover(undefined,{PIO_MCP_TOOLCHAIN_ROOTS:JSON.stringify([root])})).rejects.toThrow("project-owned"));
