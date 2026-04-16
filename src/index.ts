#!/usr/bin/env node

/**
 * PlatformIO MCP Server Entry Point
 * A board-agnostic MCP server for embedded development with PlatformIO.
 *
 * Provides:
 * - server: Main Model Context Protocol server instance.
 * - ListToolsRequestSchema handler: Defines and describes all exposed MCP tools.
 * - CallToolRequestSchema handler: Routes tool requests to their respective backend logic.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Import types and schemas for validation
import {
  ListBoardsParamsSchema,
  GetBoardInfoParamsSchema,
  InitProjectParamsSchema,
  BuildProjectParamsSchema,
  CleanProjectParamsSchema,
  UploadFirmwareParamsSchema,
  UploadFilesystemParamsSchema,
  SearchLibrariesParamsSchema,
  InstallLibraryParamsSchema,
  ListInstalledLibrariesParamsSchema,
  AcquireLockParamsSchema,
  ReleaseLockParamsSchema,
  StartMonitorParamsSchema,
  StopMonitorParamsSchema,
  QueryLogsParamsSchema,
  CheckTaskStatusParamsSchema,
  GetDashboardUrlParamsSchema,
} from "./types.js";

// Import tool functions from feature modules
import { listBoards, getBoardInfo } from "./tools/boards.js";
import { listDevices } from "./tools/devices.js";
import { initProject } from "./tools/projects.js";
import { buildProject, cleanProject, checkTaskStatus } from "./tools/build.js";
import { uploadFirmware, uploadFilesystem } from "./tools/upload.js";
import { startMonitor, stopMonitor, queryLogs } from "./tools/monitor.js";

import {
  searchLibraries,
  installLibrary,
  listInstalledLibraries,
} from "./tools/libraries.js";
import { checkPlatformIOInstalled } from "./platformio.js";
import { formatPlatformIOError } from "./utils/errors.js";
import { hardwareLockManager } from "./utils/lock-manager.js";
import { killAllTrackedProcesses } from "./utils/process-manager.js";
import { LOCKS_DIR } from "./utils/paths.js";
import fs from "node:fs";
import path from "node:path";
import { logDiagnostic as logDiag } from "./utils/logger.js";
import { getDashboardStatus } from "./api/server.js";
import { portalEvents } from "./api/events.js";

/**
 * Main PlatformIO MCP Server instance configuration.
 */
const server = new Server(
  {
    name: "platformio-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

/**
 * REGISTER MCP TOOLS
 * Defines the metadata, descriptions, and input schemas for all tools
 * exposed by this server.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_boards",
        description:
          "Lists all available PlatformIO boards with optional filtering by platform, framework, or MCU. Supports 1000+ boards across 30+ platforms.",
        inputSchema: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              description:
                'Optional filter by platform (e.g., "espressif32"), framework (e.g., "arduino"), or MCU name',
            },
          },
        },
      },
      {
        name: "get_board_info",
        description:
          "Gets detailed information about a specific board including MCU, frequency, flash, RAM, and supported frameworks.",
        inputSchema: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description:
                'Board ID (e.g., "esp32dev", "uno", "nucleo_f401re")',
            },
          },
          required: ["boardId"],
        },
      },
      {
        name: "list_devices",
        description:
          "Lists all connected serial devices that can be used for firmware upload and monitoring.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "init_project",
        description:
          "Initializes a new PlatformIO project with the specified board and optional framework. Creates project structure with src/, include/, lib/, and test/ directories.",
        inputSchema: {
          type: "object",
          properties: {
            board: {
              type: "string",
              description: "Board ID for the project",
            },
            framework: {
              type: "string",
              description:
                'Optional framework (e.g., "arduino", "espidf", "mbed")',
            },
            projectDir: {
              type: "string",
              description: "Directory path where the project should be created",
            },
            platformOptions: {
              type: "object",
              description: "Optional platform-specific configuration options",
            },
          },
          required: ["board", "projectDir"],
        },
      },
      {
        name: "build_project",
        description:
          "Compiles the project source code and generates firmware binary. Automatically downloads required toolchains and libraries on first build.",
        inputSchema: {
          type: "object",
          properties: {
            projectDir: {
              type: "string",
              description: "Path to the PlatformIO project directory",
            },
            environment: {
              type: "string",
              description:
                "Optional specific environment to build from platformio.ini",
            },
            sessionId: {
              type: "string",
              description: "Agent session ID for pipeline lock validation",
            },
          },
          required: ["projectDir"],
        },
      },
      {
        name: "clean_project",
        description:
          "Removes build artifacts and compiled files from the project.",
        inputSchema: {
          type: "object",
          properties: {
            projectDir: {
              type: "string",
              description: "Path to the PlatformIO project directory",
            },
            sessionId: {
              type: "string",
              description: "Agent session ID for pipeline lock validation",
            },
          },
          required: ["projectDir"],
        },
      },
      {
        name: "upload_filesystem",
        description:
          "Builds and uploads a SPIFFS/LittleFS filesystem image to the connected device. Automatically builds if necessary. Supports automatic port detection.",
        inputSchema: {
          type: "object",
          properties: {
            projectDir: {
              type: "string",
              description: "Path to the PlatformIO project directory",
            },
            port: {
              type: "string",
              description:
                "Optional upload port (auto-detected if not specified)",
            },
            environment: {
              type: "string",
              description: "Optional specific environment from platformio.ini",
            },
            sessionId: {
              type: "string",
              description: "Agent session ID for pipeline lock validation",
            },
            verbose: {
              type: "boolean",
              description:
                "If true, returns the complete verbose upload log in the result instead of truncating it",
            },
          },
          required: ["projectDir"],
        },
      },
      {
        name: "upload_firmware",
        description:
          "Uploads compiled firmware to a connected device. Automatically builds if necessary. Supports automatic port detection.",
        inputSchema: {
          type: "object",
          properties: {
            projectDir: {
              type: "string",
              description: "Path to the PlatformIO project directory",
            },
            port: {
              type: "string",
              description:
                "Optional upload port (auto-detected if not specified)",
            },
            environment: {
              type: "string",
              description: "Optional specific environment from platformio.ini",
            },
            sessionId: {
              type: "string",
              description: "Agent session ID for pipeline lock validation",
            },
            verbose: {
              type: "boolean",
              description:
                "If true, returns the complete verbose upload log in the result instead of truncating it",
            },
          },
          required: ["projectDir"],
        },
      },
      {
        name: "acquire_lock",
        description:
          "Explicitly claim the hardware queue lock for multi-step tasks. Throws if already held.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Your active Session ID",
            },
            reason: { type: "string", description: "Reason for locking" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "release_lock",
        description:
          "Release the explicit queue lock matching your session ID.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Your active Session ID",
            },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "get_lock_status",
        description: "Reveals who currently owns the hardware queue lock.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "search_libraries",
        description:
          "Searches the PlatformIO library registry for available libraries by name, keywords, or description.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search query (library name, keyword, or description)",
            },
            limit: {
              type: "number",
              description: "Maximum number of results (default: 20)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "install_library",
        description:
          "Installs a library from the PlatformIO registry either globally or to a specific project. Supports version specification.",
        inputSchema: {
          type: "object",
          properties: {
            library: {
              type: "string",
              description: "Library name or ID to install",
            },
            projectDir: {
              type: "string",
              description:
                "Optional project directory (installs globally if not specified)",
            },
            version: {
              type: "string",
              description:
                'Optional specific version (e.g., "1.0.0", "^2.1.0")',
            },
          },
          required: ["library"],
        },
      },
      {
        name: "list_installed_libraries",
        description:
          "Lists all installed libraries either globally or for a specific project.",
        inputSchema: {
          type: "object",
          properties: {
            projectDir: {
              type: "string",
              description:
                "Optional project directory (lists global libraries if not specified)",
            },
          },
        },
      },
      {
        name: "start_monitor",
        description: "Manually start or restart the background serial-to-disk spooler for a specific device.",
        inputSchema: {
          type: "object",
          properties: {
            port: { type: "string", description: "Optional COM path. Falls back to default." },
            baudRate: { type: "number", description: "Optional baud rate. Defaults to 115200." },
            projectDir: { type: "string", description: "Target project boundary to deposit raw hardware logs into instead of the global server cache." },
            environment: { type: "string", description: "Optional PlatformIO environment context." },
          },
        },
      },
      {
        name: "stop_monitor",
        description: "Kills the active background serial listener and unlocks the UART.",
        inputSchema: {
          type: "object",
          properties: {
            port: { type: "string", description: "COM port to stop listening on." },
            projectDir: { type: "string", description: "Target project containing the workspace." },
          },
          required: ["port"],
        },
      },
      {
        name: "query_logs",
        description: "Scans the latest active background serial trace spool, returning a filtered string block.",
        inputSchema: {
          type: "object",
          properties: {
            lines: { type: "number", description: "Fetch this many tail lines from the end of the log (default: 100)" },
            searchPattern: { type: "string", description: "Optional Regex pattern to filter the spool for specific keywords." },
            projectDir: { type: "string", description: "Target project checkout to query local .log cache instead of global cache." },
            port: { type: "string", description: "Specific COM port to query logs for." },
          },
        },
      },
      {
        name: "reset_server_state",
        description: "Forcefully cleans all server locks and terminates any tracked daemon or compilation PIDs globally or locally.",
        inputSchema: {
          type: "object",
          properties: {
            projectDir: { type: "string", description: "Optional target directory for scoped cleanup." },
          },
        },
      },
      {
        name: "check_task_status",
        description: "Polls the status of an ongoing background build or upload task.",
        inputSchema: {
          type: "object",
          properties: {
            projectDir: { type: "string", description: "Optional project directory to scope the check." },
          },
        },
      },
      {
        name: "get_dashboard_url",
        description: "Retrieves the address and auth token for the MCP Web Dashboard. Automatically starts the web server on demand if offline.",
        inputSchema: {
          type: "object",
          properties: {
            open: { type: "boolean", description: "If true, automatically opens the authenticated GUI link natively in the system's browser." },
          },
        },
      },
    ],
  };
});

/**
 * TOOL EXECUTION HANDLER
 * Intercepts MCP tool calls, performs validation, manages hardware locks,
 * and calls the underlying business logic.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args: any = request.params.arguments || {};
  if (args.projectDir) {
    portalEvents.emitWorkspaceState(args.projectDir);
  }

  try {
    const response = await (async () => {
      switch (name) {
      case "list_boards": {
        const params = ListBoardsParamsSchema.parse(args);
        const boards = await listBoards(params.filter);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(boards, null, 2),
            },
          ],
        };
      }

      case "get_board_info": {
        const params = GetBoardInfoParamsSchema.parse(args);
        const board = await getBoardInfo(params.boardId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(board, null, 2),
            },
          ],
        };
      }

      case "list_devices": {
        const devices = await listDevices();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(devices, null, 2),
            },
          ],
        };
      }

      case "init_project": {
        const params = InitProjectParamsSchema.parse(args);
        const result = await initProject(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "build_project": {
        const params = BuildProjectParamsSchema.parse(args);

        const executeTask = () =>
          buildProject(params.projectDir, params.environment, params.verbose, params.background);
        const result = params.sessionId
          ? (hardwareLockManager.requireLock(params.sessionId),
            await executeTask())
          : await hardwareLockManager.withImplicitLock(executeTask);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "clean_project": {
        const params = CleanProjectParamsSchema.parse(args);

        const executeTask = () => cleanProject(params.projectDir, params.background);
        const result = params.sessionId
          ? (hardwareLockManager.requireLock(params.sessionId),
            await executeTask())
          : await hardwareLockManager.withImplicitLock(executeTask);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "upload_filesystem": {
        const params = UploadFilesystemParamsSchema.parse(args);

        const executeTask = () =>
          uploadFilesystem(
            params.projectDir,
            params.port,
            params.environment,
            params.verbose,
            params.background
          );
        const result = params.sessionId
          ? (hardwareLockManager.requireLock(params.sessionId),
            await executeTask())
          : await hardwareLockManager.withImplicitLock(executeTask);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "upload_firmware": {
        const params = UploadFirmwareParamsSchema.parse(args);

        const executeTask = () =>
          uploadFirmware(
            params.projectDir,
            params.port,
            params.environment,
            params.verbose,
            params.background
          );
        const result = params.sessionId
          ? (hardwareLockManager.requireLock(params.sessionId),
            await executeTask())
          : await hardwareLockManager.withImplicitLock(executeTask);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "acquire_lock": {
        const params = AcquireLockParamsSchema.parse(args);
        hardwareLockManager.acquireLock(params.sessionId, params.reason);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "Hardware lock acquired explicitly.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "release_lock": {
        const params = ReleaseLockParamsSchema.parse(args);
        hardwareLockManager.releaseLock(params.sessionId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "Hardware lock released explicitly.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "get_lock_status": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                hardwareLockManager.getLockStatus(),
                null,
                2,
              ),
            },
          ],
        };
      }

      case "search_libraries": {
        const params = SearchLibrariesParamsSchema.parse(args);
        const libraries = await searchLibraries(params.query, params.limit);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(libraries, null, 2),
            },
          ],
        };
      }

      case "install_library": {
        const params = InstallLibraryParamsSchema.parse(args);
        const result = await installLibrary(params.library, {
          projectDir: params.projectDir,
          version: params.version,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "list_installed_libraries": {
        const params = ListInstalledLibrariesParamsSchema.parse(args);
        const libraries = await listInstalledLibraries(params.projectDir);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(libraries, null, 2),
            },
          ],
        };
      }

      case "start_monitor": {
        const params = StartMonitorParamsSchema.parse(args);
        const executeTask = () =>
          startMonitor(params.port, params.baudRate, params.projectDir, params.environment);
        const result = await hardwareLockManager.withImplicitLock(executeTask);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "stop_monitor": {
        const params = StopMonitorParamsSchema.parse(args);
        const executeTask = async () => {
          await stopMonitor(params.port, params.projectDir);
          return { success: true, message: `Stopped monitor on ${params.port}` };
        };
        const result = await hardwareLockManager.withImplicitLock(executeTask);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "query_logs": {
        const params = QueryLogsParamsSchema.parse(args);
        const result = await queryLogs(params.lines, params.searchPattern, params.projectDir, params.port);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "reset_server_state": {
        const projectDir = args.projectDir as string | undefined;
        await killAllTrackedProcesses(projectDir);

        // Release MCP Explicit Lock
        const status = hardwareLockManager.getLockStatus();
        if (status.isLocked && status.sessionId) {
          hardwareLockManager.releaseLock(status.sessionId);
        }

        // Release OS-level Semaphores
        try {
          if (fs.existsSync(LOCKS_DIR)) {
            for (const file of fs.readdirSync(LOCKS_DIR)) {
              if (file.endsWith(".lock")) {
                fs.unlinkSync(path.join(LOCKS_DIR, file));
              }
            }
          }
        } catch (e) {
          logDiag(`Failed to wipe semaphores: ${e}`, args.projectDir);
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, message: "System state has been reset and all locks cleared." }, null, 2) }],
        };
      }

      case "check_task_status": {
        const params = CheckTaskStatusParamsSchema.parse(args);
        const result = await checkTaskStatus(params.projectDir);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "get_dashboard_url": {
        const params = GetDashboardUrlParamsSchema.parse(args);
        const result = await getDashboardStatus(params.open);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
      }
    })();
    
    portalEvents.emitActivity(name, args, true);
    return response;
  } catch (error) {
    portalEvents.emitActivity(name, args, false);
    const errorMessage = formatPlatformIOError(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  // Check if PlatformIO is installed
  const isInstalled = await checkPlatformIOInstalled();
  if (!isInstalled) {
    logDiag(
      "Warning: PlatformIO CLI not found. Please install it from https://platformio.org/install/cli"
    );
    logDiag(
      "The server will start but commands will fail until PlatformIO is installed.\n"
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (process.argv.includes("--open-dashboard-on-start") || process.env.PIO_MCP_OPEN_DASH_ON_START === "true") {
    getDashboardStatus(true).catch((e) => logDiag(`[Dashboard] ${e.message}`));
  }

  logDiag("PlatformIO MCP Server running on stdio");
  logDiag("Server supports 1000+ boards across 30+ platforms");
}

main().catch((error) => {
  logDiag(`Fatal error: ${error}`);
  process.exit(1);
});
