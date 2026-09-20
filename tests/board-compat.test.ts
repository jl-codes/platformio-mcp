/** Board compatibility contracts using catalog fixtures; no PlatformIO process or hardware. */
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  info: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock("../src/tools/boards.js", () => ({
  listBoards: mocks.list,
  getBoardInfo: mocks.info,
}));
vi.mock("../src/core/action-dispatcher.js", () => ({
  dispatchAuthorizedAction: mocks.authorize,
}));
import {
  executeBoardCompatibility,
  compactCompatibilityBoard,
} from "../src/adapters/board-compat.js";
const board = {
  id: "esp32",
  name: "Example",
  platform: "espressif32",
  mcu: "esp32",
  vendor: "Vendor",
  frameworks: ["arduino"],
  fcpu: 240000000,
  ram: 327680,
  rom: 4194304,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockImplementation(async (_name, _args, _caller, run) =>
    run(),
  );
});
it("matches vendor and platform/framework filters and puts exact ids first", async () => {
  mocks.list.mockResolvedValue([
    { ...board, id: "esp32-long" },
    board,
    { ...board, id: "other", platform: "other" },
  ]);
  const result = await executeBoardCompatibility("pio_list_boards", {
    query: "esp32",
    platform: "ESPRESSIF32",
    framework: "ARDUINO",
    limit: 1,
  });
  expect(result).toMatchObject({
    ok: true,
    total_matches: 2,
    boards: [{ id: "esp32", cpu_mhz: 240, ram_kb: 320, flash_kb: 4096 }],
  });
  expect(mocks.list).toHaveBeenCalledWith();
  expect(mocks.authorize.mock.calls[0][0]).toBe("list_boards");
  const vendor = await executeBoardCompatibility("pio_list_boards", {
    query: "Vendor",
  });
  expect(vendor).toMatchObject({ total_matches: 3 });
});
it("retains board detail fields without presenting hints as observed devices", async () => {
  mocks.info.mockResolvedValue({
    ...board,
    connectivity: ["wifi"],
    debug: { tools: { z: {}, a: { default: true } } },
  });
  const result = await executeBoardCompatibility("pio_board_info", {
    board_id: "esp32",
    approval_id: "grant",
  });
  expect(result).toMatchObject({
    ok: true,
    ram_bytes: 327680,
    flash_bytes: 4194304,
    connectivity: ["wifi"],
    debug_tools: ["a", "z"],
    default_debug_tool: "a",
  });
  expect(mocks.authorize.mock.calls[0].slice(0, 2)).toEqual([
    "get_board_info",
    { boardId: "esp32", approvalId: "grant" },
  ]);
});
it("rejects invalid requests before authorization and stops denied catalog access", async () => {
  await expect(
    executeBoardCompatibility("pio_list_boards", { query: " " }),
  ).rejects.toThrow();
  expect(mocks.authorize).not.toHaveBeenCalled();
  mocks.authorize.mockRejectedValue(new Error("Policy denied"));
  await expect(
    executeBoardCompatibility("pio_board_info", { board_id: "esp32" }),
  ).rejects.toThrow("Policy denied");
  expect(mocks.info).not.toHaveBeenCalled();
});
it("keeps absent metrics null and reference negative slice semantics", async () => {
  expect(
    compactCompatibilityBoard({
      ...board,
      fcpu: undefined,
      ram: undefined,
      rom: undefined,
    }),
  ).toMatchObject({ cpu_mhz: null, ram_kb: null, flash_kb: null });
  mocks.list.mockResolvedValue([board, { ...board, id: "esp32-two" }]);
  expect(
    await executeBoardCompatibility("pio_list_boards", {
      query: "esp32",
      limit: -1,
    }),
  ).toMatchObject({ total_matches: 2, boards: [{ id: "esp32" }] });
});
