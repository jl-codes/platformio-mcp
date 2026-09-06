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
  GetProjectConfigParamsSchema,
  GetProjectContextParamsSchema,
  CheckProjectParamsSchema,
  RunTestsParamsSchema,
  UninstallLibraryParamsSchema,
  UpdateLibraryParamsSchema,
  AgentValidateProjectParamsSchema,
  AgentBuildDiagnoseParamsSchema,
  AgentSafePinAuditParamsSchema,
  AgentFlashMonitorVerifyParamsSchema,
  AgentGetLastReportParamsSchema,
  AgentGenerateBoardReportParamsSchema,
  GetPolicyStatusParamsSchema,
  AgentResolveTargetParamsSchema,
  GetMonitorStatusParamsSchema,
  CaptureSerialWindowParamsSchema,
  AgentMonitorHealthParamsSchema,
  CancelTaskParamsSchema,
  ListTaskHistoryParamsSchema,
  GetApprovalRequestParamsSchema,
  ListPendingApprovalsParamsSchema,
} from "./types.js";
import {
  registerCommand,
  updateCommandStatus,
} from "./utils/command-registry.js";
import { mcpContext } from "./utils/mcp-context.js";
import { addWorkspace } from "./utils/workspace-registry.js";

// Import tool functions from feature modules
import { getBoardInfo } from "./tools/boards.js";
import {
  getProjectConfig,
  getSystemInfo,
  getProjectContext,
} from "./tools/projects.js";
import { cleanProject, checkProject, runTests } from "./tools/build.js";
import { uploadFilesystem } from "./tools/upload.js";
import {
  captureSerialWindow,
  getMonitorStatus,
  stopMonitor,
  queryLogs,
} from "./tools/monitor.js";
import { spoolLargeDataset } from "./utils/spooler.js";
import { listBoardsCore } from "./core/boards.js";
import { listDevicesCore } from "./core/devices.js";
import { initProjectCore } from "./core/project.js";
import { buildProjectCore } from "./core/build.js";
import { uploadFirmwareCore } from "./core/flash.js";
import { startMonitorCore } from "./core/monitor.js";
import {
  cancelTaskCore,
  checkTaskStatusCore,
  listTaskHistoryCore,
} from "./core/tasks.js";
import { getDashboardStatusCore } from "./core/dashboard.js";

import {
  searchLibraries,
  installLibrary,
  listInstalledLibraries,
  uninstallLibrary,
  updateLibrary,
} from "./tools/libraries.js";
import {
  agentBuildDiagnose,
  agentFlashMonitorVerify,
  agentGenerateBoardReport,
  agentGetLastReport,
  agentSafePinAudit,
  agentValidateProject,
  agentMonitorHealth,
} from "./tools/agent.js";
import { checkPlatformIOInstalled } from "./platformio.js";
import { formatPlatformIOError } from "./utils/errors.js";
import { hardwareLockManager } from "./utils/lock-manager.js";
import { killAllTrackedProcesses } from "./utils/process-manager.js";
import { GLOBAL_LOCKS_DIR } from "./utils/paths.js";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { logDiagnostic as logDiag } from "./utils/logger.js";
import { portalEvents } from "./api/events.js";
import crypto from "node:crypto";
import { evaluatePolicy } from "./core/policy/evaluate-policy.js";
import { getPolicyStatus } from "./core/policy/status.js";
import { resolveTarget, resolveWriteTarget } from "./core/target-resolution.js";
import {
  getApprovalRequestSummary,
  listPendingApprovalSummaries,
} from "./core/policy/approvals.js";
import {
  createToolErrorResult,
  createToolResult,
  ensureStructuredToolResult,
} from "./mcp/tool-result.js";
import {
  createToolRegistry,
  getRegisteredTool,
  listRegisteredTools,
  type ToolDefinition,
} from "./mcp/tool-registry.js";

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

const targetBindingInputSchema = {
  type: "object",
  description:
    "Short-lived exact target binding returned by agent_resolve_target.",
  properties: {
    digest: { type: "string", minLength: 64, maxLength: 64 },
    projectDir: { type: "string" },
    environment: { type: "string" },
    board: { type: "string" },
    port: { type: "string" },
    deviceFingerprint: { type: "string", minLength: 64, maxLength: 64 },
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
  },
  required: [
    "digest",
    "projectDir",
    "environment",
    "board",
    "port",
    "deviceFingerprint",
    "createdAt",
    "expiresAt",
  ],
} as const;

const automationKeyInputSchema = {
  type: "string",
  maxLength: 80,
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$",
  description:
    "Stable scheduled-run key. Supplying this activates unattended automation policy.",
} as const;

/**
 * REGISTER MCP TOOLS
 * Defines the metadata, descriptions, and input schemas for all tools
 * exposed by this server.
 */
const toolDefinitions: ToolDefinition[] = [
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
          description: 'Board ID (e.g., "esp32dev", "uno", "nucleo_f401re")',
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
          description: 'Optional framework (e.g., "arduino", "espidf", "mbed")',
        },
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
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
      "Compiles the project and generates the firmware binary via PlatformIO. PREFERRED over running `pio run` directly in a shell — this tool integrates with the hardware lock, the content-hash build cache (skips toolchain work when src/ is unchanged), and a structured-error parser that returns `structuredErrors` + `nextSteps` alongside the raw log. Returns immediately on a cache hit (no compilation). Set `verbose=true` only when you need the full log; otherwise the response stays compact. Use `background=true` for very long first-time builds to avoid MCP timeouts and poll with `check_task_status`.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
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
        verbose: {
          type: "boolean",
          description:
            "If true, returns the complete verbose build log in the result instead of truncating it on success",
        },
        background: {
          type: "boolean",
          description:
            "If true, dispatches the compilation to the background and returns immediately to prevent MCP timeouts. You must poll status subsequently.",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "clean_project",
    description: "Removes build artifacts and compiled files from the project.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        sessionId: {
          type: "string",
          description: "Agent session ID for pipeline lock validation",
        },
        background: {
          type: "boolean",
          description:
            "If true, dispatches the long-running execution to the background and returns immediately to prevent MCP timeouts. You must poll status subsequently.",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "upload_filesystem",
    description:
      "Builds and uploads a SPIFFS/LittleFS filesystem image to the connected device. PREFERRED over `pio run --target uploadfs` in a shell — same hardware-lock and port-auto-detect benefits as `upload_firmware`. Supports `start_monitor=true` to re-attach serial after upload.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        port: {
          type: "string",
          description: "Optional upload port (auto-detected if not specified)",
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
        background: {
          type: "boolean",
          description:
            "If true, dispatches the compilation to the background and returns immediately to prevent MCP timeouts. You must poll status subsequently.",
        },
        start_monitor: {
          type: "boolean",
          description:
            "If true, automatically starts the background serial monitor after a successful upload, handling OS-level port re-enumeration.",
        },
        targetBinding: targetBindingInputSchema,
        automationKey: automationKeyInputSchema,
        maxRunDurationSeconds: {
          type: "integer",
          minimum: 1,
          maximum: 900,
          description:
            "Required finite execution budget for an unattended write.",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "upload_firmware",
    description:
      "Uploads compiled firmware to a connected device. PREFERRED over `pio run --target upload` in a shell — this tool routes through the hardware lock to serialize port access, auto-detects the port, and (with `start_monitor=true`) re-attaches the serial monitor after the device re-enumerates. Automatically rebuilds via `build_project` semantics if the cache is cold.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        port: {
          type: "string",
          description: "Optional upload port (auto-detected if not specified)",
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
        background: {
          type: "boolean",
          description:
            "If true, dispatches the compilation to the background and returns immediately to prevent MCP timeouts. You must poll status subsequently.",
        },
        start_monitor: {
          type: "boolean",
          description:
            "If true, automatically starts the background serial monitor after a successful upload, handling OS-level port re-enumeration.",
        },
        targetBinding: targetBindingInputSchema,
        automationKey: automationKeyInputSchema,
        maxRunDurationSeconds: {
          type: "integer",
          minimum: 1,
          maximum: 900,
          description:
            "Required finite execution budget for an unattended write.",
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
    description: "Release the explicit queue lock matching your session ID.",
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
          description: "Search query (library name, keyword, or description)",
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
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        version: {
          type: "string",
          description: 'Optional specific version (e.g., "1.0.0", "^2.1.0")',
        },
        global: {
          type: "boolean",
          description:
            "If true, performs the operation globally. Defaults to false.",
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
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        global: {
          type: "boolean",
          description:
            "If true, performs the operation globally. Defaults to false.",
        },
      },
    },
  },
  {
    name: "start_monitor",
    description:
      "Manually start or restart the background serial-to-disk spooler for a specific device.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "string",
          description: "Optional COM path. Falls back to default.",
        },
        baudRate: {
          type: "number",
          description: "Optional baud rate. Defaults to 115200.",
        },
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        environment: {
          type: "string",
          description: "Optional PlatformIO environment context.",
        },
      },
    },
  },
  {
    name: "stop_monitor",
    description:
      "Kills the active background serial listener and unlocks the UART.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "string", description: "COM port to stop listening on." },
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
      },
      required: ["port"],
    },
  },
  {
    name: "query_logs",
    description:
      "Scans the latest active background serial trace spool, returning a filtered string block.",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description:
            "Fetch this many tail lines from the end of the log (default: 100)",
        },
        searchPattern: {
          type: "string",
          description:
            "Optional Regex pattern to filter the spool for specific keywords.",
        },
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        port: {
          type: "string",
          description: "Specific COM port to query logs for.",
        },
      },
    },
  },
  {
    name: "reset_server_state",
    description:
      "Forcefully cleans all server locks and terminates any tracked daemon or compilation PIDs globally or locally.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
      },
    },
  },
  {
    name: "check_task_status",
    description:
      "Polls the status of an ongoing background task. Returns a JSON object where `status` indicates the success of the polling operation itself, and `targetStatus` (running, failed, completed) indicates the state of the actual background task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Optional task ID to check status.",
        },
        logPath: {
          type: "string",
          description: "Optional relative log path to check.",
        },
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
      },
    },
  },
  {
    name: "get_dashboard_url",
    description:
      "Retrieves the address and auth token for the MCP Web Dashboard. Automatically starts the web server on demand if offline.",
    inputSchema: {
      type: "object",
      properties: {
        open: {
          type: "boolean",
          description:
            "If true, automatically opens the authenticated GUI link natively in the system's browser.",
        },
      },
    },
  },
  {
    name: "get_project_context",
    description:
      "Returns a compact pre-flight snapshot of a PlatformIO project: declared environments, source files under src/, `lib_deps`, build-cache state, firmware artifact path, connected serial devices, and a `nextSteps` checklist. Call this FIRST when starting work on a project instead of issuing several read_file/list_devices/cat-log calls — it collapses that ritual into a single deterministic response. Pure I/O, no toolchain invocation; safe to call repeatedly.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        includeBuildHistory: {
          type: "boolean",
          description:
            "If true, include the most recent build/upload status summary from the workspace log directory.",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "get_project_config",
    description: "Dumps platformio.ini JSON.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "agent_validate_project",
    description:
      "Agent-oriented pre-flight validation for a PlatformIO project. Reports environments, board IDs, source-file presence, config gaps, connected devices, and recommended next actions.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Path to the PlatformIO project directory.",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "agent_build_diagnose",
    description:
      "Runs build_project and returns rich structured diagnostics with error taxonomy, evidence, severity, retry-safety, and resource usage (RAM/Flash).",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Path to the PlatformIO project directory.",
        },
        environment: {
          type: "string",
          description: "Optional specific environment from platformio.ini.",
        },
        verbose: {
          type: "boolean",
          description: "If true, preserves verbose build output.",
        },
        background: {
          type: "boolean",
          description:
            "If true, dispatches build to background and returns a pending diagnostic status.",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "agent_safe_pin_audit",
    description:
      "Heuristic static pin audit for board-specific GPIO risks (ESP32 strapping/input-only/flash pins).",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Path to the PlatformIO project directory.",
        },
        boardId: {
          type: "string",
          description: "Target PlatformIO board ID.",
        },
      },
      required: ["projectDir", "boardId"],
    },
  },
  {
    name: "agent_flash_monitor_verify",
    description:
      "Builds (optionally), flashes firmware with monitor restart, then verifies runtime serial output against expected/rejected patterns and stability criteria.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Path to the PlatformIO project directory.",
        },
        environment: {
          type: "string",
          description: "Optional specific environment from platformio.ini.",
        },
        port: {
          type: "string",
          description: "Optional upload port.",
        },
        targetBinding: targetBindingInputSchema,
        automationKey: automationKeyInputSchema,
        maxRunDurationSeconds: {
          type: "integer",
          minimum: 1,
          maximum: 900,
          description:
            "Required finite execution budget for an unattended write.",
        },
        expect_all: {
          type: "array",
          items: { type: "string" },
          description: "Serial markers expected to appear.",
        },
        reject_patterns: {
          type: "array",
          items: { type: "string" },
          description: "Serial patterns that must not appear.",
        },
        timeoutSeconds: {
          type: "number",
          description: "Verification window in seconds (default 45).",
        },
        stabilityWindowSeconds: {
          type: "number",
          description: "Required quiet window in seconds (default 10).",
        },
        autoBuild: {
          type: "boolean",
          description:
            "If true, builds before flashing when firmware artifact is missing.",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "agent_get_last_report",
    description:
      "Returns the last persisted agent report from .pio-mcp-workspace/lastAgentReport.json.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Path to the PlatformIO project directory.",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "agent_generate_board_report",
    description:
      "Generates a compact board intelligence report and caches it in .pio-mcp-workspace/boardReport.json.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Path to the PlatformIO project directory.",
        },
        boardId: {
          type: "string",
          description: "Target PlatformIO board ID.",
        },
      },
      required: ["projectDir", "boardId"],
    },
  },
  {
    name: "get_policy_status",
    description:
      "Returns the active policy profile and allowed/approval-required/denied operations.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Optional project directory to resolve local policy profile context.",
        },
      },
    },
  },
  {
    name: "agent_resolve_target",
    description:
      "Resolves exactly one PlatformIO environment, board, and attached physical device. Returns ambiguity instead of guessing and issues a short-lived binding for write workflows.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Exact PlatformIO project directory.",
        },
        environment: {
          type: "string",
          description: "Optional declared PlatformIO environment.",
        },
        port: {
          type: "string",
          description: "Optional exact attached serial port.",
        },
        bindingTtlSeconds: { type: "integer", minimum: 30, maximum: 900 },
      },
      required: ["projectDir"],
    },
    annotations: {
      title: "Resolve PlatformIO Target",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_monitor_status",
    description:
      "Reports active, inactive, or stale serial monitor state with a bounded incremental cursor.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Optional exact PlatformIO project directory.",
        },
        port: { type: "string", description: "Optional exact serial port." },
      },
    },
    annotations: {
      title: "Inspect Serial Monitor",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "capture_serial_window",
    description:
      "Acquires a bounded serial-monitor lease, captures redacted incremental output, and restores or releases resources on every exit path.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string" },
        port: { type: "string" },
        environment: { type: "string" },
        baudRate: { type: "integer", minimum: 1, maximum: 2000000 },
        durationSeconds: { type: "integer", minimum: 1, maximum: 60 },
        maxBytes: { type: "integer", minimum: 256, maximum: 65536 },
        cursor: { type: "string", maxLength: 512 },
        targetBinding: targetBindingInputSchema,
        automationKey: automationKeyInputSchema,
      },
      required: ["projectDir"],
    },
    annotations: {
      title: "Capture Serial Window",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "agent_monitor_health",
    description:
      "Resolves one device, performs a bounded serial capture, evaluates health markers, and persists change-only automation state when automationKey is provided.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string" },
        environment: { type: "string" },
        port: { type: "string" },
        baudRate: { type: "integer", minimum: 1, maximum: 2000000 },
        captureDurationSeconds: { type: "integer", minimum: 1, maximum: 60 },
        maxBytes: { type: "integer", minimum: 256, maximum: 65536 },
        expectedMarkers: {
          type: "array",
          maxItems: 20,
          items: { type: "string", maxLength: 128 },
        },
        rejectedPatterns: {
          type: "array",
          maxItems: 20,
          items: { type: "string", maxLength: 128 },
        },
        automationKey: { type: "string", maxLength: 80 },
        cursor: { type: "string", maxLength: 512 },
        failureThreshold: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["projectDir"],
    },
    annotations: {
      title: "Evaluate Serial Health",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "cancel_task",
    description:
      "Idempotently cancels one known background task and releases only resources proven to be owned by that task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", maxLength: 128 },
        projectDir: { type: "string" },
      },
      required: ["taskId"],
    },
    annotations: {
      title: "Cancel PlatformIO Task",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "list_task_history",
    description:
      "Returns compact project-scoped task history after reconciling stale tracked processes.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        status: {
          type: "string",
          enum: ["inactive", "running", "success", "error", "terminated"],
        },
      },
      required: ["projectDir"],
    },
    annotations: {
      title: "List PlatformIO Tasks",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_approval_request",
    description:
      "Reads one approval request and expiry without exposing approve or deny mutations to the agent.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: { type: "string", maxLength: 128 },
        projectDir: { type: "string" },
      },
      required: ["approvalId"],
    },
    annotations: {
      title: "Inspect Approval Request",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "list_pending_approvals",
    description:
      "Lists pending project-scoped approval requests without exposing any approval mutation.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    annotations: {
      title: "List Pending Approvals",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "system_info",
    description: "Gets sys diagnostic path output.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "check_project",
    description: "Static analysis validation.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        environment: {
          type: "string",
          description: "Specific environment to check",
        },
        background: {
          type: "boolean",
          description: "Run slow analysis in background",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "run_tests",
    description: "Validates unit tests locally/remote.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        environment: {
          type: "string",
          description: "Specific environment to test",
        },
        background: {
          type: "boolean",
          description: "Run testing in background",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "uninstall_library",
    description: "Removes target library.",
    inputSchema: {
      type: "object",
      properties: {
        library: {
          type: "string",
          description: "Library name or ID to uninstall",
        },
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        global: {
          type: "boolean",
          description:
            "If true, performs the operation globally. Defaults to false.",
        },
      },
      required: ["library"],
    },
  },
  {
    name: "update_library",
    description: "Upgrades library versions.",
    inputSchema: {
      type: "object",
      properties: {
        library: {
          type: "string",
          description: "Library name or ID to update",
        },
        projectDir: {
          type: "string",
          description:
            "Path to the PlatformIO project directory. Agents SHOULD ALWAYS explicitly provide this to ensure operations execute in the correct workspace, unless explicitly instructed otherwise.",
        },
        global: {
          type: "boolean",
          description:
            "If true, performs the operation globally. Defaults to false.",
        },
      },
      required: ["library"],
    },
  },
];

const toolRegistry = createToolRegistry<any>(toolDefinitions);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: listRegisteredTools(toolRegistry) };
});

/**
 * TOOL EXECUTION HANDLER
 * Intercepts MCP tool calls, performs validation, manages hardware locks,
 * and calls the underlying business logic.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args: any = request.params.arguments || {};
  const registeredTool = getRegisteredTool(toolRegistry, name);
  if (args.projectDir) {
    portalEvents.emitWorkspaceState(args.projectDir);
  }

  const activityId = crypto.randomUUID();
  portalEvents.emitActivity(name, args, "running", activityId);

  // Group global commands into the currently active workspace UI if missing
  const targetProjectDir =
    args.projectDir || portalEvents.getLastKnownWorkspace();

  // Expose the MCP tool initiation to the Web UI ledger
  await registerCommand(
    {
      id: activityId,
      commandDesc: `MCP Tool: ${name}`,
      timestamp: Date.now(),
      status: "running",
      tasks: [],
      mcpRequest: args,
      mcpToolName: name,
    },
    targetProjectDir,
  );

  logDiag(
    `[Command Execution] Tool invoked: '${name}' with arguments: ${JSON.stringify(args)}`,
    targetProjectDir,
  );

  try {
    const policyDecision = await evaluatePolicy(
      registeredTool.policyAction,
      args,
      {
        workspaceDir: targetProjectDir,
        devicePort: typeof args.port === "string" ? args.port : undefined,
        taskId: activityId,
        actor: "agent",
        actorClass: args.automationKey ? "scheduled" : "interactive",
        automationKey:
          typeof args.automationKey === "string"
            ? args.automationKey
            : undefined,
        targetBindingDigest:
          typeof args.targetBinding?.digest === "string"
            ? args.targetBinding.digest
            : undefined,
      },
    );

    if (policyDecision.status !== "allow") {
      const policyResponse = {
        success: false,
        policyDecision,
      };
      const response = createToolErrorResult(policyDecision.reason, {
        status:
          policyDecision.status === "requires_approval"
            ? "blocked"
            : "failed",
        data: policyResponse,
        policyDecision,
        nextSteps:
          policyDecision.status === "requires_approval"
            ? [
                `Review approval request ${policyDecision.approvalId} in the dashboard or another trusted user interface.`,
              ]
            : undefined,
      });

      await updateCommandStatus(
        activityId,
        {
          status: "success",
          mcpResponse: policyResponse as any,
        },
        targetProjectDir,
      );

      portalEvents.emitActivity(name, args, "success", activityId);
      return response;
    }

    const legacyResponse = await mcpContext.run(
      { activityId, targetProjectDir },
      async () =>
        registeredTool.handler(args, {
          dispatch: async (registeredName, registeredArgs) => {
            const name = registeredName;
            const args: any = registeredArgs;
            switch (name) {
              case "list_boards": {
                const params = ListBoardsParamsSchema.parse(args);
                const boards = await listBoardsCore(params.filter);
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
                const devices = await listDevicesCore();
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
                const result = await initProjectCore(params);
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
                const result = await buildProjectCore({
                  projectDir: params.projectDir,
                  environment: params.environment,
                  verbose: params.verbose,
                  background: params.background,
                  sessionId: params.sessionId,
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

              case "clean_project": {
                const params = CleanProjectParamsSchema.parse(args);

                const executeTask = () =>
                  cleanProject(params.projectDir, params.background);
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
                const uploadTarget = await resolveWriteTarget({
                  projectDir: params.projectDir,
                  port: params.port,
                  environment: params.environment,
                  targetBinding: params.targetBinding,
                });

                const executeTask = () =>
                  uploadFilesystem(
                    params.projectDir,
                    uploadTarget.port,
                    uploadTarget.environment,
                    params.verbose,
                    params.background,
                    args.start_monitor,
                    params.maxRunDurationSeconds,
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
                const result = await uploadFirmwareCore({
                  projectDir: params.projectDir,
                  port: params.port,
                  environment: params.environment,
                  verbose: params.verbose,
                  background: params.background,
                  startMonitorAfter: args.start_monitor,
                  sessionId: params.sessionId,
                  targetBinding: params.targetBinding,
                  maxRunDurationSeconds: params.maxRunDurationSeconds,
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

              case "acquire_lock": {
                const params = AcquireLockParamsSchema.parse(args);
                hardwareLockManager.acquireLock(
                  params.sessionId,
                  params.reason,
                );
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
                const libraries = await searchLibraries(
                  params.query,
                  params.limit,
                );
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
                  projectDir: params.global ? undefined : targetProjectDir,
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
                const libraries = await listInstalledLibraries(
                  params.global ? undefined : targetProjectDir,
                );
                const spooled = spoolLargeDataset(
                  "list_installed_libraries",
                  libraries,
                  targetProjectDir || process.cwd(),
                );
                return {
                  content: [
                    {
                      type: "text",
                      text:
                        typeof spooled === "string"
                          ? spooled
                          : JSON.stringify(spooled, null, 2),
                    },
                  ],
                };
              }

              case "start_monitor": {
                const params = StartMonitorParamsSchema.parse(args);
                const result = await startMonitorCore({
                  port: params.port,
                  baudRate: params.baudRate,
                  projectDir: params.projectDir,
                  environment: params.environment,
                });
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "stop_monitor": {
                const params = StopMonitorParamsSchema.parse(args);
                await stopMonitor(params.port, params.projectDir);
                const result = {
                  success: true,
                  message: `Stopped monitor on ${params.port}`,
                };
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "query_logs": {
                const params = QueryLogsParamsSchema.parse(args);
                const result = await queryLogs(
                  params.lines,
                  params.searchPattern,
                  params.taskId,
                  params.logPath,
                  params.projectDir,
                  params.port,
                );
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
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
                  if (fs.existsSync(GLOBAL_LOCKS_DIR)) {
                    for (const file of fs.readdirSync(GLOBAL_LOCKS_DIR)) {
                      if (file.endsWith(".json") || file.endsWith(".lock")) {
                        fs.unlinkSync(path.join(GLOBAL_LOCKS_DIR, file));
                      }
                    }
                  }
                } catch (e) {
                  logDiag(`Failed to wipe semaphores: ${e}`, args.projectDir);
                }

                return {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(
                        {
                          success: true,
                          message:
                            "System state has been reset and all locks cleared.",
                        },
                        null,
                        2,
                      ),
                    },
                  ],
                };
              }

              case "check_task_status": {
                const params = CheckTaskStatusParamsSchema.parse(args);
                const result = await checkTaskStatusCore({
                  taskId: params.taskId,
                  logPath: params.logPath,
                  projectDir: params.projectDir,
                });
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "get_dashboard_url": {
                const params = GetDashboardUrlParamsSchema.parse(args);
                const result = await getDashboardStatusCore({
                  open: params.open,
                  projectDir: params.projectDir,
                });
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "get_project_config": {
                const params = GetProjectConfigParamsSchema.parse(args);
                const result = await getProjectConfig(params.projectDir);
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "get_project_context": {
                const params = GetProjectContextParamsSchema.parse(args);
                const result = await getProjectContext(
                  params.projectDir,
                  params.includeBuildHistory,
                );
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "agent_validate_project": {
                const params = AgentValidateProjectParamsSchema.parse(args);
                const result = await agentValidateProject(params.projectDir);
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "agent_build_diagnose": {
                const params = AgentBuildDiagnoseParamsSchema.parse(args);
                const result = await agentBuildDiagnose(
                  params.projectDir,
                  params.environment,
                  params.verbose,
                  params.background,
                );
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "agent_safe_pin_audit": {
                const params = AgentSafePinAuditParamsSchema.parse(args);
                const result = await agentSafePinAudit(
                  params.projectDir,
                  params.boardId,
                );
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "agent_flash_monitor_verify": {
                const params = AgentFlashMonitorVerifyParamsSchema.parse(args);
                const result = await agentFlashMonitorVerify({
                  projectDir: params.projectDir,
                  environment: params.environment,
                  port: params.port,
                  targetBinding: params.targetBinding,
                  expectAll: params.expect_all,
                  rejectPatterns: params.reject_patterns,
                  timeoutSeconds: params.timeoutSeconds,
                  stabilityWindowSeconds: params.stabilityWindowSeconds,
                  autoBuild: params.autoBuild,
                  maxRunDurationSeconds: params.maxRunDurationSeconds,
                });
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "agent_get_last_report": {
                const params = AgentGetLastReportParamsSchema.parse(args);
                const result = await agentGetLastReport(params.projectDir);
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "agent_generate_board_report": {
                const params = AgentGenerateBoardReportParamsSchema.parse(args);
                const result = await agentGenerateBoardReport(
                  params.projectDir,
                  params.boardId,
                );
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "get_policy_status": {
                const params = GetPolicyStatusParamsSchema.parse(args);
                const result = getPolicyStatus(params.projectDir);
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "agent_resolve_target": {
                const params = AgentResolveTargetParamsSchema.parse(args);
                const result = await resolveTarget(params);
                return createToolResult({
                  success: result.success,
                  status: result.success
                    ? "completed"
                    : result.status === "unavailable"
                      ? "unavailable"
                      : "blocked",
                  summary: result.summary,
                  data: result,
                  nextSteps: result.nextSteps,
                });
              }

              case "get_monitor_status": {
                const params = GetMonitorStatusParamsSchema.parse(args);
                const result = getMonitorStatus(params.port, params.projectDir);
                return createToolResult({
                  success: true,
                  status: "completed",
                  summary: params.port
                    ? `Retrieved monitor status for ${params.port}.`
                    : "Retrieved current serial monitor status.",
                  data: result,
                });
              }

              case "capture_serial_window": {
                const params = CaptureSerialWindowParamsSchema.parse(args);
                const result = await captureSerialWindow(params);
                return createToolResult({
                  success: true,
                  status: "completed",
                  summary: `Captured ${result.bytes} redacted serial bytes from ${result.port}.`,
                  data: result,
                  taskId: result.taskId,
                  logPaths: [result.logPath],
                });
              }

              case "agent_monitor_health": {
                const params = AgentMonitorHealthParamsSchema.parse(args);
                const result = await agentMonitorHealth(params);
                return createToolResult({
                  success: result.success,
                  status: result.success ? "completed" : "failed",
                  summary: `Serial health is ${result.health.status}; ${
                    result.shouldNotify
                      ? "reporting this state"
                      : "unchanged state is quiet"
                  }.`,
                  data: result,
                  nextSteps: [result.health.recommendedAction],
                });
              }

              case "cancel_task": {
                const params = CancelTaskParamsSchema.parse(args);
                const result = await cancelTaskCore(params);
                if (result.status === "not_found") {
                  return createToolErrorResult(
                    `Task '${params.taskId}' was not found.`,
                    {
                      status: "unavailable",
                      data: result,
                      nextSteps: [
                        "Call list_task_history with the exact project directory.",
                      ],
                    },
                  );
                }
                return createToolResult({
                  success: true,
                  status:
                    result.status === "cancelled" ? "cancelled" : "completed",
                  summary:
                    result.status === "cancelled"
                      ? `Cancelled task ${result.taskId}.`
                      : `Task ${result.taskId} was already terminal.`,
                  data: result,
                  taskId: result.taskId,
                });
              }

              case "list_task_history": {
                const params = ListTaskHistoryParamsSchema.parse(args);
                const result = await listTaskHistoryCore(params);
                return createToolResult({
                  success: true,
                  status: "completed",
                  summary: `Retrieved ${result.tasks.length} recent task record(s).`,
                  data: result,
                });
              }

              case "get_approval_request": {
                const params = GetApprovalRequestParamsSchema.parse(args);
                const approval = getApprovalRequestSummary(
                  params.approvalId,
                  params.projectDir,
                );
                if (!approval) {
                  return createToolErrorResult(
                    `Approval request '${params.approvalId}' was not found in this scope.`,
                    { status: "unavailable" },
                  );
                }
                return createToolResult({
                  success: true,
                  status: "completed",
                  summary: `Approval ${approval.id} is ${approval.status}.`,
                  data: approval,
                });
              }

              case "list_pending_approvals": {
                const params = ListPendingApprovalsParamsSchema.parse(args);
                const approvals = listPendingApprovalSummaries(params);
                return createToolResult({
                  success: true,
                  status: "completed",
                  summary: `Found ${approvals.length} pending approval request(s).`,
                  data: { approvals },
                });
              }

              case "system_info": {
                const result = await getSystemInfo();
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "check_project": {
                const params = CheckProjectParamsSchema.parse(args);
                const result = await checkProject(
                  params.projectDir,
                  params.environment,
                  params.background,
                );
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "run_tests": {
                const params = RunTestsParamsSchema.parse(args);
                const executeTask = () =>
                  runTests(
                    params.projectDir,
                    params.environment,
                    params.background,
                  );
                const result = params.sessionId
                  ? (hardwareLockManager.requireLock(params.sessionId),
                    await executeTask())
                  : await hardwareLockManager.withImplicitLock(executeTask);
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "uninstall_library": {
                const params = UninstallLibraryParamsSchema.parse(args);
                const result = await uninstallLibrary(
                  params.library,
                  params.global ? undefined : targetProjectDir,
                );
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              case "update_library": {
                const params = UpdateLibraryParamsSchema.parse(args);
                const result = await updateLibrary(
                  params.library,
                  params.global ? undefined : targetProjectDir,
                );
                return {
                  content: [
                    { type: "text", text: JSON.stringify(result, null, 2) },
                  ],
                };
              }

              default:
                throw new Error(`Unknown tool: ${name}`);
            }
          },
        }),
    );
    const response = ensureStructuredToolResult(name, legacyResponse);

    let storedResponse = response;
    try {
      const responseString = JSON.stringify(response);
      if (responseString.length > 1000) {
        storedResponse = {
          truncated: true,
          message: "Response truncated to save ledger space",
          preview: responseString.substring(0, 1000) + "... [TRUNCATED]",
        } as any;
      }
    } catch {}

    let isBackground = false;
    try {
      if (response?.content?.[0]?.text) {
        const parsed = JSON.parse(response.content[0].text);
        if (
          parsed.status === "running" &&
          parsed.message === "Task dispatched to background."
        )
          isBackground = true;
      }
    } catch {}

    await updateCommandStatus(
      activityId,
      {
        status: isBackground ? "running" : "success",
        mcpResponse: storedResponse,
      },
      targetProjectDir,
    );

    portalEvents.emitActivity(name, args, "success", activityId);

    if (args.projectDir) {
      await addWorkspace(args.projectDir).catch(() => {});
    }

    return response;
  } catch (error: any) {
    await updateCommandStatus(
      activityId,
      {
        status: "error",
        mcpResponse: { error: error.message },
      },
      targetProjectDir,
    );

    portalEvents.emitActivity(name, args, "error", activityId);

    const errorMessage = formatPlatformIOError(error);
    return createToolErrorResult(errorMessage);
  }
});

/**
 * Print CLI help text for the platformio-mcp binary.
 */
function printCliHelp() {
  console.log(`platformio-mcp — PlatformIO MCP server with web dashboard

USAGE:
  platformio-mcp                       Start MCP stdio server (default — for AI agents)
  platformio-mcp dashboard             Open the web dashboard in your browser
  platformio-mcp install --cline       Install into Cline (VS Code extension or CLI)
  platformio-mcp install --claude      Install into Claude Desktop
  platformio-mcp install --vscode      Install into VS Code native MCP support
  platformio-mcp install --antigravity Install into Google Antigravity
  platformio-mcp install --codex       Install into OpenAI Codex CLI
  platformio-mcp install --codex-plugin Install the full Codex Plugin and skills

FLAGS (when starting MCP server):
  --open-dashboard-on-start            Auto-open dashboard when agent connects
  --disable-dashboard                  Disable web dashboard entirely
  --help                               Show this help
  --version                            Print version

ENV VARS:
  PORTAL_PORT                          Override dashboard port (default: 8080)
  PIO_MCP_OPEN_DASH_ON_START           Same as --open-dashboard-on-start
  PIO_MCP_DISABLE_DASHBOARD            Same as --disable-dashboard
`);
}

// Start server
async function main() {
  // ---------------------------------------------------------------------------
  // CLI Subcommand Router

  // Dispatches BEFORE the MCP server boots. The default behavior (no subcommand)
  // is preserved: start the MCP stdio server for AI agents.
  // ---------------------------------------------------------------------------
  const cliArgs = process.argv.slice(2);
  const subcommand = cliArgs.find((a) => !a.startsWith("--"));

  if (cliArgs.includes("--help") || subcommand === "help") {
    printCliHelp();
    process.exit(0);
  }

  if (cliArgs.includes("--version") || subcommand === "version") {
    let version = "unknown";
    try {
      const currentDir = path.dirname(new URL(import.meta.url).pathname);
      const pkg = JSON.parse(
        fs.readFileSync(path.join(currentDir, "..", "package.json"), "utf8"),
      );
      version = pkg.version;
    } catch {}
    console.log(version);
    process.exit(0);
  }

  if (subcommand === "dashboard") {
    // Boot HTTP server, open browser, hold the event loop open via httpServer.
    const result = await getDashboardStatusCore({ open: true });
    console.log(`PlatformIO MCP Dashboard: ${result.secureLink}`);
    console.log(`Press Ctrl+C to stop.`);
    // Express http server keeps the event loop alive; SIGINT cleanup is wired
    // inside startPortalServer().
    return;
  }

  if (subcommand === "install") {
    const target = cliArgs.find((a) => a.startsWith("--"))?.replace(/^--/, "");
    if (!target) {
      console.error(
        "Usage: platformio-mcp install --<cline|claude|vscode|antigravity|codex|codex-plugin>",
      );
      process.exit(1);
    }
    try {
      // Resolve relative to the published package layout:
      //   <pkg-root>/build/index.js  ->  <pkg-root>/scripts/installers/index.js
      const currentDir = path.dirname(new URL(import.meta.url).pathname);
      const installerEntry = path.join(
        currentDir,
        "..",
        "scripts",
        "installers",
        "index.js",
      );
      const installerUrl = new URL(`file://${installerEntry}`).href;
      const { runInstaller } = await import(installerUrl);
      await runInstaller(target);
    } catch (e: any) {
      console.error(`Installer failed: ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (subcommand && subcommand !== "help") {
    console.error(`Unknown subcommand: ${subcommand}`);
    printCliHelp();
    process.exit(1);
  }

  // Fall through to default MCP stdio server boot
  // ---------------------------------------------------------------------------

  // Check if PlatformIO is installed
  let isInstalled = false;
  try {
    isInstalled = await checkPlatformIOInstalled();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logDiag(`Warning: PlatformIO availability check failed: ${message}`);
  }

  if (!isInstalled) {
    logDiag(
      "Warning: PlatformIO CLI not found. Please install it from https://platformio.org/install/cli",
    );
    logDiag(
      "The server will start but commands will fail until PlatformIO is installed.\n",
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Attempt to recover detached processes and history
  try {
    const { rehydrateMonitors } = await import("./tools/monitor.js");
    const { getWorkspaces } = await import("./utils/workspace-registry.js");

    await rehydrateMonitors();

    // Set UI target to the most recent workspace gracefully
    const workspaces = await getWorkspaces();
    if (workspaces.length > 0 && !portalEvents.getLastKnownWorkspace()) {
      portalEvents.emitWorkspaceState(workspaces[workspaces.length - 1]);
    }
  } catch (e) {
    logDiag(`[Server Reboot] Boot rehydration encountered an error: ${e}`);
  }

  if (
    process.argv.includes("--open-dashboard-on-start") ||
    process.env.PIO_MCP_OPEN_DASH_ON_START === "true"
  ) {
    getDashboardStatusCore({ open: true }).catch((e) =>
      logDiag(`[Dashboard] ${e.message}`),
    );
  }

  let gitHash = "unknown";
  try {
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    gitHash = execSync("git rev-parse --short HEAD", {
      cwd: currentDir,
      stdio: "pipe",
    })
      .toString()
      .trim();
  } catch {}

  let version = "1.0.0";
  try {
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(currentDir, "../package.json"), "utf8"),
    );
    version = pkg.version;
  } catch {}

  logDiag("\n\n=======================================================");
  logDiag(
    `🚀 PlatformIO MCP Server v${version} (Build: ${gitHash}) running on stdio`,
  );
  logDiag("🚀 Server supports 1000+ boards across 30+ platforms");
  logDiag("=======================================================\n");
}

main().catch(async (error) => {
  await logDiag(`Fatal error: ${error}`);
  process.exitCode = 1;
});
