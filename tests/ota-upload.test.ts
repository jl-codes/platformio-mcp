/** OTA service composition uses real policy and private image capture with mocked builds/network transfer. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  reachability: vi.fn(),
  config: vi.fn(),
  build: vi.fn(),
  transfer: vi.fn(),
  tools: vi.fn(),
}));
vi.mock("../src/core/ota/ota-reachability.js", () => ({
  probeOtaReachability: mocks.reachability,
}));
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { execute: mocks.config },
}));
vi.mock("../src/tools/build.js", () => ({ buildTarget: mocks.build }));
vi.mock("../src/tools/projects.js", () => ({
  getSystemInfo: async () => ({}),
}));
vi.mock("../src/core/ota/ota-tools.js", () => ({
  resolveOtaTools: mocks.tools,
}));
vi.mock("../src/core/ota/ota-transfer.js", () => ({
  executePreparedOtaTransfer: mocks.transfer,
}));
vi.mock("../src/utils/lock-manager.js", () => ({
  hardwareLockManager: {
    withImplicitLock: async (execute: () => Promise<unknown>) => execute(),
  },
}));
vi.mock("../src/utils/command-log.js", () => ({
  retainCommandLog: async () => "private-log",
}));
import { executeOtaUpload } from "../src/tools/ota.js";
let root: string, project: string, image: string;
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-ota-upload-")),
  );
  project = path.join(root, "project");
  image = path.join(project, ".pio", "build", "esp", "firmware.bin");
  await fs.mkdir(path.dirname(image), { recursive: true });
  await fs.writeFile(image, "selected image");
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "operator"));
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "policy.json"));
  await fs.writeFile(
    path.join(root, "policy.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        deny: [],
        allow: [
          "get_project_config",
          "list_devices",
          "system_info",
          "build_project",
        ],
        approval_required: [],
        audit_all_agent_actions: false,
      },
    }),
  );
  vi.clearAllMocks();
  mocks.reachability.mockResolvedValue({
    reachable: null,
    status: "unavailable",
  });
  mocks.config.mockResolvedValue({
    exitCode: 0,
    stdout: JSON.stringify([["env:esp", [["platform", "espressif32"]]]]),
    stderr: "",
  });
  mocks.build.mockResolvedValue({ success: true });
  mocks.tools.mockResolvedValue({});
  mocks.transfer.mockImplementation(async (input) => {
    expect(await fs.readFile(input.image.path, "utf8")).toBe("selected image");
    return { exitCode: 0, stdout: "[INFO]: Success", stderr: "" };
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
// Real Windows ACL provisioning has a 15-second process deadline; retain it in this integration case.
it("builds without uploading, snapshots the selected image and reports transfer rather than runtime success", async () => {
  const result = await executeOtaUpload({
    projectDir: project,
    host: "192.0.2.8",
    auth: "private",
  });
  expect(mocks.build).toHaveBeenCalledWith(
    project,
    "buildprog",
    "esp",
    false,
    expect.objectContaining({ onResult: expect.any(Function) }),
  );
  expect(result).toMatchObject({
    ok: true,
    target_host: "192.0.2.8",
    port: 3232,
    runtime_verified: false,
    reachable: null,
    firmware_bytes: 14,
  });
  const snapshot = mocks.transfer.mock.calls[0][0].image.path;
  await expect(fs.access(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
  expect(JSON.stringify(result)).not.toContain('"private"');
}, process.platform === "win32" ? 20000 : 5000);
it("build=false transfers existing image without invoking a build", async () => {
  await executeOtaUpload({
    projectDir: project,
    host: "192.0.2.8",
    build: false,
  });
  expect(mocks.build).not.toHaveBeenCalled();
  expect(mocks.transfer).toHaveBeenCalledOnce();
});
it("does not transfer after a failed build", async () => {
  mocks.build.mockResolvedValueOnce({ success: false });
  expect(
    await executeOtaUpload({ projectDir: project, host: "192.0.2.8" }),
  ).toMatchObject({ ok: false, error: "build_failed" });
  expect(mocks.transfer).not.toHaveBeenCalled();
});
it("builds and selects the configured filesystem image", async () => {
  mocks.config.mockResolvedValueOnce({
    exitCode: 0,
    stdout: JSON.stringify([
      [
        "env:esp",
        [
          ["platform", "espressif32"],
          ["board_build.filesystem", "littlefs"],
        ],
      ],
    ]),
    stderr: "",
  });
  await fs.writeFile(
    path.join(path.dirname(image), "littlefs.bin"),
    "selected image",
  );
  expect(
    await executeOtaUpload({
      projectDir: project,
      host: "192.0.2.8",
      filesystem: true,
    }),
  ).toMatchObject({ ok: true, filesystem: true });
  expect(mocks.build).toHaveBeenCalledWith(
    project,
    "buildfs",
    "esp",
    false,
    expect.objectContaining({ onResult: expect.any(Function) }),
  );
  expect(mocks.transfer.mock.calls[0][0].filesystem).toBe(true);
});

it("rejects explicit ELF matching when image identity is absent before transferring", async () => {
  await expect(
    executeOtaUpload({
      projectDir: project,
      host: "192.0.2.8",
      build: false,
      elfPath: "firmware.elf",
    }),
  ).rejects.toMatchObject({ code: "OTA_ELF_IDENTITY_UNAVAILABLE" });
  expect(mocks.transfer).not.toHaveBeenCalled();
});
it("rejects a mismatched explicit ELF before transferring recognized firmware", async () => {
  const firmware = Buffer.alloc(304);
  firmware[0] = 0xe9;
  firmware[1] = 1;
  firmware.writeUInt32LE(256, 28);
  firmware.writeUInt32LE(0xabcd5432, 32);
  firmware.fill(0x12, 176, 208);
  let checksum = 0xef;
  for (const byte of firmware.subarray(32, 288)) checksum ^= byte;
  firmware[303] = checksum;
  await fs.writeFile(image, firmware);
  const elf = path.join(project, "firmware.elf");
  await fs.writeFile(elf, "wrong build");
  await expect(
    executeOtaUpload({
      projectDir: project,
      host: "192.0.2.8",
      build: false,
      elfPath: elf,
    }),
  ).rejects.toMatchObject({ code: "OTA_ELF_MISMATCH" });
  expect(mocks.transfer).not.toHaveBeenCalled();
});

it("reports build memory and errors and rejects failure markers before OTA", async () => {
  mocks.build.mockImplementationOnce(
    async (_project, _target, _env, _verbose, options) => {
      await options.onResult({
        exitCode: 0,
        fullLogPath: "build.log",
        finalOutput:
          "src/main.cpp:12:3: error: invalid private-token\nRAM: [= ] 10.0% (used 10 bytes from 100 bytes)\n========================= [FAILED] Took 1.00 seconds =========================",
      });
      return {
        success: true,
        output: "private-token",
        errors: ["private-token"],
      };
    },
  );
  const result = await executeOtaUpload({
    projectDir: project,
    host: "192.0.2.8",
    auth: "private-token",
  });
  expect(result).toMatchObject({
    ok: false,
    error: "build_failed",
    memory: { ram: { used_bytes: 10, total_bytes: 100 } },
    errors: [{ file: "src/main.cpp", line: 12, column: 3 }],
    log_path: "build.log",
  });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(mocks.transfer).not.toHaveBeenCalled();
});
it("preserves memory on successful OTA and bounds the uploader tail to forty lines", async () => {
  mocks.build.mockImplementationOnce(
    async (_project, _target, _env, _verbose, options) => {
      await options.onResult({
        exitCode: 0,
        fullLogPath: "build.log",
        finalOutput: "Flash: [== ] 20.0% (used 20 bytes from 100 bytes)",
      });
      return { success: true };
    },
  );
  mocks.transfer.mockResolvedValueOnce({
    exitCode: 0,
    stdout: "old-line\n".repeat(50) + "[INFO]: Success",
    stderr: "",
  });
  const result = await executeOtaUpload({
    projectDir: project,
    host: "192.0.2.8",
  });
  expect(result).toMatchObject({
    ok: true,
    memory: { flash: { used_bytes: 20, total_bytes: 100 } },
    errors: [],
  });
  expect(result.output_tail.split("\n")).toHaveLength(40);
});

it("preserves failed ICMP evidence while attempting the separately authorized OTA transfer", async () => {
  mocks.reachability.mockResolvedValue({
    reachable: false,
    status: "no_reply",
  });
  const result = await executeOtaUpload({
    projectDir: project,
    host: "192.0.2.8",
  });
  expect(mocks.reachability).toHaveBeenCalledWith("192.0.2.8");
  expect(result).toMatchObject({
    ok: true,
    reachability_status: "no_reply",
    reachable: false,
    runtime_verified: false,
  });
  expect(mocks.build).toHaveBeenCalledOnce();
  expect(mocks.transfer).toHaveBeenCalledOnce();
});
it("skips ICMP when explicitly disabled", async () => {
  const result = await executeOtaUpload({
    projectDir: project,
    host: "192.0.2.8",
    verifyReachable: false,
  });
  expect(mocks.reachability).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    ok: true,
    reachable: null,
    reachability_status: "not_requested",
  });
});
it("denied discovery cannot send an ICMP probe", async () => {
  await fs.writeFile(
    path.join(root, "policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { deny: ["list_devices"] },
    }),
  );
  await expect(
    executeOtaUpload({ projectDir: project, host: "192.0.2.8" }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(mocks.reachability).not.toHaveBeenCalled();
});
