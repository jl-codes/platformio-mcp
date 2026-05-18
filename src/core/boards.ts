import { listBoards } from "../tools/boards.js";
import type { BoardInfo } from "../types.js";

export async function listBoardsCore(filter?: string): Promise<BoardInfo[]> {
  return listBoards(filter);
}
