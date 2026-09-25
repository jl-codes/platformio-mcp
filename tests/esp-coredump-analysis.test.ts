/** Real snapshot checks with archive persistence isolated from the user's retained artifacts. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/core/analysis/elf-archive.js", () => ({
  retainElfSnapshot: vi.fn(async () => "test-archive"),
}));
import { withEspCoredumpArtifacts } from "../src/core/analysis/esp-coredump-analysis.js";
let root: string;
const dump = Buffer.from(
  "2400000003000000010000000400000000000000020000006669787475726521168fe1cf",
  "hex",
);
function elf(machine = 94) {
  const bytes = Buffer.alloc(128);
  Buffer.from("7f454c46010101", "hex").copy(bytes);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(machine, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt16LE(52, 40);
  return bytes;
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-coredump-pair-"));
  await fs.writeFile(path.join(root, "dump.bin"), dump);
  await fs.writeFile(path.join(root, "firmware.elf"), elf());
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
function input() {
  return {
    workspaceDir: root,
    dumpPath: "dump.bin",
    format: "raw" as const,
    elfPath: "firmware.elf",
    validatePolicy: vi.fn(),
  };
}
it("keeps selected ELF stable across a rebuild and cleans the transient snapshot", async () => {
  let snapshot = "";
  const params = input();
  const result = await withEspCoredumpArtifacts(params, async (artifacts) => {
    snapshot = artifacts.elfPath;
    const changed = elf();
    changed[100] = 1;
    await fs.writeFile(path.join(root, "firmware.elf"), changed);
    expect(await fs.readFile(snapshot)).toEqual(elf());
    expect(artifacts.dump.bytes).toEqual(dump);
    return artifacts.correspondence;
  });
  expect(result).toEqual({ status: "unavailable", hashBits: 0 });
  expect(params.validatePolicy).toHaveBeenCalledTimes(4);
  await expect(fs.stat(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
});
it("rejects wrong targets before invoking analysis", async () => {
  await fs.writeFile(path.join(root, "firmware.elf"), elf(243));
  const analyze = vi.fn();
  await expect(
    withEspCoredumpArtifacts(input(), analyze),
  ).rejects.toMatchObject({ code: "COREDUMP_ELF_TARGET_MISMATCH" });
  expect(analyze).not.toHaveBeenCalled();
});
it("cleans the snapshot when analysis fails", async () => {
  let snapshot = "";
  await expect(
    withEspCoredumpArtifacts(input(), async (artifacts) => {
      snapshot = artifacts.elfPath;
      throw new Error("analyzer failed");
    }),
  ).rejects.toThrow("analyzer failed");
  await expect(fs.stat(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
});
it("honors revoked permission before any artifact reads", async () => {
  const params = input();
  params.validatePolicy.mockImplementation(() => {
    throw new Error("revoked");
  });
  await expect(withEspCoredumpArtifacts(params, vi.fn())).rejects.toThrow(
    "revoked",
  );
});
it("analyzes an internal capture without requiring or creating a project dump file", async () => {
  await fs.unlink(path.join(root, "dump.bin"));
  const capture = Buffer.concat([dump, Buffer.alloc(128, 255)]);
  await withEspCoredumpArtifacts(
    input(),
    async (artifacts) => {
      expect(artifacts.dump.source.path).toBeNull();
      expect(artifacts.dump.source.size).toBe(capture.length);
      expect(artifacts.dump.identity.trailing_bytes).toBe(128);
      expect(artifacts.dump.bytes).toEqual(dump);
    },
    capture,
  );
  await expect(fs.stat(path.join(root, "dump.bin"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("rejects a mismatching captured identity before invoking analysis", async () => {
  const analyze = vi.fn();
  await expect(
    withEspCoredumpArtifacts(
      { ...input(), expectedInputSha256: "0".repeat(64) },
      analyze,
      dump,
    ),
  ).rejects.toMatchObject({ code: "COREDUMP_IDENTITY_MISMATCH" });
  expect(analyze).not.toHaveBeenCalled();
});
