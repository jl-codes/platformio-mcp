/** OTA CLI preserves shared options and reads credentials without accepting plaintext arguments. */
import { expect, it } from "vitest";
import { parseOtaCli } from "../src/adapters/ota-cli.js";
import { policyActionForCliCommand } from "../src/core/action-catalog.js";
it("preserves explicit false controls and reads only the selected environment variable", () => {
  expect(
    parseOtaCli(
      {
        host: "192.0.2.8",
        build: "false",
        "verify-reachable": false,
        filesystem: true,
        port: "8266",
        timeout: "9",
        "auth-env": "OTA_PASSWORD",
      },
      [],
      "/project",
      { OTA_PASSWORD: "secret" },
    ),
  ).toMatchObject({
    project_dir: "/project",
    host: "192.0.2.8",
    auth: "secret",
    build: false,
    verify_reachable: false,
    filesystem: true,
    port: 8266,
    timeout_s: 9,
  });
  expect(policyActionForCliCommand("upload-ota")).toBe("upload_firmware");
});
it("keeps default build and reachability enabled without inventing credentials", () => {
  expect(
    parseOtaCli({ host: "board.local" }, [], "/project", {}),
  ).toMatchObject({
    build: true,
    verify_reachable: true,
    filesystem: false,
    timeout_s: 180,
  });
  expect(
    parseOtaCli({ host: "board.local" }, [], "/project", {}),
  ).not.toHaveProperty("auth");
});
it.each([
  { auth: "secret" },
  { "auth-env": "MISSING" },
  { "auth-env": true },
  { port: "NaN" },
  { timeout: "0" },
  { build: "maybe" },
  { "verify-reachable": "yes" },
  { unexpected: true },
  { "image-path": true },
  { approve: "maybe" },
])("rejects invalid options without echoing their values", (extra) => {
  expect(() =>
    parseOtaCli({ host: "board.local", ...extra }, [], "/project", {}),
  ).toThrow("Invalid upload-ota option or value.");
});
it("rejects positionals and requires a project and host", () => {
  expect(() => parseOtaCli({}, [], "/project")).toThrow();
  expect(() =>
    parseOtaCli({ host: "board.local" }, ["extra"], "/project"),
  ).toThrow();
  expect(() => parseOtaCli({ host: "board.local" }, [], undefined)).toThrow();
});
