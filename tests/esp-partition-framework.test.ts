/** Framework CSV lookup requires selected, registered host packages. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect } from "vitest";
import {
  partitionFrameworkCandidates,
  resolveFrameworkPartitionCsv,
} from "../src/core/esp-partition-framework.js";
let root: string, project: string, pkg: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-framework-table-"));
  project = path.join(root, "project");
  pkg = path.join(root, "core", "packages", "framework-arduinoespressif32");
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(path.join(pkg, "tools", "partitions"), { recursive: true });
  await fs.writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "framework-arduinoespressif32", version: "1" }),
  );
  await fs.writeFile(
    path.join(pkg, ".piopm"),
    JSON.stringify({
      name: "framework-arduinoespressif32",
      version: "1",
      type: "tool",
    }),
  );
  await fs.writeFile(
    path.join(pkg, "tools", "partitions", "custom.csv"),
    "app,app,factory,,1M,",
  );
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("uses the complete include inventory beyond displayed truncation", () => {
  const includes = [
    ...Array.from({ length: 50 }, (_, i) => "/include/" + i),
    path.join(pkg, "cores", "esp32"),
  ];
  expect(partitionFrameworkCandidates(includes)).toEqual([path.normalize(pkg)]);
});
it("resolves a CSV from a matching registered package", async () => {
  const result = await resolveFrameworkPartitionCsv(
    "custom.csv",
    [pkg],
    { core_dir: { value: path.join(root, "core") } },
    project,
  );
  expect(result).toMatchObject({
    packageName: "framework-arduinoespressif32",
    packageVersion: "1",
    root: await fs.realpath(pkg),
  });
});
it("rejects registration version mismatch", async () => {
  await fs.writeFile(
    path.join(pkg, ".piopm"),
    JSON.stringify({
      name: "framework-arduinoespressif32",
      version: "2",
      type: "tool",
    }),
  );
  await expect(
    resolveFrameworkPartitionCsv(
      "custom.csv",
      [pkg],
      { core_dir: { value: path.join(root, "core") } },
      project,
    ),
  ).rejects.toMatchObject({ code: "PARTITION_FRAMEWORK_UNTRUSTED" });
});
it("does not turn an arbitrary project path into a trusted host root", async () => {
  await expect(
    resolveFrameworkPartitionCsv(
      "custom.csv",
      [project],
      { core_dir: { value: path.join(root, "core") } },
      project,
    ),
  ).rejects.toMatchObject({ code: "PARTITION_FRAMEWORK_UNTRUSTED" });
});
it("rejects traversal in framework filenames", async () => {
  await expect(
    resolveFrameworkPartitionCsv(
      "../custom.csv",
      [pkg],
      { core_dir: { value: path.join(root, "core") } },
      project,
    ),
  ).rejects.toMatchObject({ code: "PARTITION_FRAMEWORK_INVALID" });
});
