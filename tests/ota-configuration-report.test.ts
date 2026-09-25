/** Reference OTA configuration and protocol outcomes without network or device activity. */
import path from "node:path";
import { expect, it } from "vitest";
import { selectOtaConfiguration } from "../src/core/ota/ota-configuration.js";
import { summarizeOtaTransfer } from "../src/core/ota/ota-report.js";
function config(platform = "espressif32", extra: unknown[] = []) {
  return JSON.stringify([
    [
      "platformio",
      [
        ["default_envs", ["esp"]],
        ["build_dir", "custom-build"],
      ],
    ],
    ["env:esp", [["platform", platform], ...extra]],
  ]);
}
it("selects configured port/auth/filesystem and custom build directory", () => {
  const result = selectOtaConfiguration(
    config("espressif32", [
      ["upload_flags", ["--port=1234", "--auth=private"]],
      ["board_build.filesystem", "littlefs"],
    ]),
    process.cwd(),
  );
  expect(result).toMatchObject({
    family: "espressif32",
    configuredPort: 1234,
    auth: "private",
    filesystemImage: "littlefs.bin",
    buildDirectory: path.join(process.cwd(), "custom-build", "esp"),
  });
});
it("uses protocol family defaults and preserves extra flags for explicit handling", () => {
  expect(
    selectOtaConfiguration(
      config("espressif8266", [["upload_flags", ["--host_port=9999"]]]),
      process.cwd(),
    ),
  ).toMatchObject({ configuredPort: 8266, otherFlags: ["--host_port=9999"] });
});
it("rejects conflicting ports and unsupported families", () => {
  expect(() =>
    selectOtaConfiguration(
      config("espressif32", [["upload_flags", "--port=1 --port=2"]]),
      process.cwd(),
    ),
  ).toThrow();
  expect(() =>
    selectOtaConfiguration(config("ststm32"), process.cwd()),
  ).toThrow();
});
it("requires both a successful exit and protocol completion, never a runtime-health claim", () => {
  expect(
    summarizeOtaTransfer("Uploading: [=== ] 75%\n[INFO]: Success", 0),
  ).toMatchObject({ ok: true, progress_percent: 75, runtime_verified: false });
  expect(summarizeOtaTransfer("[INFO]: Success", 1).ok).toBe(false);
  expect(summarizeOtaTransfer("Uploading: [====] 100%", 0).ok).toBe(false);
});
it.each([
  ["Authentication Failed", "auth_failed"],
  ["No response from device", "no_callback"],
  ["Error Uploading", "transfer_failed"],
  ["Error response from device", "device_rejected"],
])("classifies %s as %s", (text, error) => {
  expect(summarizeOtaTransfer(text, 1)).toMatchObject({
    ok: false,
    error,
    runtime_verified: false,
  });
});
it("reports timeout even if an earlier success-looking marker exists", () => {
  expect(summarizeOtaTransfer("Result: OK", -1, true)).toMatchObject({
    ok: false,
    error: "timeout",
  });
});
