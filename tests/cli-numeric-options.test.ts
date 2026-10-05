/** Numeric handler validation must fail before starting work or reading operational stores. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandHandler, OptionValue } from "../src/cli/commands/types.js";

const effects = vi.hoisted(() => ({
  build: vi.fn(),
  monitor: vi.fn(),
  wait: vi.fn(),
  health: vi.fn(),
  resolve: vi.fn(),
  verify: vi.fn(),
  approvals: vi.fn(),
  pending: vi.fn(),
  history: vi.fn(),
}));

vi.mock("../src/core/build.js", () => ({ buildProjectCore: effects.build }));
vi.mock("../src/core/monitor.js", () => ({
  startMonitorCore: effects.monitor,
  waitForExpectedSerialOutput: effects.wait,
}));
vi.mock("../src/tools/monitor.js", () => ({
  getMonitorStatus: vi.fn(),
  stopMonitor: vi.fn(),
}));
vi.mock("../src/core/target-resolution.js", () => ({
  resolveTarget: effects.resolve,
}));
vi.mock("../src/tools/agent.js", () => ({
  agentBuildDiagnose: vi.fn(),
  agentFlashMonitorVerify: effects.verify,
  agentGenerateBoardReport: vi.fn(),
  agentGetLastReport: vi.fn(),
  agentMonitorHealth: effects.health,
  agentSafePinAudit: vi.fn(),
  agentValidateProject: vi.fn(),
}));
vi.mock("../src/core/policy/status.js", () => ({ getPolicyStatus: vi.fn() }));
vi.mock("../src/core/policy/approvals.js", () => ({
  approveRequest: vi.fn(),
  denyRequest: vi.fn(),
  getApproval: vi.fn(),
  getApprovalRequestSummary: vi.fn(),
  listApprovalRequests: effects.approvals,
  listPendingApprovalSummaries: effects.pending,
}));
vi.mock("../src/core/tasks.js", () => ({
  checkTaskStatusSummaryCore: vi.fn(),
  listTaskHistoryCore: effects.history,
  cancelTaskCore: vi.fn(),
}));

import { build } from "../src/cli/commands/build.js";
import { monitor, monitorHealth } from "../src/cli/commands/monitor.js";
import {
  agentFlashMonitorVerifyCmd,
  targetResolve,
} from "../src/cli/commands/agent.js";
import { approvals, pendingApprovals } from "../src/cli/commands/policy.js";
import { taskHistory } from "../src/cli/commands/task.js";

beforeEach(() => vi.clearAllMocks());

const handlers: Array<[string, CommandHandler, string]> = [
  ["build", build, "jobs"],
  ["monitor", monitor, "timeout"],
  ["monitor-health", monitorHealth, "duration"],
  ["target-resolve", targetResolve, "binding-ttl"],
  ["agent-flash-monitor-verify", agentFlashMonitorVerifyCmd, "timeout"],
  ["approvals", approvals, "limit"],
  ["pending-approvals", pendingApprovals, "limit"],
  ["task-history", taskHistory, "limit"],
];

describe.each(handlers)("%s numeric handler", (_command, handler, name) => {
  it.each([true, "", "not-a-number", "Infinity"])(
    "rejects %j before effects",
    async (value) => {
      await expect(
        handler({
          options: { "project-dir": "simulated-project", [name]: value },
          positionals: [],
          jsonMode: true,
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        context: { argument: name },
      });
      for (const effect of Object.values(effects))
        expect(effect).not.toHaveBeenCalled();
    },
  );
});

it.each(["-1", "1.5", "1025"])(
  "rejects build schema-invalid jobs %s with the same named error",
  async (value) => {
    await expect(
      build({
        options: { "project-dir": "simulated-project", jobs: value },
        positionals: [],
        jsonMode: true,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      context: { argument: "jobs" },
    });
    expect(effects.build).not.toHaveBeenCalled();
  },
);

it.each([
  [undefined, 30],
  ["1.5", 1.5],
  ["1e-2", 0.01],
] as Array<[OptionValue | undefined, number]>)(
  "preserves monitor wait timeout %j",
  async (value, expected) => {
    effects.monitor.mockResolvedValue({ logFile: "simulated.log" });
    effects.wait.mockResolvedValue({ matched: true });
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await monitor({
        options: {
          "project-dir": "simulated-project",
          expect: "READY",
          ...(value === undefined ? {} : { timeout: value }),
        },
        positionals: [],
        jsonMode: true,
      });
      expect(effects.wait).toHaveBeenCalledWith({
        logFile: "simulated.log",
        expect: "READY",
        timeoutSeconds: expected,
      });
    } finally {
      output.mockRestore();
    }
  },
);

it("preserves a valid finite fractional approvals limit", async () => {
  await approvals({
    options: { limit: "1.5" },
    positionals: [],
    jsonMode: true,
  });
  expect(effects.approvals).toHaveBeenCalledWith({
    status: undefined,
    limit: 1.5,
  });
});
