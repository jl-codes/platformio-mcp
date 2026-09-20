/** Verify debugger command effects and real policy denial before transport writes. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  prepareDebugCommand,
  dispatchDebuggerCommand,
} from "../src/core/debug/debug-command.js";

let project: string;
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "pio-debug-policy-"));
  fs.writeFileSync(
    path.join(project, "platformio.ini"),
    "[env:native]\nplatform=native\n",
  );
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      overrides: { audit_all_agent_actions: false },
    }),
  );
});
afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

it.each([
  ["bt", "-stack-list-frames", "inspect", false],
  [
    "print object.member[2]",
    '-data-evaluate-expression "object.member[2]"',
    "inspect",
    false,
  ],
  ["continue", "-exec-continue", "target", true],
  ["-exec-interrupt", "-exec-interrupt", "target", true],
  ["break main", '-break-insert -- "main"', "target", false],
  ["tbreak main", '-break-insert -t -- "main"', "target", false],
  ["monitor init", '-interpreter-exec console "monitor init"', "target", false],
  ["watch counter", '-break-watch "counter"', "target", false],
  ["quit", "-gdb-exit", "target", false],
  ["detach", "-target-detach", "target", false],
  [
    "shell echo hello",
    '-interpreter-exec console "shell echo hello"',
    "host-code",
    false,
  ],
])("classifies and frames %s", (command, miCommand, effect, waitForStop) => {
  const prepared = prepareDebugCommand(command as string);
  expect(prepared).toEqual({ miCommand, effect, waitForStop });
  expect(Object.isFrozen(prepared)).toBe(true);
});

it.each([
  "print reset()",
  "print counter=1",
  "print ++counter",
  "bt\nshell echo bad",
  "bt\rshell echo bad",
  '-interpreter-exec console "shell echo bad"',
  '-data-evaluate-expression "reset()"',
  "x/4097xb address",
  "break -t main",
  "watch reset()",
  "set variable counter = reset()",
  "toString",
  "constructor",
])("rejects unsupported or injected command %s", (command) => {
  expect(() => prepareDebugCommand(command)).toThrowError(
    expect.objectContaining({ code: "DEBUG_COMMAND_UNSUPPORTED" }),
  );
});

it.each([
  "continue",
  "break main",
  "watch counter",
  "set counter = 1",
  "quit",
  "detach",
  "monitor reset halt",
  "python print(1)",
  "source commands.gdb",
  "shell echo hello",
])("read_only denies %s before writing to GDB", async (command) => {
  const send = vi.fn();
  await expect(
    dispatchDebuggerCommand(
      command,
      { projectDir: project },
      { workspaceDir: project },
      send,
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(send).not.toHaveBeenCalled();
});

it("binds actual inspection text despite conflicting caller arguments", async () => {
  const send = vi.fn(async (prepared) => prepared.miCommand);
  await expect(
    dispatchDebuggerCommand(
      "bt",
      {
        projectDir: project,
        command: "shell echo bad",
        miCommand: "-gdb-exit",
      },
      { workspaceDir: project },
      send,
    ),
  ).resolves.toBe("-stack-list-frames");
  expect(send).toHaveBeenCalledOnce();
});

it("honors a concrete denial even when the inspection category is allowed", async () => {
  fs.writeFileSync(
    path.join(project, ".pio-mcp-policy.json"),
    JSON.stringify({
      profile: "read_only",
      deny: ["debugger_inspect"],
      overrides: { audit_all_agent_actions: false },
    }),
  );
  const send = vi.fn();
  await expect(
    dispatchDebuggerCommand(
      "bt",
      { projectDir: project },
      { workspaceDir: project },
      send,
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(send).not.toHaveBeenCalled();
});
