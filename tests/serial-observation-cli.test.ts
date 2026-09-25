/** CLI telemetry inputs retain shared bounds and explicit units before device work. */
import { expect, it } from "vitest";
import { parseSerialObservationCli } from "../src/adapters/serial-observation-cli.js";
it("translates bounded capture options", () => {
  expect(
    parseSerialObservationCli(
      "monitor-capture",
      { port: "COM7", baud: "115200", seconds: "3", until: "BOOT" },
      [],
      "/project",
    ),
  ).toMatchObject({ port: "COM7", baud: 115200, seconds: 3, until: "BOOT" });
});
it("requires an explicit word size for word-valued stacks", () => {
  expect(() =>
    parseSerialObservationCli(
      "memory-watch",
      { "stack-unit": "words" },
      [],
      "/project",
    ),
  ).toThrow();
  expect(
    parseSerialObservationCli(
      "memory-watch",
      { "stack-unit": "words", "stack-word-bytes": "4" },
      [],
      "/project",
    ),
  ).toMatchObject({ stack_unit: "words", stack_word_bytes: 4, seconds: 15 });
});
it("rejects cross-connection selectors, bad numbers, and unknown options", () => {
  for (const options of [
    { "session-id": "foreign" },
    { baud: "NaN" },
    { "max-lines": "10001" },
    { executable: "unsafe" },
  ])
    expect(() =>
      parseSerialObservationCli("monitor-capture", options, [], "/project"),
    ).toThrow();
});

it("port diagnosis accepts selection only, never capture or device-write options", () => {
  expect(
    parseSerialObservationCli(
      "port-diagnose",
      { port: "COM7" },
      [],
      "/project",
    ),
  ).toEqual({ project_dir: "/project", port: "COM7" });
  for (const options of [
    { baud: "115200" },
    { seconds: "10" },
    { data: "RESET" },
    { "session-id": "foreign" },
  ])
    expect(() =>
      parseSerialObservationCli("port-diagnose", options, [], "/project"),
    ).toThrow();
});
