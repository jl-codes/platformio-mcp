import { describe, it, expect } from "vitest";
import { toCliStructuredError } from "../src/core/cli-diagnostics.js";
import {
  PortBusyError,
  ClaimIoError,
  ClaimError,
} from "../src/utils/semaphore.js";
import { PlatformIOError } from "../src/utils/errors.js";

describe("toCliStructuredError - claim errors", () => {
  it("reports PortBusyError as PortBusy and not safe to auto-retry", () => {
    const error = new PortBusyError("COM1", {
      type: "upload",
      owner_workspace: "/tmp/other",
      owner_pid: 4242,
      hostname: "h",
      timestamp: Date.now(),
    });

    const result = toCliStructuredError(error);

    expect(result.errorType).toBe("PortBusy");
    expect(result.safeToAutoRetry).toBe(false);
  });

  it("reports ClaimIoError as ClaimIoError and not safe to auto-retry", () => {
    const error = new ClaimIoError(
      "link",
      "/tmp/x.json",
      Object.assign(new Error("no space"), { code: "ENOSPC" }),
    );

    const result = toCliStructuredError(error);

    expect(result.errorType).toBe("ClaimIoError");
    expect(result.safeToAutoRetry).toBe(false);
  });

  it("reports a CLAIM_ACCESS_DENIED ClaimError as ClaimAccessDenied", () => {
    const error = new ClaimError(
      "Port claim file exists but cannot be read",
      "CLAIM_ACCESS_DENIED",
      { port: "COM1", filePath: "/tmp/x.json", errno: "EACCES" },
    );

    const result = toCliStructuredError(error);

    expect(result.errorType).toBe("ClaimAccessDenied");
    expect(result.safeToAutoRetry).toBe(false);
  });
});

describe("CLI argument errors", () => {
  it("maps MISSING_ARGUMENT to a PascalCase errorType with a useful action", () => {
    const result = toCliStructuredError(
      new PlatformIOError(
        "board-info requires --board <id>",
        "MISSING_ARGUMENT",
        {
          argument: "board",
        },
      ),
      { stage: "boards" },
    );
    expect(result.errorType).toBe("MissingArgument");
    expect(result.recommendedAction).toContain("--help");
    expect(result.safeToAutoRetry).toBe(false);
  });

  it("maps UNKNOWN_SUBCOMMAND to a PascalCase errorType", () => {
    const result = toCliStructuredError(
      new PlatformIOError(
        "Unknown lib subcommand: bogus.",
        "UNKNOWN_SUBCOMMAND",
        {
          subcommand: "bogus",
        },
      ),
      { stage: "lib" },
    );
    expect(result.errorType).toBe("UnknownSubcommand");
  });

  it("maps INVALID_ARGUMENT to a PascalCase errorType", () => {
    const result = toCliStructuredError(
      new PlatformIOError(
        '--lines must be a number, received "abc"',
        "INVALID_ARGUMENT",
        {
          argument: "lines",
        },
      ),
      { stage: "logs" },
    );
    expect(result.errorType).toBe("InvalidArgument");
  });
});

describe("hardware and library error codes", () => {
  // These reach agents from the flash and library paths. Before being mapped
  // they arrived as SCREAMING_SNAKE while every other errorType is PascalCase,
  // so an agent matching on the field had to handle both shapes.
  it.each([
    ["TARGET_UNAVAILABLE", "TargetUnavailable"],
    ["STALE_TARGET_BINDING", "StaleTargetBinding"],
    ["LIBRARY_ERROR", "LibraryError"],
    ["QUEUE_ENFORCEMENT_FAILED", "QueueEnforcementFailed"],
    ["AMBIGUOUS_TARGET", "AmbiguousTarget"],
    ["AMBIGUOUS_TASK", "AmbiguousTask"],
    ["LIST_DEVICES_FAILED", "ListDevicesFailed"],
    ["APPROVAL_NOT_FOUND", "ApprovalNotFound"],
  ])("maps %s to %s with a specific recommendedAction", (code, expected) => {
    // The second argument is an options object. A bare string here left stage
    // "unknown", which made the stage-dependent fallback unreachable and the
    // old negative assertion unfailable. Tests are not type-checked, so
    // nothing flagged it.
    const result = toCliStructuredError(new PlatformIOError("boom", code, {}), {
      stage: "upload",
    });
    expect(result.errorType).toBe(expected);
    expect(result.stage).toBe("upload");
    // A positive match on a fragment unique to each mapped action.
    const fragment: Record<string, string> = {
      TargetUnavailable: "pio-agent devices",
      StaleTargetBinding: "target-resolve",
      LibraryError: "owner/name",
      QueueEnforcementFailed: "pipeline lock",
      AmbiguousTarget: "--port",
      AmbiguousTask: "task-history",
      ListDevicesFailed: "system-info",
      ApprovalNotFound: "pending-approvals",
    };
    expect(result.recommendedAction).toContain(fragment[expected]);
    expect(result.safeToAutoRetry).toBe(false);
  });
});
