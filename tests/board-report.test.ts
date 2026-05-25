import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/tools/boards.js", () => ({
  getBoardInfo: vi.fn(async (boardId: string) => ({
    id: boardId,
    name: "Espressif ESP32 Dev Module",
    platform: "espressif32",
    mcu: "ESP32",
    frameworks: ["arduino", "espidf"],
    flash: 4 * 1024 * 1024,
    ram: 520 * 1024,
  })),
}));

import { agentGenerateBoardReport } from "../src/tools/agent.js";
import { readBoardReport } from "../src/utils/artifacts.js";

const createdDirs: string[] = [];

function makeTempProject(): string {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-board-report-"));
  createdDirs.push(projectDir);
  return projectDir;
}

describe("agent_generate_board_report", () => {
  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("generates and persists board intelligence report", async () => {
    const projectDir = makeTempProject();
    const report = await agentGenerateBoardReport(projectDir, "esp32dev");

    expect(report.boardId).toBe("esp32dev");
    expect(report.platform).toBe("espressif32");
    expect(report.dangerousPins).toContain(12);
    expect(report.recommendedMonitorBaudRate).toBe(115200);

    const persisted = readBoardReport(projectDir);
    expect(persisted).not.toBeNull();
    expect(persisted?.boardId).toBe("esp32dev");
  });
});
