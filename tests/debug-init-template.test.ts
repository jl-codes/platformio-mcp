/** Template substitution preserves Core script structure while using retained ELF and endpoint inputs. */
import path from "node:path";
import { expect, it } from "vitest";
import {
  bindDebugInitializationTemplate,
  DEBUG_INIT_MARKERS,
} from "../src/core/debug/debug-init-template.js";
const selection = {
  elfPath: path.resolve("retained", "firmware.elf"),
  host: "127.0.0.1",
  port: 3333,
};
it("binds program, directory and endpoint while preserving target definitions", () => {
  const template = `define reset_board\nmonitor reset halt\nend\nfile ${DEBUG_INIT_MARKERS.elf}\ndirectory ${DEBUG_INIT_MARKERS.directory}\ntarget extended-remote ${DEBUG_INIT_MARKERS.endpoint}\nload\n`;
  const result = bindDebugInitializationTemplate(template, selection);
  expect(result).toContain("define reset_board\nmonitor reset halt\nend");
  expect(result).toContain("target extended-remote 127.0.0.1:3333");
  expect(result).toContain(
    process.platform === "win32"
      ? selection.elfPath.replace(/\\/g, "/")
      : selection.elfPath,
  );
  expect(result).not.toContain("__PIO_MCP_INIT_");
});
it("preserves explicit script text without inventing load commands", () => {
  const template = "monitor reset halt\ntbreak main\n";
  expect(bindDebugInitializationTemplate(template, selection)).toBe(template);
});
it("formats numeric IPv6 endpoints and rejects command-bearing host data", () => {
  expect(
    bindDebugInitializationTemplate(DEBUG_INIT_MARKERS.endpoint, {
      ...selection,
      host: "::1",
    }),
  ).toBe("[::1]:3333");
  expect(() =>
    bindDebugInitializationTemplate(DEBUG_INIT_MARKERS.endpoint, {
      ...selection,
      host: "127.0.0.1;halt",
    }),
  ).toThrow();
});
it("rejects unknown reserved markers and substitution growth beyond bounds", () => {
  expect(() =>
    bindDebugInitializationTemplate("__PIO_MCP_INIT_UNKNOWN__", selection),
  ).toThrow();
  expect(() =>
    bindDebugInitializationTemplate(DEBUG_INIT_MARKERS.elf.repeat(2000), {
      ...selection,
      elfPath: path.resolve("a".repeat(200), "firmware.elf"),
    }),
  ).toThrow();
});
