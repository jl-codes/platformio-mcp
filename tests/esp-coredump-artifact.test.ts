/** Offline dump loading checks exact source identity and workspace boundaries. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readEspCoredumpArtifact } from "../src/core/analysis/esp-coredump-artifact.js";
const fixture = Buffer.from(
  "2400000003000000010000000400000000000000020000006669787475726521168fe1cf",
  "hex",
);
let directory: string;
let workspace: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "pio-dump-artifact-"));
  workspace = path.join(directory, "project");
  await fs.mkdir(workspace);
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});
it("separates encoded source identity from the validated raw envelope", async () => {
  const encoded = fixture.toString("base64") + "\r\n";
  await fs.writeFile(path.join(workspace, "dump.txt"), encoded);
  const hash = createHash("sha256").update(encoded).digest("hex");
  const result = await readEspCoredumpArtifact({
    workspaceDir: workspace,
    dumpPath: "dump.txt",
    format: "base64",
    expectedInputSha256: hash.toUpperCase(),
  });
  expect(result.bytes).toEqual(fixture);
  expect(result.source.sha256).toBe(hash);
  expect(result.identity.sha256).toBe(
    createHash("sha256").update(fixture).digest("hex"),
  );
  expect(result.source.sha256).not.toBe(result.identity.sha256);
});
it("rejects a changed selected input before decoding", async () => {
  await fs.writeFile(path.join(workspace, "dump.bin"), fixture);
  await expect(
    readEspCoredumpArtifact({
      workspaceDir: workspace,
      dumpPath: "dump.bin",
      format: "raw",
      expectedInputSha256: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "COREDUMP_IDENTITY_MISMATCH" });
});
it("rejects outside workspace inputs", async () => {
  await fs.writeFile(path.join(directory, "dump.bin"), fixture);
  await expect(
    readEspCoredumpArtifact({
      workspaceDir: workspace,
      dumpPath: "../dump.bin",
      format: "raw",
    }),
  ).rejects.toMatchObject({ code: "PARTITION_ARTIFACT_OUTSIDE_WORKSPACE" });
});
it("rejects malformed UTF-8 rather than replacing bytes during decoding", async () => {
  await fs.writeFile(path.join(workspace, "dump.txt"), Buffer.from([255]));
  await expect(
    readEspCoredumpArtifact({
      workspaceDir: workspace,
      dumpPath: "dump.txt",
      format: "base64",
    }),
  ).rejects.toMatchObject({ code: "COREDUMP_BASE64_INVALID" });
});
