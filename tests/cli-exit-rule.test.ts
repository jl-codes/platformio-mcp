import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { COMMANDS, OPERATION_COMMANDS, runCliCommand } from "../src/cli.js";

/**
 * The exit-code rule in runCliCommand, tested in-process. Without PlatformIO
 * no real operation RETURNS success:false (they throw first), so an e2e test
 * could only ever exercise the thrown-error path -- which is what the earlier
 * "exit code" test did, using target-resolve, proving nothing about the rule.
 */
describe("runCliCommand exit-code rule", () => {
  // runCliCommand evaluates policy BEFORE dispatch, and operationForCliCommand maps
  // an unknown command to its own name, so the fake keys must themselves be
  // actions the default policy allows. Neither is a real CLI key (the CLI
  // spells them with hyphens), so nothing real is shadowed.
  const FAKE_OP = "system_info";
  const FAKE_QUERY = "list_boards";
  let savedExitCode: number | string | undefined;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
    OPERATION_COMMANDS.add(FAKE_OP);
  });
  afterEach(() => {
    delete COMMANDS[FAKE_OP];
    delete COMMANDS[FAKE_QUERY];
    OPERATION_COMMANDS.delete(FAKE_OP);
    process.exitCode = savedExitCode;
  });

  it("an operation that ran but failed exits non-zero", async () => {
    COMMANDS[FAKE_OP] = async () => ({
      success: false,
      summary: "compiler errors",
    });
    await runCliCommand(FAKE_OP, ["--json"]);
    expect(process.exitCode).toBe(1);
  });

  it("an operation that succeeded exits zero", async () => {
    COMMANDS[FAKE_OP] = async () => ({ success: true });
    await runCliCommand(FAKE_OP, ["--json"]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("a query answering no is not a failure", async () => {
    // task-cancel on a finished task, monitor-health with nothing to assert.
    COMMANDS[FAKE_QUERY] = async () => ({
      success: false,
      status: "not_found",
    });
    await runCliCommand(FAKE_QUERY, ["--json"]);
    expect(process.exitCode ?? 0).toBe(0);
  });
});
