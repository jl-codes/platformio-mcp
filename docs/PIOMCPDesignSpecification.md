# Design Specification: Autonomous PlatformIO MCP Server

## Table of Contents

1. [Overview](#1-overview)
2. [Concurrency & Locking Architecture](#2-concurrency--locking-architecture)
3. [Object Hierarchy & Storage Strategy](#3-object-hierarchy--storage-strategy)
4. [Types](#4-types)
5. [Files](#5-files)
6. [Functions](#6-functions)
7. [Classes](#7-classes)
8. [Dependencies](#8-dependencies)
9. [Testing](#9-testing)
10. [Target MCP Tooling Configuration](#10-target-mcp-tooling-configuration)
11. [Historical Architectural Decision Records](#11-historical-architectural-decision-records)

---

## 1. Overview

Create a board-agnostic MCP server that enables AI agents to interact with PlatformIO for embedded development across all supported platforms and boards. 

The baseline architecture serves as a universal bridge wrapping the PlatformIO CLI, providing access to 1,000+ embedded development boards and basic project orchestration. However, to operate within an autonomous AI agent environment without severe token-exhaustion or port collision issues, the architecture is structurally enhanced with **eight primary tenets** reflecting the finalized V2 architecture:

1. **Token-Optimized Build Pipeline:** Stripping verbose GCC output on successful compilations and returning strictly structured metrics (RAM/Flash).
2. **Intelligent Diagnostics:** Capturing full linker/compiler dumps upon failure, and routing them through regex matchers to isolate the exact cause.
3. **In-Memory & Hardware Queue Lock Semaphores:** Enforcing sequential access to physical `tty` ports using an internal Singleton, preventing `Upload` failures and bypassing host OS file-locking hacks. Uses `mcp_platformio_acquire_lock` to protect the compilation state.
4. **Active Bound-Time Serial Monitoring:** Reading serial logs directly within the Node.js server thread asynchronously.
5. **Universal Artifact Spooling:** Moving away from in-memory constraints to persistent file-based spooling. `stdout` streams and PIDs are stored cleanly in the `.pio-mcp-workspace/logs/` directory inside the active project folder, permitting robust offline debugging and flat directory mappings for any execution format.
6. **Telemetry Routing via UUIDs & CommandFeed:** Logging both build and monitor tasks into a single chronological feed using dynamic UUID `artifactId` mappings native across the `CommandRegistry` layer. Server Event streaming isolates identical logs via UUIDs so they do not multiplex via simple Project IDs anymore.
7. **Async Job Polling:** Bypassing strict LLM context timeouts using `background: true` on major operations, enabling agents to safely track execution state via the `check_task_status` resource.
8. **Secure Web Telemetry (React + Vite + Socket.io):** A fully opt-in, tokenized web dashboard (activated via the `--ui` manifest token or `PIO_MCP_UI=true` variable) to view real-time diagnostics securely. The UI enforces strict process isolation through a `PORTAL_AUTH_TOKEN` generated at boot, preventing unauthorized access.

---

## 2. Concurrency & Locking Architecture

To ensure atomic state stability across long-running autonomous processes and manual Web UI interactions, the system employs a strictly decoupled 2-Tier Locking mechanism. These queues must not be conflated.

1. **Hardware Queue Lock (Build Pipeline Locks):**
   * **Purpose:** Protects the *build process* codebase and compilation state. Ensures only one agent can mutate the project files, install dependencies, or trigger a compilation at a given time to guarantee deterministic build tests.
   * **Scope:** Managed explicitly (`mcp_platformio_acquire_lock`) or implicitly applied across operations like builds, library installations, or platform inits.
   * **Rule:** A monitor session or file read does NOT modify the build state and therefore does not need to acquire or respect the Hardware Queue Lock.

2. **Physical Port Semaphore (Serial Port Locks):**
   * **Purpose:** Protects the runtime access to physical `/dev/cu.*` serial endpoints. Minimized to the shortest timeframe possible to prevent OS-level DriverKit (`Resource busy`) collisions between `miniterm` serial polling and the `esptool.py` flasher.
   * **Scope:** Implicitly locked specifically when dropping firmware over the wire (flashing) or spawning a monitor daemon.
   * **Preemption Rules:** 
     * *Build/Upload Preemption:* A firmware upload operation **CAN** (and MUST) forcefully stop and clear any active monitor processes holding the physical port lock before it starts pushing bytes.
     * *Monitor Preemption:* A monitor request **MUST NOT** kill an active pipeline building/flashing firmware. It should be outright rejected with a "Port Busy" exception until the flash completes.

---

## 3. Object Hierarchy & Storage Strategy

The MCP server explicitly separates logical software contexts (Workspaces) from shared physical resources (Serial Ports). This division eliminates cross-workspace resource conflicts ("Access Denied" errors) and ensures predictable background process management.

```text
mcp-server (Global System: os.homedir() / %USERPROFILE% via ~/.platformio-mcp/)
│
├── workspaces.json               # Manifest of registered/active workspaces
├── server.log                    # internal logs
│
└── serial_ports/                 # global physical resources
    ├── dev_cu_usbserial.json     # lock record tracking physical status
    │     - status: "busy"
    │     - current_claim:
    │         - type: "monitor" | "upload"
    │         - owner_workspace: "/path/to/proj/"
    │         - owner_pid: 1234   # Enables atomic O(1) process preemption
    │         - timestamp
    └── ...

Workspaces (Project Local: [ProjectDir]/.pio-mcp-workspace/)
│
├── registry/
│   └── command_history.json      # Bounded chronological CommandFeed of unified commands (build/monitor)
│
├── tasks/
│   ├── active_tasks.json         # Active parallelizable processes (PIDs)
│   └── logs/                     # Universal task spool traces (e.g. build-UUID.log)
│
└── serial_monitors/
    ├── monitor-pids.json         # Tracked monitor background PIDs
    └── logs/                     # Saved serial tracing outputs via Universal Spooling
```

### Global vs Workspace Scopes
1. **Global Physical Resources (`~/.platformio-mcp/`)**: Because hardware operates strictly as a system-wide singleton, its semaphore mechanisms must be hoisted completely out of the project repository. Including the OS locking `pid` locally within these structured global locks allows for `O(1)` atomic process replacement, resolving conflicts even when processes were fired from completely detached workspaces.
2. **Project Local State (`.pio-mcp-workspace/`)**: Build queues, compiling, and specific serial logs are directly bound to the firmware code inside standard target repositories. 
   - **Command Registry (CommandFeed)**: The core chronological feed (`registry/command_history.json`) merges all async build and monitor events into a single appended timeline using UUIDs (`artifactId`), serving as the primary structured data source for the connected Web Portal UI.

---

## 4. Types

TypeScript interfaces and Zod schemas define the rigorous structured I/O for the MCP operations.

**Board Types:**
```typescript
interface BoardInfo {
  id: string; // e.g. "esp32dev"
  name: string;
  platform: string;
  mcu: string;
  frequency: string;
  flash: number;
  ram: number;
  frameworks?: string[];
  vendor?: string;
  url?: string;
}
```

**Device Types (Agentic Upgrade):**
```typescript
interface SerialDevice {
  port: string;
  description: string;
  hwid: string; // The raw VID:PID string
  detectedBoard?: string; // [UPGRADE] Human-readable mapping if a recognized VID:PID is found
}
```

**Project Types:**
```typescript
interface ProjectConfig {
  board: string;
  framework?: string;
  projectDir?: string;
  platformOptions?: Record<string, string>;
}
```

**Library Types:**
```typescript
interface LibraryInfo {
  id: number;
  name: string;
  description?: string;
  keywords?: string[];
  authors?: Array<{ name: string; email?: string }>;
  repository?: { type: string; url: string };
  version?: string;
  frameworks?: string[];
  platforms?: string[];
}
```

**Diagnostic Types (Agentic Upgrade):**
```typescript
interface DiagnosticSummary {
  errorType: 'MissingHeader' | 'MemoryOverflow' | 'PortBusy' | 'SyntaxError' | 'Unknown';
  summary: string;
  truncatedStderr: string;
}
```

**Execution Types (Agentic Upgrade):**
```typescript
interface BuildResult {
  success: boolean;
  environment: string;
  ramUsageBytes?: number;     // [UPGRADE] Extracted upon successful exitCode 0
  flashUsageBytes?: number;   // [UPGRADE] Extracted upon successful exitCode 0
  diagnostics?: DiagnosticSummary; // [UPGRADE] Supplied if exitCode != 0
  rawOutput?: string;         // Used only in fallback or verbose mode
  taskId?: string;            // [UPGRADE] Available when invoked with background: true
}

interface UploadResult {
  success: boolean;
  port?: string;
  diagnostics?: DiagnosticSummary; // [UPGRADE] Regex parsing for upload/port errors
  taskId?: string;                 // [UPGRADE] Available when invoked with background: true
}

interface MonitorResult {
  success: boolean;
  bufferOutput: string;      // [UPGRADE] Sampled log chunks natively read from port
  panicTriggered: boolean;   // [UPGRADE] True if ESP32 guru meditation/crash detected
}
```

---

## 5. Files

Create a modular TypeScript project structure with clear separation of concerns, augmented with our stateful autonomous features.

1. **`package.json`** - Project metadata, dependencies, scripts, and MCP server configuration.
2. **`tsconfig.json`** - TypeScript compiler configuration (ES2022, NodeNext, strict mode).
3. **`src/index.ts`** - Main entry point, stdio transport, tool registration.
4. **`src/types.ts`** - All TypeScript interfaces and Zod schemas.
5. **`src/platformio.ts`** - PlatformIO CLI wrapper, command execution, JSON parsing.
6. **`src/tools/boards.ts`** - MCP tools: `list_boards`, `get_board_info`.
7. **`src/tools/devices.ts`** - MCP tool: `list_devices`.
8. **`src/tools/projects.ts`** - MCP tool: `init_project`.
9. **`src/tools/build.ts`** - MCP tools: `build_project`, `clean_project`.
10. **`src/tools/upload.ts`** - MCP tool: `upload_firmware`.
11. **`src/tools/monitor.ts`** - MCP tool: active `serialport` reading tool (`read_serial`).
12. **`src/tools/libraries.ts`** - MCP tools: `search_libraries`, `install_library`, `list_installed_libraries`.
13. **`src/utils/validation.ts`** - Input path validation and sanitization.
14. **`src/utils/errors.ts`** - Custom error classes and formatting.
15. **`src/utils/diagnostics.ts`** - Contains C++/PlatformIO regex matchers.
16. **`src/utils/SerialManager.ts`** - Singleton tracking `tty` port states across operations.
17. **`src/utils/hardwareMaps.ts`** - Contains USB VID:PID dictionary to enrich hardware IDs.
18. **`src/utils/command-registry.ts`** - Manages the CommandFeed via dynamic UUID logic.
19. **`src/utils/spooler.ts`** - Handles universal artifact spooling to file streams.
20. **`README.md`** - Comprehensive documentation, usage examples, board-agnostic guide.
21. **`llms-install.md`** - AI-friendly installation guide for Antigravity, Cline, and other Agents.

---

## 6. Functions

Implement core functions for CLI execution, tool handlers, and utility operations.

**Core PlatformIO Module (`src/platformio.ts`):**
1. `execPioCommand(args: string[]): Promise<CommandResult>`
2. `parsePioJsonOutput<T>(output: string, schema: z.ZodSchema<T>): T`
3. `checkPlatformIOInstalled(): Promise<boolean>`

**Diagnostic & Hardware Utilities (Agentic Upgrades):**
4. `diagnoseError(stderr: string): DiagnosticSummary` - Iterates over REGEX dictionary to formulate context-aware C++ crash summaries.
5. `mapVidPidToBoard(hwid: string): string | undefined` - Resolves hardware names for the device list tool.

**Discovery Tools (`src/tools/boards.ts` & `src/tools/devices.ts`):**
6. `listBoards(filter?: string): Promise<BoardInfo[]>`
7. `getBoardInfo(boardId: string): Promise<BoardInfo>`
8. `listDevices(): Promise<SerialDevice[]>`

**Project Tools (`src/tools/projects.ts`):**
9. `initProject(config: ProjectConfig): Promise<{ success: boolean; path: string }>`

**Intelligent Execution (`src/tools/build.ts` & `src/tools/upload.ts`):**
10. `buildProject(projectDir: string, environment?: string): Promise<BuildResult>` - Parses RAM logs on success; invokes `diagnoseError()` on failure.
11. `cleanProject(projectDir: string): Promise<{ success: boolean }>`
12. `uploadFirmware(projectDir: string, port?: string, environment?: string): Promise<UploadResult>` - MUST execute `SerialManager.lockPort()` before compilation begins.

**Stateful Monitoring (`src/tools/monitor.ts`):**
13. `readSerial(port?: string, baud?: number, durationSeconds?: number): Promise<MonitorResult>` - Binds a Node.js `serialport` receiver. Buffers the output for `durationSeconds`, breaking early if `panicTriggered`.

**Library Tools (`src/tools/libraries.ts`):**
14. `searchLibraries(query: string): Promise<LibraryInfo[]>`
15. `installLibrary(libraryName: string, projectDir?: string): Promise<{ success: boolean }>`
16. `listInstalledLibraries(projectDir?: string): Promise<LibraryInfo[]>`

**Validation & Error Utilities (`src/utils/...`):**
17. `validateBoardId(boardId: string): boolean`
18. `validateProjectPath(path: string): string`
19. `sanitizeInput(input: string): string`
20. `formatPlatformIOError(error: unknown): string`

---

## 7. Classes

Implement MCP server class, tool handlers, and strict singleton locking.

**Main Orchestrators:**
1. `class PlatformIOServer`
2. `class PlatformIOExecutor`
3. `class BoardToolHandler`
4. `class ProjectToolHandler`
5. `class LibraryToolHandler`

**In-Memory Semaphore (Agentic Upgrade):**
6. **`class SerialManager`** (Singleton)
    * `Map<string, boolean> activeLocks`
    * `lockPort(port: string): void` (Throws `PortBusy` if already claimed)
    * `unlockPort(port: string): void`
    * `isLocked(port: string): boolean`

---

## 8. Dependencies

Install TypeScript, MCP SDK, and development tooling.

**Production Dependencies:**
* `@modelcontextprotocol/sdk@^0.5.0` - MCP server SDK with stdio transport.
* `zod@^3.22.0` - Runtime type validation and schema definition.
* **`serialport`** - Required for asynchronous Node.js monitoring tools natively in the server.
* **`socket.io`** & **`express`** - Powers the React/Vite web telemetry dashboard via `PORTAL_AUTH_TOKEN`.

**Development Dependencies:**
* `typescript`, `@types/node`, `tsx`, `vitest`, `@vitest/ui`, `prettier`, `eslint`, `@typescript-eslint/*`, `@types/serialport`.

---

## 9. Testing

Create comprehensive unit tests and integration test examples.

**Test Files:**
1. `tests/platformio.test.ts` - CLI execution, JSON parsing, installation checks.
2. `tests/tools/boards.test.ts` - Board listing and info retrieval.
3. `tests/tools/projects.test.ts` - Project init, build, upload operations (Ensure regex RAM/Flash stripping works).
4. `tests/tools/devices.test.ts` - Device listing and hardware VID/PID parsing.
5. `tests/tools/libraries.test.ts` - Library search, install, list.
6. `tests/validation.test.ts` - Input validation and sanitization.
7. `tests/integration/` - Manual testing guide with real hardware and loopback port testing for `SerialManager`.

---

## 10. Target MCP Tooling Configuration

### Rationale

The MCP server acts as an intelligent orchestration layer prioritizing semantic abstraction and robust error handling, rather than functioning as a direct 1:1 proxy for the PlatformIO CLI.

1. **Semantic Alignment:** Verbs are named to convey clear intent for language models (e.g., `build_project`, `start_monitor`, `check_project`) rather than mimicking CLI flags (`run`, `device_monitor`). Exposing generic commands like "run" forces LLMs to juggle complex flag logic. Instead, semantic verbs natively align with agent task planning.
2. **Hybrid UI Delegation:** Complex system exploration and dependency management (such as searching/installing libraries inside a UI form) are delegated to the native `pio home` dashboard. Inside the intelligent UI loop, the server focuses solely on executing programmable commands and capturing execution streams, dramatically saving custom UI redesign effort.
3. **Log Streaming / Bounded Lifecycles:** High-intensity operations (`pio test`, `pio check`, massive core updates) would normally exceed standard JSON-RPC HTTP timeout limits. The server requires natively dispatching these tools in the background by passing `background: true`, emitting raw stdout back to an observable frontend stream rather than holding the transaction loop open.

### Target MCP Verbs Table

| MCP Verb | Wrapping PIO Command | Description / Action | MCP Parameters | Streaming UI / Background Setup |
| :--- | :--- | :--- | :--- | :--- |
| `list_boards` | `pio boards` | Lists available boards. | `filter` (opt) | No |
| `get_board_info` | `pio boards` | Gets exact board specs. | `boardId` (req) | No |
| `list_devices` | `pio device list` | Lists serial ports and statuses. | None | No |
| `init_project` | `pio project init` | Scaffolds new PIO project. | `board` (req), `framework` (opt), `projectDir` (req) | No |
| `build_project` | `pio run` | Compiles project logic. | `projectDir` (req), `environment` (opt), `verbose` (opt), `background` (opt) | Yes (Long running) |
| `clean_project` | `pio run -t clean` | Clears local CLI cache. | `projectDir` (req), `background` (opt) | Yes (Existing) |
| `upload_firmware` | `pio run -t upload` | Flashes firmware to device. | `projectDir` (req), `port` (opt), `background` (opt), `start_monitor` (opt) | Yes (Existing) |
| `upload_filesystem`| `pio run -t uploadfs` | Flashes SPIFFS/LittleFS structure. | `projectDir` (req), `port` (opt), `background` (opt) | Yes (Existing) |
| `acquire_lock` | None (Internal) | Manually grabs global serial lock. | `sessionId` (req), `reason` (req) | No |
| `release_lock` | None (Internal) | Manually frees global serial lock. | `sessionId` (req) | No |
| `start_monitor` | `pio device monitor` | Connects serial background spooler. | `port` (opt), `baudRate` (opt), `projectDir` (req) | Yes (Native Buffer) |
| `stop_monitor` | `None` (Internal) | Terminates active spool. | `port` (req), `projectDir` (req) | No |
| `launch_pio_home` | `pio home --no-open` | Backgrounds native web console. | `open` (opt) | No |
| `get_project_config` | `pio project config` | Dumps platformio.ini JSON. | `projectDir` (req) | No |
| `system_info` | `pio system info` | Gets sys diagnostic path output. | None | No |
| `check_project` | `pio check` | Static analysis validation. | `projectDir` (req), `environment` (opt), `background` (opt) | **Yes** (Slow analysis) |
| `run_tests` | `pio test` | Validates unit tests locally/remote. | `projectDir` (req), `environment` (opt), `background` (opt) | **Yes** (Verbose output) |
| `search_libraries` | `pio pkg search` | Searches the PIO registry. | `query` (req), `limit` (opt) | No |
| `install_library` | `pio pkg install` | Installs a library globally/locally. | `library` (req), `projectDir` (opt), `version` (opt) | No |
| `list_installed_libraries` | `pio pkg list` | Lists installed dependencies. | `projectDir` (opt) | No |
| `uninstall_library`| `pio pkg uninstall` | Removes target library. | `library` (req), `projectDir` (opt) | No |
| `update_library` | `pio pkg update` | Upgrades library versions. | `library` (req), `projectDir` (opt) | No |
| `system_prune` | `pio system prune` | Cleans global tools cache. | `force` (bool, opt) | No |

### Deliberately Ignored / Deprecated PIO Commands

To keep the MCP strict, safe, and scoped to the embedded feedback loop, several `pio` core namespaces were strategically excluded. Additionally, PIO v6 deprecates multiple legacy namespaces:

1. **Deprecated Commands (PlatformIO v6)**: `pio lib`, `pio platform`, and `pio update` commands are officially deprecated in favor of the unified `pio pkg *` CLI interface. Using them is strongly discouraged.
2. **Cloud & Organization Tools (`pio access`, `pio account`, `pio org`, `pio team`)**: These tools govern PlatformIO registry authentication and cloud resource sharing. This is traditionally a human-centric setup action, entirely out of scope for a local development agent.
3. **CI Emulation (`pio ci`)**: While test suites are vital (hence `pio test`), `pio ci` simulates CI pipelines locally. Since the AI agent relies on direct source compilation (`pio run`), running simulated CI workflows is redundant overhead.
4. **Interactive Debugger (`pio debug`)**: Initiating GDB/OpenOCD targets over the wire via MCP is structurally incompatible with the current asynchronous command registry. Bridging native debugger breakpoints via a JSON-RPC textual interface is too complex for this phase of the server.
5. **Remote Orchestration (`pio remote`)**: Managing remote execution nodes is outside the domain of the local hardware orchestration we are solving for. 
6. **Global Adjustments (`pio settings`, `pio upgrade`)**: Operations that alter the host machine's physical PIO CLI global settings or upgrade the core binary (`upgrade`) introduce immense system stability risks if an agent triggers them during a hallucination. The server acts on project scopes, preventing dangerous global mutations.

---

## 11. Historical Architectural Decision Records

The following documents track early architectural evaluations and are preserved here as Historical Architectural Decision Records (ADRs):

- [Baseline Architecture Evaluation](archive/BaselineArchitectureEvaluation.md)
- [SmartEmbed Architecture Evaluation](archive/SmartEmbedArchitectureEvaluation.md)