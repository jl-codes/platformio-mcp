/** Flash reads must authorize before spawn and bind the exact range and serial custody. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { approveRequest } from "../src/core/policy/approvals.js";
import { readEspFlash } from "../src/core/esp-flash-read.js";
import { executeWithSpooling } from "../src/utils/spooler.js";
vi.mock("../src/utils/spooler.js", () => ({ executeWithSpooling: vi.fn() }));
vi.mock("../src/utils/lock-manager.js", () => ({
  hardwareLockManager: {
    withImplicitLock: (run: () => Promise<unknown>) => run(),
  },
}));
vi.mock("../src/core/devices/serial-endpoint.js", () => ({
  resolveSerialEndpoint: (port: string) => ({
    canonicalPort: port,
    revalidate: () => {},
  }),
}));
let root: string;
let state: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-read-flash-project-"));
  state = fs.mkdtempSync(path.join(os.tmpdir(), "pio-read-flash-state-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", state);
  vi.mocked(executeWithSpooling).mockReset();
  fs.writeFileSync(
    path.join(root, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});
function permit() {
  const operatorPolicy = path.join(state, "operator.json");
  vi.stubEnv("PIO_MCP_POLICY_FILE", operatorPolicy);
  fs.unlinkSync(path.join(root, ".pio-mcp-policy.json"));
  fs.writeFileSync(
    operatorPolicy,
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "run_shell_command"],
        deny: [],
        approval_required: [],
        audit_all_agent_actions: false,
        require_device_lock_for_upload: false,
      },
    }),
  );
}
it("denies device reads before a process is started", async () => {
  await expect(
    readEspFlash({
      projectDir: root,
      port: "COM9",
      offset: 0x10000,
      length: 4096,
    }),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(executeWithSpooling).not.toHaveBeenCalled();
});
it("binds argv and custody to the requested port and exact flash range", async () => {
  permit();
  let output = "";
  vi.mocked(executeWithSpooling).mockImplementation(async (_command, args) => {
    output = args.at(-1)!;
    fs.writeFileSync(output, Buffer.alloc(4096, 255));
    return { exitCode: 0, finalOutput: "ok", fullLogPath: "read.log" };
  });
  const result = await readEspFlash({
    projectDir: root,
    port: "COM9",
    offset: 0x10000,
    length: 4096,
  });
  expect(result.bytes).toHaveLength(4096);
  expect(result).toMatchObject({
    port: "COM9",
    offset: 0x10000,
    length: 4096,
    logPath: "read.log",
  });
  expect(executeWithSpooling).toHaveBeenCalledWith(
    "pkg",
    expect.arrayContaining([
      "--port",
      "COM9",
      "read_flash",
      "0x10000",
      "0x1000",
    ]),
    expect.objectContaining({ devicePort: "COM9", background: false }),
  );
  expect(fs.existsSync(output)).toBe(false);
});
it("rejects incomplete read output", async () => {
  permit();
  vi.mocked(executeWithSpooling).mockImplementation(async (_command, args) => {
    fs.writeFileSync(args.at(-1)!, Buffer.alloc(32));
    return { exitCode: 0, finalOutput: "ok", fullLogPath: "read.log" };
  });
  await expect(
    readEspFlash({
      projectDir: root,
      port: "COM9",
      offset: 0x10000,
      length: 4096,
    }),
  ).rejects.toMatchObject({ code: "FLASH_READ_INCOMPLETE" });
});

it("preserves the first grant while waiting for the second, without implicit installation", async () => {
  permit();
  const policyPath = path.join(state, "operator.json");
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  policy.overrides.approval_required = ["upload_firmware", "run_shell_command"];
  fs.writeFileSync(policyPath, JSON.stringify(policy));
  const request = {
    projectDir: root,
    port: "COM9",
    offset: 0x10000,
    length: 4096,
  };
  const first = await readEspFlash(request).catch((error) => error);
  expect(first.code).toBe("APPROVAL_REQUIRED");
  const approvalId = first.context.policyDecision.approvalId;
  approveRequest(approvalId);
  const second = await readEspFlash({ ...request, approvalId }).catch(
    (error) => error,
  );
  expect(second.code).toBe("APPROVAL_REQUIRED");
  const commandApprovalId = second.context.policyDecision.approvalId;
  approveRequest(commandApprovalId);
  vi.mocked(executeWithSpooling).mockImplementation(async (_command, args) => {
    expect(args).not.toContain("--package");
    fs.writeFileSync(args.at(-1)!, Buffer.alloc(4096, 255));
    return { exitCode: 0, finalOutput: "ok", fullLogPath: "read.log" };
  });
  await expect(
    readEspFlash({ ...request, approvalId, commandApprovalId }),
  ).resolves.toMatchObject({ length: 4096 });
  expect(executeWithSpooling).toHaveBeenCalledOnce();
});
