/** Board catalog parsing preserves boards with unspecified frameworks without accepting malformed data. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { platformioExecutor } from "../src/platformio.js";
import {
  listBoards,
  getBoardInfo,
  listBoardsByPlatform,
} from "../src/tools/boards.js";
import { BoardInfoSchema } from "../src/types.js";

const board = {
  id: "no-framework",
  name: "No framework declared",
  platform: "native",
  mcu: "host",
  frameworks: null,
};
const arduino = {
  ...board,
  id: "uno",
  name: "Arduino Uno",
  platform: "atmelavr",
  mcu: "atmega328p",
  frameworks: ["arduino"],
};
afterEach(() => vi.restoreAllMocks());

/** Inject raw CLI output while retaining the real JSON parser and board schemas. */
function catalog(output: unknown) {
  vi.spyOn(platformioExecutor, "execute").mockResolvedValue({
    stdout: JSON.stringify(output),
    stderr: "",
    exitCode: 0,
  });
}

describe("board catalog framework metadata", () => {
  it.each(["flat", "grouped"])(
    "retains every board in a %s catalog containing null frameworks",
    async (shape) => {
      catalog(
        shape === "flat"
          ? [board, arduino]
          : { native: [board], atmelavr: [arduino] },
      );
      expect(await listBoards()).toEqual([
        { ...board, frameworks: undefined },
        arduino,
      ]);
      expect(await getBoardInfo(board.id)).toEqual({
        ...board,
        frameworks: undefined,
      });
      expect(await listBoardsByPlatform()).toEqual({
        native: [{ ...board, frameworks: undefined }],
        atmelavr: [arduino],
      });
    },
  );

  it("can filter a catalog containing unspecified frameworks", async () => {
    catalog([board, arduino]);
    expect(await listBoards("arduino")).toEqual([arduino]);
    expect(await listBoards("no-framework")).toEqual([
      { ...board, frameworks: undefined },
    ]);
  });

  it.each([undefined, null, [], ["arduino", "espidf"]])(
    "normalizes valid optional frameworks %j",
    (frameworks) => {
      expect(
        BoardInfoSchema.parse({ ...board, frameworks }).frameworks,
      ).toEqual(frameworks ?? undefined);
    },
  );

  it.each(["arduino", 42, {}, [null], [42]])(
    "still rejects malformed frameworks %j",
    async (frameworks) => {
      catalog([{ ...board, frameworks }]);
      await expect(listBoards()).rejects.toMatchObject({
        code: "LIST_BOARDS_FAILED",
      });
    },
  );
});
