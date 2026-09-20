/** Real OTA policy planning with synthetic transfer and lease capabilities; never contacts hardware. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { approveRequest, getApproval } from "../src/core/policy/approvals.js";
import { PlatformIOError } from "../src/utils/errors.js";
const mocks = vi.hoisted(() => ({ run: vi.fn(), acquire: vi.fn() }));
vi.mock("../src/core/ota/espota-process.js", () => ({
  runEspotaProcess: mocks.run,
}));
vi.mock("../src/core/devices/ota-target.js", () => ({
  acquireOtaCustody: mocks.acquire,
}));
import {
  executePreparedOtaTransfer,
  type PreparedOtaTransfer,
} from "../src/core/ota/ota-transfer.js";
let root: string, project: string;
beforeEach(() => {
  root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "pio-ota-transfer-"),
  );
  project = path.join(root, "project");
  fs.mkdirSync(project);
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "operator"));
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "policy.json"));
  policy();
  vi.clearAllMocks();
  mocks.run.mockResolvedValue({
    exitCode: 0,
    stdout: "[INFO]: Success",
    stderr: "",
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function policy(extra = {}) {
  fs.writeFileSync(
    path.join(root, "policy.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "upload_filesystem", "run_shell_command"],
        deny: [],
        approval_required: [],
        audit_all_agent_actions: false,
        ...extra,
      },
    }),
  );
}
function fixture() {
  const custody = { prepareSpawn: vi.fn(), releaseAfterExit: vi.fn() };
  mocks.acquire.mockReturnValue(custody);
  const input: PreparedOtaTransfer = {
    projectDir: project,
    environment: "esp",
    target: {
      host: "board.local",
      address: "192.0.2.8",
      port: 3232,
      resource: { kind: "network", identity: '["ota","192.0.2.8"]' },
    },
    tools: {
      pythonExecutable: process.execPath,
      uploaderScript: path.join(root, "espota.py"),
      uploaderSha256: "b".repeat(64),
      packageName: "framework-arduinoespressif32",
      packageVersion: "1.2.3",
    },
    image: {
      path: path.join(root, "private.bin"),
      identity: {
        path: path.join(root, "private.bin"),
        sourcePath: path.join(project, "firmware.bin"),
        size: 4,
        sha256: "a".repeat(64),
      },
      verify: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    },
    filesystem: false,
    timeoutMs: 1000,
    auth: "private-credential",
  };
  return { input, custody };
}
async function challenge(input: PreparedOtaTransfer) {
  try {
    await executePreparedOtaTransfer(input);
    throw new Error("Expected approval");
  } catch (error) {
    expect(error).toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(JSON.stringify(error)).not.toContain("private-credential");
    return (error as PlatformIOError).context!.policyDecision as {
      approvalId: string;
    };
  }
}
it("requires both grants before transfer and binds approval to image identity without storing the password", async () => {
  const f = fixture();
  policy({
    approval_required: ["ota_upload_firmware", "ota_uploader_command"],
  });
  const upload = await challenge(f.input);
  approveRequest(upload.approvalId);
  f.input.approvalId = upload.approvalId;
  const command = await challenge(f.input);
  expect(getApproval(upload.approvalId)?.status).toBe("approved");
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.acquire).not.toHaveBeenCalled();
  approveRequest(command.approvalId);
  f.input.commandApprovalId = command.approvalId;
  expect(JSON.stringify(getApproval(command.approvalId))).not.toContain(
    "private-credential",
  );
  expect(await executePreparedOtaTransfer(f.input)).toMatchObject({
    exitCode: 0,
    runtimeVerified: false,
    imageSha256: "a".repeat(64),
  });
  expect(getApproval(upload.approvalId)?.status).toBe("consumed");
  expect(getApproval(command.approvalId)?.status).toBe("consumed");
  expect(mocks.run.mock.calls[0][0]).toMatchObject({
    address: "192.0.2.8",
    auth: "private-credential",
    imageSha256: "a".repeat(64),
  });
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("keeps filesystem writes under their separate permission", async () => {
  const f = fixture();
  f.input.filesystem = true;
  policy({ deny: ["upload_filesystem"] });
  await expect(executePreparedOtaTransfer(f.input)).rejects.toMatchObject({
    code: "POLICY_DENIED",
  });
  expect(mocks.run).not.toHaveBeenCalled();
});
it("does not release uncertain process custody", async () => {
  const f = fixture();
  mocks.run.mockRejectedValueOnce(
    new PlatformIOError("pending", "OTA_CLEANUP_PENDING", {
      cleanupPending: true,
    }),
  );
  await expect(executePreparedOtaTransfer(f.input)).rejects.toMatchObject({
    code: "OTA_CLEANUP_PENDING",
  });
  expect(f.custody.releaseAfterExit).not.toHaveBeenCalled();
  expect(f.input.image.release).not.toHaveBeenCalled();
});
it("rejects changed snapshot bytes before acquiring a network lease", async () => {
  const f = fixture();
  vi.mocked(f.input.image.verify).mockRejectedValueOnce(
    new PlatformIOError("changed", "OTA_IMAGE_CHANGED"),
  );
  await expect(executePreparedOtaTransfer(f.input)).rejects.toMatchObject({
    code: "OTA_IMAGE_CHANGED",
  });
  expect(mocks.acquire).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
