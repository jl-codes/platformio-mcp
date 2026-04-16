# Design Specification: Autonomous PlatformIO MCP Server

## [Overview]

Create a board-agnostic MCP server that enables AI agents to interact with PlatformIO for embedded development across all supported platforms and boards. 

The baseline architecture serves as a universal bridge wrapping the PlatformIO CLI, providing access to 1,000+ embedded development boards and basic project orchestration. However, to operate within an autonomous AI agent environment (such as Google Antigravity) without severe token-exhaustion or port collision issues, the architecture is structurally enhanced with **four primary tenets**:

1. **Token-Optimized Build Pipeline:** Stripping verbose GCC output on successful compilations and returning strictly structured metrics (RAM/Flash).
2. **Intelligent Diagnostics:** Capturing full linker/compiler dumps upon failure, and routing them through regex matchers to isolate the exact cause, minimizing the payload size returned to the LLM. 
3. **In-Memory Serial Port Management:** Enforcing sequential access to physical `tty` ports using an internal Singleton, preventing `Upload` failures and bypassing host OS file-locking hacks.
4. **Active Bound-Time Serial Monitoring:** Reading serial logs directly within the Node.js server thread asynchronously, allowing automated system debugging.
5. **Persistent Workspace Spooling:** `stdout` streams and PIDs are stored cleanly in the `.pio-mcp-workspace/` directory inside the active project folder instead of aggressively managed in-memory, permitting simple offline debugging.
6. **Async Job Polling:** Bypassing strict LLM context timeouts using `background: true` on major operations, enabling agents to safely track execution state via the `check_task_status` resource.
7. **Secure Web Telemetry**: A fully opt-in, tokenized web dashboard (activated via the `--ui` manifest token or `PIO_MCP_UI=true` variable) to view real-time diagnostics securely.

---

## [Types]

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

## [Files]

Create a modular TypeScript project structure with clear separation of concerns, augmented with our stateful autonomous features.

1. **`package.json`** - Project metadata, dependencies, scripts, and MCP server configuration.
2. **`tsconfig.json`** - TypeScript compiler configuration (ES2022, NodeNext, strict mode).
3. **`src/index.ts`** - Main entry point, stdio transport, tool registration.
4. **`src/types.ts`** - All TypeScript interfaces and Zod schemas.
5. **`src/platformio.ts`** - PlatformIO CLI wrapper, command execution, JSON parsing.
6. **`src/tools/boards.ts`** - MCP tools: `list_boards`, `get_board_info`.
7. **`src/tools/devices.ts`** - MCP tool: `list_devices`.
8. **`src/tools/projects.ts`** - MCP tool: `init_project`.
9. **`src/tools/build.ts`** - **[MODIFIED]** MCP tools: `build_project`, `clean_project` (incorporates regex RAM/Flash stripping).
10. **`src/tools/upload.ts`** - **[MODIFIED]** MCP tool: `upload_firmware` (co-opts SerialManager mutex logic).
11. **`src/tools/monitor.ts`** - **[MODIFIED]** MCP tool: Replaces instructional string generation with active `serialport` reading tool (`read_serial`).
12. **`src/tools/libraries.ts`** - MCP tools: `search_libraries`, `install_library`, `list_installed_libraries`.
13. **`src/utils/validation.ts`** - Input path validation and sanitization.
14. **`src/utils/errors.ts`** - Custom error classes and formatting.
15. **`src/utils/diagnostics.ts`** - **[NEW]** Contains C++/PlatformIO regex matchers (Portions adapted from `@toponextech/smartembed-mcp-server` under MIT attribution) for categorizing build errors.
16. **`src/utils/SerialManager.ts`** - **[NEW]** Singleton tracking `tty` port states across operations.
17. **`src/utils/hardwareMaps.ts`** - **[NEW]** Contains USB VID:PID dictionary to enrich hardware IDs into human-readable board names.
18. **`README.md`** - Comprehensive documentation, usage examples, board-agnostic guide.
19. **`llms-install.md`** - AI-friendly installation guide for Antigravity, Cline, and other Agents.
20. **`.gitignore`** - Node.js/TypeScript ignores.
21. **`LICENSE`** - MIT License.
22. **`tests/platformio.test.ts`** - Unit tests for CLI wrapper.
23. **`tests/tools.test.ts`** - Unit tests for MCP tools.
24. **`.vscode/settings.json`** - VSCode workspace settings.

---

## [Functions]

Implement core functions for CLI execution, tool handlers, and utility operations.

**Core PlatformIO Module (`src/platformio.ts`):**
1. `execPioCommand(args: string[]): Promise<CommandResult>`
2. `parsePioJsonOutput<T>(output: string, schema: z.ZodSchema<T>): T`
3. `checkPlatformIOInstalled(): Promise<boolean>`

**Diagnostic & Hardware Utilities (Agentic Upgrades):**
4. **[NEW]** `diagnoseError(stderr: string): DiagnosticSummary` - Iterates over REGEX dictionary to formulate context-aware C++ crash summaries.
5. **[NEW]** `mapVidPidToBoard(hwid: string): string | undefined` - Resolves hardware names for the device list tool.

**Discovery Tools (`src/tools/boards.ts` & `src/tools/devices.ts`):**
6. `listBoards(filter?: string): Promise<BoardInfo[]>`
7. `getBoardInfo(boardId: string): Promise<BoardInfo>`
8. `listDevices(): Promise<SerialDevice[]>` - **[MODIFIED]** Cross-references hwid against hardwareMaps.ts database.

**Project Tools (`src/tools/projects.ts`):**
9. `initProject(config: ProjectConfig): Promise<{ success: boolean; path: string }>`

**Intelligent Execution (`src/tools/build.ts` & `src/tools/upload.ts`):**
10. `buildProject(projectDir: string, environment?: string): Promise<BuildResult>` - **[MODIFIED]** Silences native stdout. Parses RAM logs on success; invokes `diagnoseError()` on failure.
11. `cleanProject(projectDir: string): Promise<{ success: boolean }>`
12. `uploadFirmware(projectDir: string, port?: string, environment?: string): Promise<UploadResult>` - **[MODIFIED]** Validates targets securely. MUST execute `SerialManager.lockPort()` before compilation begins.

**Stateful Monitoring (`src/tools/monitor.ts`):**
13. `readSerial(port?: string, baud?: number, durationSeconds?: number): Promise<MonitorResult>` - **[MODIFIED]** Binds a Node.js `serialport` receiver. Buffers the output for `durationSeconds`, breaking early if `panicTriggered`.

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

## [Classes]

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

## [Dependencies]

Install TypeScript, MCP SDK, and development tooling.

**Production Dependencies:**
* `@modelcontextprotocol/sdk@^0.5.0` - MCP server SDK with stdio transport.
* `zod@^3.22.0` - Runtime type validation and schema definition.
* **`serialport`** - **[NEW]** Required for asynchronous Node.js monitoring tools natively in the server.

**Development Dependencies:**
* `typescript`, `@types/node`, `tsx`, `vitest`, `@vitest/ui`, `prettier`, `eslint`, `@typescript-eslint/*`, `@types/serialport`.

---

## [Testing]

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

## [Implementation Order]

We proceed on the assumption that the `jl-codes/platformio-mcp` base has been cloned and scaffolded natively in the project, giving us the Phase 1 base.

**Phase 1: Project Foundation & Baseline Integration**
1. Initialize npm project with package.json (Cloned via baseline repository).
2. Configure TypeScript with tsconfig.json.
3. Inject the new `serialport` dependencies into the package.

**Phase 2: Establish Muxing and Diagnostic Infrastructure**
4. Setup `src/types.ts` schemas.
5. Implement Validation and Error subclasses.
6. Create `src/utils/SerialManager.ts` to expose the lock singleton. 
7. Create `src/utils/hardwareMaps.ts` mapping database.
8. Create `src/utils/diagnostics.ts` containing the standard array of compiler regex filters and header checks. Include the mandatory MIT License header attribution.

**Phase 3: MCP Tools - Discovery & Libraries**
9. Implement Board and Library tools.
10. Refactor Device tools (`src/tools/devices.ts`) to merge `hardwareMaps.ts` resolutions.

**Phase 4: MCP Tools - Intelligent Execution**
11. Implement project init.
12. Modify `src/tools/upload.ts` to implement the `SerialManager` guards.
13. Modify `src/tools/build.ts` to truncate positive output streams to `BuildResult` objects. Connect failure clauses to `diagnoseError()`.
14. Rewrite `src/tools/monitor.ts` logic utilizing the robust `serialport` APIs. Wire in the `durationSeconds` polling capability and panic string listeners. 

**Phase 5: Server Integration**
15. Implement main server in `src/index.ts`.
16. Register all MCP tools with structured schemas.
17. Set up stdio transport and graceful shutdown handlers.

**Phase 6: Documentation**
18. Write comprehensive README.md and llms-install.md.
19. Document usage examples and troubleshooting workflows.

**Phase 7: Testing & Validation**
20. Execute full unit test suite via mock directories, validating the token-reduction payloads.
21. Manual integration testing on physical hardware.
22. Code quality linting and package build execution.