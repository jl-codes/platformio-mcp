/** Final esptool operands preserve platform flags and exact path boundaries without shell interpretation. */
import { expect, it } from "vitest";
import {
  parseEspUploadImageOperands,
  substituteEspUploadImages,
} from "../src/core/analysis/esptool-upload-inputs.js";
const argv = [
  "python",
  "esptool.py",
  "--chip",
  "esp32",
  "--port",
  "COM42",
  "write_flash",
  "-z",
  "--flash_mode",
  "dio",
  "--flash_freq=40m",
  "--flash_size",
  "detect",
  "0x1000",
  "C:\\build dir\\boot.bin",
  "0x10000",
  "/build/app $name.bin",
];
it("identifies all binary offsets and preserves argument boundaries", () => {
  expect(parseEspUploadImageOperands(argv)).toEqual([
    { offset: 0x1000, path: argv[14], argumentIndex: 14 },
    { offset: 0x10000, path: argv[16], argumentIndex: 16 },
  ]);
  const replaced = substituteEspUploadImages(argv, [
    {
      argumentIndex: 14,
      originalPath: argv[14],
      retainedPath: "/archive/boot.bin",
    },
    {
      argumentIndex: 16,
      originalPath: argv[16],
      retainedPath: "/archive/app.bin",
    },
  ]);
  expect(replaced.filter((_, index) => index !== 14 && index !== 16)).toEqual(
    argv.filter((_, index) => index !== 14 && index !== 16),
  );
  expect(argv[16]).toBe("/build/app $name.bin");
});
it.each([
  ["write_flash", "--encrypt", "0", "app.bin"],
  ["write_flash", "--erase-all", "0", "app.bin"],
  ["write_flash", "--unknown", "0", "app.bin"],
  ["write_flash", "--flash_size"],
  ["write_flash", "0"],
  ["write_flash", "0x100000000", "app.bin"],
  ["write_flash", "0", "a.bin", "0", "b.bin"],
  ["write_flash", "write-flash", "0", "app.bin"],
])("rejects unsupported or ambiguous input %j", (...args) =>
  expect(() => parseEspUploadImageOperands(args)).toThrow(),
);
it("rejects missing, duplicate or stale retained operand mappings", () => {
  expect(() => substituteEspUploadImages(argv, [])).toThrow();
  expect(() =>
    substituteEspUploadImages(argv, [
      { argumentIndex: 14, originalPath: "wrong", retainedPath: "retained" },
      { argumentIndex: 16, originalPath: argv[16], retainedPath: "retained" },
    ]),
  ).toThrow();
});
it("accepts modern spelling, decimal offsets and explicit end of options", () => {
  expect(
    parseEspUploadImageOperands([
      "esptool",
      "write-flash",
      "--",
      "65536",
      "-image.bin",
    ]),
  ).toEqual([{ offset: 65536, path: "-image.bin", argumentIndex: 4 }]);
});
