import { listBoardsCore } from "../../core/boards.js";
import { getBoardInfo } from "../../tools/boards.js";
import { PlatformIOError } from "../../utils/errors.js";
import { asString } from "../args.js";
import type { CommandHandler } from "./types.js";

export const boards: CommandHandler = async (ctx) => {
  // Not a bare `as string | undefined` cast: `--filter` with no following
  // value parses to the boolean `true` (see parseArgs in ../../cli.ts), and
  // listBoardsCore/listBoards calls `filter.trim()` on a truthy filter, which
  // throws on a boolean. The switch-case this replaces normalized through
  // asString() first (and through ListBoardsParamsSchema, which only checks
  // the same string-or-undefined shape); this preserves that behaviour.
  const filter =
    typeof ctx.options.filter === "string" ? ctx.options.filter : undefined;
  return listBoardsCore(filter);
};

export const boardInfo: CommandHandler = async (ctx) => {
  const boardId = asString(ctx.options.board) ?? ctx.positionals[0];
  if (!boardId) {
    throw new PlatformIOError(
      "board-info requires --board <id>",
      "MISSING_ARGUMENT",
      { argument: "board" },
    );
  }
  return getBoardInfo(boardId);
};
