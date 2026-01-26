#!/usr/bin/env node

/**
 * PlatformIO MCP Server
 * A board-agnostic MCP server for embedded development with PlatformIO
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import types and schemas
import {
  ListBoardsParamsSchema,
  GetBoardInfoParamsSchema,
  InitProjectParamsSchema,
  BuildProjectParamsSchema,
  CleanProjectParamsSchema,
  UploadFirmwareParamsSchema,
  UploadFilesystemParamsSchema,
  StartMonitorParamsSchema,
  SearchLibrariesParamsSchema,
  InstallLibraryParamsSchema,
  ListInstalledLibrariesParamsSchema,
} from './types.js';

// Import tool functions
import { listBoards, getBoardInfo } from './tools/boards.js';
import { listDevices } from './tools/devices.js';
import { initProject } from './tools/projects.js';
import { buildProject, cleanProject } from './tools/build.js';
import { uploadFirmware, uploadFilesystem } from './tools/upload.js';
import { startMonitor } from './tools/monitor.js';
import { searchLibraries, installLibrary, listInstalledLibraries } from './tools/libraries.js';
import { checkPlatformIOInstalled } from './platformio.js';
import { formatPlatformIOError } from './utils/errors.js';

// Create server instance
const server = new Server(
  {
    name: 'platformio-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_boards',
        description: 'Lists all available PlatformIO boards with optional filtering by platform, framework, or MCU. Supports 1000+ boards across 30+ platforms.',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              description: 'Optional filter by platform (e.g., "espressif32"), framework (e.g., "arduino"), or MCU name',
            },
          },
        },
      },
      {
        name: 'get_board_info',
        description: 'Gets detailed information about a specific board including MCU, frequency, flash, RAM, and supported frameworks.',
        inputSchema: {
          type: 'object',
          properties: {
            boardId: {
              type: 'string',
              description: 'Board ID (e.g., "esp32dev", "uno", "nucleo_f401re")',
            },
          },
          required: ['boardId'],
        },
      },
      {
        name: 'list_devices',
        description: 'Lists all connected serial devices that can be used for firmware upload and monitoring.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'init_project',
        description: 'Initializes a new PlatformIO project with the specified board and optional framework. Creates project structure with src/, include/, lib/, and test/ directories.',
        inputSchema: {
          type: 'object',
          properties: {
            board: {
              type: 'string',
              description: 'Board ID for the project',
            },
            framework: {
              type: 'string',
              description: 'Optional framework (e.g., "arduino", "espidf", "mbed")',
            },
            projectDir: {
              type: 'string',
              description: 'Directory path where the project should be created',
            },
            platformOptions: {
              type: 'object',
              description: 'Optional platform-specific configuration options',
            },
          },
          required: ['board', 'projectDir'],
        },
      },
      {
        name: 'build_project',
        description: 'Compiles the project source code and generates firmware binary. Automatically downloads required toolchains and libraries on first build.',
        inputSchema: {
          type: 'object',
          properties: {
            projectDir: {
              type: 'string',
              description: 'Path to the PlatformIO project directory',
            },
            environment: {
              type: 'string',
              description: 'Optional specific environment to build from platformio.ini',
            },
          },
          required: ['projectDir'],
        },
      },
      {
        name: 'clean_project',
        description: 'Removes build artifacts and compiled files from the project.',
        inputSchema: {
          type: 'object',
          properties: {
            projectDir: {
              type: 'string',
              description: 'Path to the PlatformIO project directory',
            },
          },
          required: ['projectDir'],
        },
      },
      {
        name: 'upload_firmware',
        description: 'Uploads compiled firmware to a connected device. Automatically builds if necessary. Supports automatic port detection.',
        inputSchema: {
          type: 'object',
          properties: {
            projectDir: {
              type: 'string',
              description: 'Path to the PlatformIO project directory',
            },
            port: {
              type: 'string',
              description: 'Optional upload port (auto-detected if not specified)',
            },
            environment: {
              type: 'string',
              description: 'Optional specific environment from platformio.ini',
            },
          },
          required: ['projectDir'],
        },
      },
      {
        name: 'upload_filesystem',
        description: 'Uploads filesystem image (SPIFFS/LittleFS) from the data/ directory to a connected device. Use this to deploy web assets, configuration files, or other static content stored in the project data folder.',
        inputSchema: {
          type: 'object',
          properties: {
            projectDir: {
              type: 'string',
              description: 'Path to the PlatformIO project directory',
            },
            port: {
              type: 'string',
              description: 'Optional upload port (auto-detected if not specified)',
            },
            environment: {
              type: 'string',
              description: 'Optional specific environment from platformio.ini',
            },
          },
          required: ['projectDir'],
        },
      },
      {
        name: 'start_monitor',
        description: 'Provides instructions and command for starting serial monitor to view device output. Monitor requires interactive terminal.',
        inputSchema: {
          type: 'object',
          properties: {
            port: {
              type: 'string',
              description: 'Optional serial port (auto-detected if not specified)',
            },
            baud: {
              type: 'number',
              description: 'Optional baud rate (e.g., 9600, 115200)',
            },
            projectDir: {
              type: 'string',
              description: 'Optional project directory for environment-specific settings',
            },
          },
        },
      },
      {
        name: 'search_libraries',
        description: 'Searches the PlatformIO library registry for available libraries by name, keywords, or description.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (library name, keyword, or description)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 20)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'install_library',
        description: 'Installs a library from the PlatformIO registry either globally or to a specific project. Supports version specification.',
        inputSchema: {
          type: 'object',
          properties: {
            library: {
              type: 'string',
              description: 'Library name or ID to install',
            },
            projectDir: {
              type: 'string',
              description: 'Optional project directory (installs globally if not specified)',
            },
            version: {
              type: 'string',
              description: 'Optional specific version (e.g., "1.0.0", "^2.1.0")',
            },
          },
          required: ['library'],
        },
      },
      {
        name: 'list_installed_libraries',
        description: 'Lists all installed libraries either globally or for a specific project.',
        inputSchema: {
          type: 'object',
          properties: {
            projectDir: {
              type: 'string',
              description: 'Optional project directory (lists global libraries if not specified)',
            },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'list_boards': {
        const params = ListBoardsParamsSchema.parse(args);
        const boards = await listBoards(params.filter);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(boards, null, 2),
            },
          ],
        };
      }

      case 'get_board_info': {
        const params = GetBoardInfoParamsSchema.parse(args);
        const board = await getBoardInfo(params.boardId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(board, null, 2),
            },
          ],
        };
      }

      case 'list_devices': {
        const devices = await listDevices();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(devices, null, 2),
            },
          ],
        };
      }

      case 'init_project': {
        const params = InitProjectParamsSchema.parse(args);
        const result = await initProject(params);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'build_project': {
        const params = BuildProjectParamsSchema.parse(args);
        const result = await buildProject(params.projectDir, params.environment);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'clean_project': {
        const params = CleanProjectParamsSchema.parse(args);
        const result = await cleanProject(params.projectDir);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'upload_firmware': {
        const params = UploadFirmwareParamsSchema.parse(args);
        const result = await uploadFirmware(params.projectDir, params.port, params.environment);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'upload_filesystem': {
        const params = UploadFilesystemParamsSchema.parse(args);
        const result = await uploadFilesystem(params.projectDir, params.port, params.environment);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'start_monitor': {
        const params = StartMonitorParamsSchema.parse(args);
        const result = await startMonitor(params.port, params.baud, params.projectDir);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'search_libraries': {
        const params = SearchLibrariesParamsSchema.parse(args);
        const libraries = await searchLibraries(params.query, params.limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(libraries, null, 2),
            },
          ],
        };
      }

      case 'install_library': {
        const params = InstallLibraryParamsSchema.parse(args);
        const result = await installLibrary(params.library, {
          projectDir: params.projectDir,
          version: params.version,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_installed_libraries': {
        const params = ListInstalledLibrariesParamsSchema.parse(args);
        const libraries = await listInstalledLibraries(params.projectDir);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(libraries, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = formatPlatformIOError(error);
    return {
      content: [
        {
          type: 'text',
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
    console.error('Warning: PlatformIO CLI not found. Please install it from https://platformio.org/install/cli');
    console.error('The server will start but commands will fail until PlatformIO is installed.\n');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('PlatformIO MCP Server running on stdio');
  console.error('Server supports 1000+ boards across 30+ platforms');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
