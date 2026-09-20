/** Size adapter must preserve independent grants and prefer PlatformIO accounting over estimates. */
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  report: vi.fn(),
  board: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("../src/adapters/compatibility-project.js", () => ({
  resolveCompatibilityProject: async () => "/project",
}));
vi.mock("../src/core/policy/revision-guard.js", () => ({
  createPolicyRevisionGuard: () => () => {},
}));
vi.mock("../src/tools/project-inspection.js", () => ({
  executeProjectInspection: mocks.config,
}));
vi.mock("../src/tools/analysis.js", () => ({
  firmwareSizeReport: mocks.report,
}));
vi.mock("../src/tools/boards.js", () => ({ getBoardInfo: mocks.board }));
vi.mock("../src/core/action-dispatcher.js", () => ({
  dispatchAuthorizedAction: mocks.dispatch,
}));
import { executeSizeCompatibility } from "../src/adapters/size-compat.js";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockResolvedValue({
    ok: true,
    defaultEnvironments: ["esp"],
    envs: [{ name: "esp", board: "board" }],
  });
  mocks.dispatch.mockImplementation(
    async (_action, _params, _caller, callback) => callback(),
  );
  mocks.board.mockResolvedValue({
    id: "board",
    rom: 10000,
    ram: 10000,
    mcu: "esp",
  });
  mocks.report.mockResolvedValue({
    ok: true,
    elf: { path: "/fw.elf", sha256: "a".repeat(64) },
    totals: {
      text: 100,
      data: 20,
      bss: 30,
      flashEstimate: 120,
      ramEstimate: 50,
    },
    sections: [{ region: "flash", size: 100 }],
    memory: {
      flash: { usedBytes: 120, totalBytes: 1000, percent: 12 },
      ram: { usedBytes: 50, totalBytes: 100, percent: 50 },
    },
    memorySource: "platformio",
    memoryUnavailableReason: null,
    topSymbols: [],
    topFiles: [],
    symbolCount: 0,
    notes: [],
  });
});
it("uses partition-aware percentages and canonical board approval arguments", async () => {
  const result = await executeSizeCompatibility(
    { board_approval_id: "catalog", approval_id: "build" },
    {},
    {},
  );
  expect(result).toMatchObject({
    flash_percent: 12,
    ram_percent: 50,
    totals: { flash_estimate: 120 },
    region_totals: { flash: 100 },
  });
  expect(mocks.dispatch.mock.calls[0][1]).toMatchObject({
    boardId: "board",
    approvalId: "catalog",
  });
  expect(mocks.report.mock.calls[0][0]).toMatchObject({
    environment: "esp",
    approvalId: "build",
  });
});
it("does not run the build stage after board authorization fails", async () => {
  mocks.dispatch.mockRejectedValue(new Error("denied"));
  await expect(executeSizeCompatibility({}, {}, {})).rejects.toThrow("denied");
  expect(mocks.report).not.toHaveBeenCalled();
});
