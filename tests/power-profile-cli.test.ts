/** CLI power parameters preserve shared validation and reject invalid electrical inputs before effects. */
import { expect, it } from "vitest";
import { parsePowerProfileCli } from "../src/adapters/power-profile-cli.js";
import { policyActionForCliCommand } from "../src/core/action-catalog.js";
it("maps serial values without changing provenance or sample bounds", () => {
  expect(
    parsePowerProfileCli(
      {
        port: "COM7",
        seconds: "5",
        "sleep-threshold-ma": "-1",
        "read-approval-id": "read",
      },
      [],
      "/project",
    ),
  ).toMatchObject({
    source: "serial",
    port: "COM7",
    seconds: 5,
    sleep_threshold_ma: -1,
    read_approval_id: "read",
    provenance: "unspecified_serial",
  });
  expect(policyActionForCliCommand("power-profile")).toBe("start_monitor");
});
it("supports automatic PPK2 selection while requiring electrical limits and DUT", () => {
  expect(
    parsePowerProfileCli(
      {
        source: "ppk2",
        mode: "source",
        "dut-port": "COM7",
        "voltage-mv": "3300",
        "current-limit-ma": "50",
        approve: true,
      },
      [],
      "/project",
    ),
  ).toMatchObject({
    source: "ppk2",
    mode: "source",
    voltage_mv: 3300,
    current_limit_ma: 50,
  });
});
it.each([
  { source: "ppk2" },
  { seconds: true },
  { seconds: "NaN" },
  { seconds: "" },
  { wat: "x" },
  { approve: "maybe" },
  { "read-approval-id": true },
  { "project-dir": true },
  {
    source: "ppk2",
    mode: "source",
    "dut-port": "COM7",
    "voltage-mv": "3300",
    "current-limit-ma": "601",
  },
])("rejects invalid parameters before execution: %j", (options) => {
  expect(() => parsePowerProfileCli(options, [], "/project")).toThrow(
    expect.objectContaining({ code: "POWER_PROFILE_INPUT_INVALID" }),
  );
});
