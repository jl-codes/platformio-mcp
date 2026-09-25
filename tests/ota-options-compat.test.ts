/** OTA option mappings and public argument translation cannot override the authorized image or destination. */
import { beforeEach, expect, it, vi } from "vitest";
const upload = vi.hoisted(() => vi.fn());
vi.mock("../src/tools/ota.js", () => ({ executeOtaUpload: upload }));
vi.mock("../src/adapters/compatibility-project.js", () => ({
  resolveCompatibilityProject: async () => "project",
}));
import { parseOtaUploaderOptions } from "../src/core/ota/ota-options.js";
import { executeOtaCompatibility } from "../src/adapters/ota-compat.js";
beforeEach(() => {
  upload.mockReset();
  upload.mockResolvedValue({ ok: true, runtime_verified: false });
});
it("maps interface, callback port and invitation timeout without arbitrary argv", () => {
  expect(
    parseOtaUploaderOptions(
      [
        "-I",
        "192.0.2.1",
        "--host_port=1234",
        "-t",
        "5",
        "--progress",
        "--debug",
      ],
      false,
    ),
  ).toEqual({
    hostAddress: "192.0.2.1",
    hostPort: 1234,
    invitationTimeoutSeconds: 5,
  });
});
it.each([
  ["--ip=192.0.2.9"],
  ["--file=other.bin"],
  ["--host_ip=host.local"],
  ["--host_port=0"],
  ["-t", "999"],
  ["--spiffs"],
])("rejects unbound or conflicting uploader flags %s", (flags) => {
  expect(() => parseOtaUploaderOptions(flags, false)).toThrow();
});
it("maps reference defaults, nullable fields, and separately scoped approvals", async () => {
  const result = await executeOtaCompatibility({
    host: " board.local ",
    env: null,
    port: null,
    auth: "private",
    build_approval_id: "build",
    approval_id: "upload",
    command_approval_id: "command",
  });
  expect(upload.mock.calls[0][0]).toMatchObject({
    projectDir: "project",
    host: "board.local",
    auth: "private",
    filesystem: false,
    build: true,
    timeoutSeconds: 180,
    verifyReachable: true,
    buildApprovalId: "build",
    approvalId: "upload",
    commandApprovalId: "command",
  });
  expect(result).toMatchObject({ runtime_verified: false });
});
it("rejects arbitrary execution fields before entering the service", async () => {
  await expect(
    executeOtaCompatibility({ host: "board.local", python: "unsafe" }),
  ).rejects.toMatchObject({ code: "COMPAT_ARGUMENT_INVALID" });
  expect(upload).not.toHaveBeenCalled();
});
