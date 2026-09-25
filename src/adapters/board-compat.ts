/** Reference board discovery adapters over the canonical catalog and policy boundary. */
import { z } from "zod";
import { listBoards, getBoardInfo } from "../tools/boards.js";
import type { BoardInfo } from "../types.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import type { CompatibilityProjectDefaults } from "./compatibility-project.js";
import type { RegisteredTool } from "../mcp/tool-registry.js";
import { PlatformIOError } from "../utils/errors.js";

const text = z.string().max(4096);
const listSchema = z
  .object({
    query: text,
    platform: text.nullable().optional(),
    framework: text.nullable().optional(),
    limit: z.number().int().min(-10000).max(10000).default(30),
    approval_id: text.optional(),
  })
  .strict();
const infoSchema = z
  .object({ board_id: text.min(1), approval_id: text.optional() })
  .strict();

/** Project the reference's compact memory/clock fields without inventing absent measurements. */
export function compactCompatibilityBoard(board: BoardInfo) {
  const rounded = (value: number | undefined, divisor: number) => {
    if (!value) return null;
    const scaled = (value / divisor) * 10;
    const lower = Math.floor(scaled);
    return (
      (scaled - lower === 0.5 ? lower + (lower % 2) : Math.round(scaled)) / 10
    );
  };
  return {
    id: board.id,
    name: board.name,
    platform: board.platform,
    mcu: board.mcu,
    cpu_mhz: rounded(board.fcpu, 1000000),
    ram_kb: rounded(board.ram, 1024),
    flash_kb: rounded(board.rom, 1024),
    frameworks: board.frameworks ?? [],
    vendor: board.vendor ?? null,
  };
}

/** Validate aliases before canonical authorization; catalog queries never open attached devices. */
export async function executeBoardCompatibility(
  name: string,
  input: unknown,
  _defaults: CompatibilityProjectDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  if (name === "pio_list_boards") {
    const params = listSchema.parse(input);
    const query = params.query.trim().toLowerCase();
    if (!query && !params.platform && !params.framework)
      throw new PlatformIOError(
        "Give a query or platform/framework filter.",
        "COMPAT_ARGUMENT_INVALID",
      );
    return dispatchAuthorizedAction(
      "list_boards",
      {
        query: params.query,
        platform: params.platform,
        framework: params.framework,
        limit: params.limit,
        approvalId: params.approval_id,
      },
      caller,
      async () => {
        await onAuthorized?.();
        const boards = await listBoards();
        const matches = boards.filter(
          (board) =>
            (!params.platform ||
              board.platform.toLowerCase() === params.platform.toLowerCase()) &&
            (!params.framework ||
              (board.frameworks ?? []).some(
                (framework) =>
                  framework.toLowerCase() === params.framework?.toLowerCase(),
              )) &&
            (!query ||
              [
                board.id,
                board.name,
                board.platform,
                board.mcu,
                board.vendor ?? "",
              ]
                .join(" ")
                .toLowerCase()
                .includes(query)),
        );
        matches.sort(
          (a, b) =>
            Number(a.id.toLowerCase() !== query) -
              Number(b.id.toLowerCase() !== query) || a.id.length - b.id.length,
        );
        const rows = matches
          .slice(0, params.limit)
          .map(compactCompatibilityBoard);
        return {
          ok: true,
          summary: `${matches.length} boards match '${params.query}'${params.platform ? ` on platform ${params.platform}` : ""}${matches.length > rows.length ? `; showing ${rows.length}` : ""}. Use the \`id\` value as the board in pio_project_init or platformio.ini.`,
          total_matches: matches.length,
          boards: rows,
        };
      },
    );
  }
  if (name !== "pio_board_info")
    throw new PlatformIOError(
      "Unknown board compatibility tool.",
      "COMPAT_TOOL_UNKNOWN",
    );
  const params = infoSchema.parse(input);
  return dispatchAuthorizedAction(
    "get_board_info",
    { boardId: params.board_id, approvalId: params.approval_id },
    caller,
    async () => {
      await onAuthorized?.();
      const board = await getBoardInfo(params.board_id);
      const compact = compactCompatibilityBoard(board);
      const tools = board.debug?.tools ?? {};
      return {
        ...compact,
        ram_bytes: board.ram ?? null,
        flash_bytes: board.rom ?? null,
        connectivity: board.connectivity ?? [],
        debug_tools: Object.keys(tools).sort(),
        default_debug_tool:
          Object.entries(tools).find(([, value]) => value.default)?.[0] ?? null,
        url: board.url ?? null,
        ok: true,
        summary: `${compact.name} (${board.id}): ${compact.mcu} @ ${compact.cpu_mhz} MHz, ${compact.ram_kb} KB RAM, ${compact.flash_kb} KB flash, frameworks ${compact.frameworks.join(", ")}, platform ${compact.platform}.`,
      };
    },
  );
}

/** Advertise board aliases only in opt-in mode, preserving canonical safety annotations. */
export function withBoardCompatibility<TResult>(
  base: ReadonlyMap<string, RegisteredTool<TResult>>,
) {
  const result = new Map(base);
  for (const [name, canonical] of [
    ["pio_list_boards", "list_boards"],
    ["pio_board_info", "get_board_info"],
  ]) {
    const source = base.get(canonical);
    if (!source || result.has(name))
      throw new Error(`Invalid board alias: ${name}`);
    const properties =
      name === "pio_list_boards"
        ? {
            query: { type: "string" },
            platform: { type: ["string", "null"] },
            framework: { type: ["string", "null"] },
            limit: {
              type: "integer",
              default: 30,
              minimum: -10000,
              maximum: 10000,
            },
            approval_id: { type: "string" },
          }
        : { board_id: { type: "string" }, approval_id: { type: "string" } };
    result.set(name, {
      ...source,
      name,
      description: `Compatibility board discovery using canonical ${canonical} permissions.`,
      inputSchema: {
        type: "object",
        properties,
        required: [name === "pio_list_boards" ? "query" : "board_id"],
        additionalProperties: false,
      },
      handler: (args, context) => context.dispatch(name, args),
    });
  }
  return result;
}
