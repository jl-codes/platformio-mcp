/**
 * Board Information Tools
 * Board discovery and information tools.
 *
 * Provides:
 * - listBoards: Retrieves structured catalog of defined boards.
 * - getBoardInfo: Retrieves data about a specific board ID.
 * - listBoardsByPlatform: Retrieves catalog organized by platform ID.
 * - searchBoards: Queries boards by features.
 * - listPlatforms: Retrieves all supported platforms list.
 * - listFrameworks: Retrieves all supported architectures.
 */

import { z } from "zod";
import { platformioExecutor } from "../platformio.js";
import type { BoardInfo } from "../types.js";
import { BoardInfoSchema } from "../types.js";
import { validateBoardId } from "../utils/validation.js";
import { BoardNotFoundError, PlatformIOError } from "../utils/errors.js";

/**
 * PlatformIO JSON output format varies by version:
 * - Newer versions return a flat array of boards
 * - Some versions return an object grouped by platform
 */
const PioBoardsOutputSchema = z.union([
  z.array(BoardInfoSchema),
  z.record(z.string(), z.array(BoardInfoSchema)),
]);

function normalizeBoardsOutput(
  output: z.infer<typeof PioBoardsOutputSchema>,
): BoardInfo[] {
  if (Array.isArray(output)) {
    return output;
  }

  const flattened: BoardInfo[] = [];
  for (const platformBoards of Object.values(
    output as Record<string, BoardInfo[]>,
  )) {
    flattened.push(...platformBoards);
  }
  return flattened;
}

/**
 * Lists all available PlatformIO boards with optional filtering.
 *
 * @param filter - Search criteria for limiting board query.
 * @returns Array of boards matching the filter.
 */
export async function listBoards(filter?: string): Promise<BoardInfo[]> {
  try {
    const args: string[] = [];

    if (filter && filter.trim().length > 0) {
      args.push(filter.trim());
    }

    // Use shorter timeout for board listing
    const result = await platformioExecutor.executeWithJsonOutput(
      "boards",
      args,
      PioBoardsOutputSchema,
      { timeout: 30000 },
    );

    const allBoards: BoardInfo[] = normalizeBoardsOutput(result);

    // Apply filter if provided (PlatformIO does basic filtering, but we can enhance it)
    if (filter && filter.trim().length > 0) {
      const filterLower = filter.trim().toLowerCase();
      return allBoards.filter(
        (board) =>
          board.id.toLowerCase().includes(filterLower) ||
          board.name.toLowerCase().includes(filterLower) ||
          board.platform.toLowerCase().includes(filterLower) ||
          board.mcu.toLowerCase().includes(filterLower) ||
          board.frameworks?.some((fw) =>
            fw.toLowerCase().includes(filterLower),
          ),
      );
    }

    return allBoards;
  } catch (error) {
    throw new PlatformIOError(
      `Failed to list boards${filter ? ` with filter '${filter}'` : ""}: ${error}`,
      "LIST_BOARDS_FAILED",
      { filter },
    );
  }
}

/**
 * Gets detailed information about a specific board.
 *
 * @param boardId - The exact board identifier token.
 * @returns Comprehensive details object for the given board.
 */
export async function getBoardInfo(boardId: string): Promise<BoardInfo> {
  if (!validateBoardId(boardId)) {
    throw new BoardNotFoundError(boardId);
  }

  try {
    // Get all boards and filter for the specific one
    // PlatformIO boards command with a filter returns all boards that match
    const result = await platformioExecutor.executeWithJsonOutput(
      "boards",
      [boardId],
      PioBoardsOutputSchema,
      { timeout: 30000 },
    );

    // Find exact match
    const board = normalizeBoardsOutput(result).find((b) => b.id === boardId);
    if (board) {
      return board;
    }

    // If we get here, the board wasn't found
    throw new BoardNotFoundError(boardId);
  } catch (error) {
    if (error instanceof BoardNotFoundError) {
      throw error;
    }
    throw new PlatformIOError(
      `Failed to get board info for '${boardId}': ${error}`,
      "GET_BOARD_INFO_FAILED",
      { boardId },
    );
  }
}

/**
 * Lists boards grouped by platform.
 *
 * @returns A dictionary mapping platform names to arrays of BoardInfo.
 */
export async function listBoardsByPlatform(): Promise<
  Record<string, BoardInfo[]>
> {
  try {
    const result = await platformioExecutor.executeWithJsonOutput(
      "boards",
      [],
      PioBoardsOutputSchema,
      { timeout: 30000 },
    );

    // Group the array into a Record by platform
    const flattened = normalizeBoardsOutput(result);
    const grouped: Record<string, BoardInfo[]> = {};
    for (const board of flattened) {
      const platform = board.platform || "unknown";
      if (!grouped[platform]) {
        grouped[platform] = [];
      }
      grouped[platform].push(board);
    }

    return grouped;
  } catch (error) {
    throw new PlatformIOError(
      `Failed to list boards by platform: ${error}`,
      "LIST_BOARDS_BY_PLATFORM_FAILED",
    );
  }
}

/**
 * Searches for boards matching specific criteria.
 *
 * @param criteria - Object containing platform, framework, mcu, and/or name conditions.
 * @returns Filtered list of BoardInfo complying with the specified attributes.
 */
export async function searchBoards(criteria: {
  platform?: string;
  framework?: string;
  mcu?: string;
  name?: string;
}): Promise<BoardInfo[]> {
  const allBoards = await listBoards();

  return allBoards.filter((board) => {
    if (
      criteria.platform &&
      !board.platform.toLowerCase().includes(criteria.platform.toLowerCase())
    ) {
      return false;
    }
    if (
      criteria.framework &&
      !board.frameworks?.some((fw) =>
        fw.toLowerCase().includes(criteria.framework!.toLowerCase()),
      )
    ) {
      return false;
    }
    if (
      criteria.mcu &&
      !board.mcu.toLowerCase().includes(criteria.mcu.toLowerCase())
    ) {
      return false;
    }
    if (
      criteria.name &&
      !board.name.toLowerCase().includes(criteria.name.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Gets a list of all available platforms.
 *
 * @returns Alphabetically sorted array of distinct platform identifiers.
 */
export async function listPlatforms(): Promise<string[]> {
  const boardsByPlatform = await listBoardsByPlatform();
  return Object.keys(boardsByPlatform).sort();
}

/**
 * Gets a list of all available frameworks across all boards.
 *
 * @returns Alphabetically sorted array of available framework references.
 */
export async function listFrameworks(): Promise<string[]> {
  const allBoards = await listBoards();
  const frameworkSet = new Set<string>();

  for (const board of allBoards) {
    if (board.frameworks) {
      for (const framework of board.frameworks) {
        frameworkSet.add(framework);
      }
    }
  }

  return Array.from(frameworkSet).sort();
}
