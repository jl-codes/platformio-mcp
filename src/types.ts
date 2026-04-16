/**
 * Global Type Definitions
 * Type definitions and Zod schemas for PlatformIO MCP Server.
 *
 * Provides:
 * - CommandResult: Execution stdout/stderr schema.
 * - BoardInfo: Detailed board specification parameters.
 * - SerialDevice: Detected serial port schema.
 * - ProjectConfig: Project initialization shape.
 * - BuildResult: Build status structure.
 * - UploadConfig: Upload execution parameters.
 * - MonitorConfig: Serial monitor options.
 * - LibraryInfo: PlatformIO registry library metadata.
 */

import { z } from "zod";

// ============================================================================
// Command Result Types
// ============================================================================

/**
 * Represents the standard output and exit status of a CLI command execution.
 */
export interface CommandResult {
  stdout: string; // The standard output string from the process
  stderr: string; // The standard error string from the process
  exitCode: number; // The process exit code (0 typically indicates success)
}

// ============================================================================
// Board Types
// ============================================================================

/**
 * Detailed specification parameters for a single PlatformIO development board.
 */
export interface BoardInfo {
  id: string; // Internal PlatformIO board identifier (e.g., 'esp32dev')
  name: string; // Human-readable name of the board
  platform: string; // Platform identifier (e.g., 'espressif32')
  mcu: string; // Microcontroller unit model
  frequency?: string; // Optional CPU frequency string with units
  flash?: number; // Optional RAM size in bytes
  ram?: number; // Optional RAM size in bytes
  fcpu?: number; // Optional CPU frequency in Hz
  rom?: number; // Optional ROM size in bytes
  frameworks?: string[]; // List of supported software frameworks (e.g., 'arduino', 'espidf')
  vendor?: string; // Board manufacturer or vendor
  url?: string; // URL to the board's documentation or landing page
}

/**
 * Zod schema for validating BoardInfo objects.
 */
export const BoardInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: z.string(),
  mcu: z.string(),
  frequency: z.string().optional(),
  flash: z.number().optional(),
  ram: z.number().optional(),
  fcpu: z.number().optional(),
  rom: z.number().optional(),
  frameworks: z.array(z.string()).optional(),
  vendor: z.string().optional(),
  url: z.string().optional(),
});

/**
 * Zod schema for an array of BoardInfo objects, typically from 'pio boards --json-output'.
 */
export const BoardsArraySchema = z.array(BoardInfoSchema);

// ============================================================================
// Device Types
// ============================================================================

/**
 * Metadata for a detected serial deviceport.
 */
export interface SerialDevice {
  port: string; // The OS-level device path (e.g., '/dev/cu.usbserial-1410')
  description: string; // Human-readable description of the device
  hwid: string; // Hardware ID string for port identification
  detectedBoard?: string; // Optional detected board identifier if PlatformIO recognized it
}

/**
 * Zod schema for validating SerialDevice objects.
 */
export const SerialDeviceSchema = z.object({
  port: z.string(),
  description: z.string(),
  hwid: z.string(),
  detectedBoard: z.string().optional(),
});

/**
 * Zod schema for an array of SerialDevice objects, typically from 'pio device list --json-output'.
 */
export const DevicesArraySchema = z.array(SerialDeviceSchema);

// ============================================================================
// Project Types
// ============================================================================

/**
 * Configuration for initializing a new PlatformIO project.
 */
export interface ProjectConfig {
  board: string; // Target board identifier
  framework?: string; // Optional framework (e.g., 'arduino', 'espidf')
  projectDir?: string; // Root directory where the project should be created
  platformOptions?: Record<string, string>; // Optional key-value overrides for platform settings
}

export const ProjectConfigSchema = z.object({
  board: z.string().min(1, "Board ID is required"),
  framework: z.string().optional(),
  projectDir: z.string().optional(),
  platformOptions: z.record(z.string(), z.string()).optional(),
});

export interface ProjectInitResult {
  success: boolean;
  path: string;
  message: string;
}

// ============================================================================
// Build Types
// ============================================================================

/**
 * Outcome of a project build execution.
 */
export interface BuildResult {
  success?: boolean; // Indicates if the build completed without errors
  environment?: string; // The environment identifier that was targeted
  output?: string; // Full stdout log from the compilation process
  errors?: string[]; // List of extracted error messages from stderr if build failed
  ramUsageBytes?: number; // Total RAM usage in bytes as reported by PIO
  flashUsageBytes?: number; // Total Flash usage in bytes as reported by PIO
  status?: string; // e.g. "running" if background=true
  message?: string;
  pid?: number;
}

export interface CleanResult {
  success?: boolean;
  message?: string;
  status?: string;
  pid?: number;
}

// ============================================================================
// Upload Types
// ============================================================================

export interface UploadConfig {
  projectDir: string;
  port?: string;
  environment?: string;
}

export const UploadConfigSchema = z.object({
  projectDir: z.string().min(1, "Project directory is required"),
  port: z.string().optional(),
  environment: z.string().optional(),
});

/**
 * Outcome of a firmware or filesystem upload execution.
 */
export interface UploadResult {
  success?: boolean; // Indicates if the upload completed without errors
  port?: string; // The serial port used for the upload
  output?: string; // Full stdout log from the upload process
  errors?: string[]; // List of extracted error messages from stderr if upload failed
  status?: string;
  message?: string;
  pid?: number;
}


// ============================================================================
// Library Types
// ============================================================================

export interface LibraryAuthor {
  name: string;
  email?: string;
  maintainer?: boolean;
}

export interface LibraryRepository {
  type: string;
  url: string;
}

/**
 * Metadata for a library from the PlatformIO Registry.
 */
export interface LibraryInfo {
  id?: number; // Registry-assigned numerical library ID
  name: string; // Library name
  description?: string; // Short description of library functionality
  keywords?: string[]; // Tags for registry discovery
  authors?: LibraryAuthor[]; // List of authors and maintainers
  repository?: LibraryRepository; // Source code repository location
  version?: string; // Latest available version string
  frameworks?: any[]; // List of compatible frameworks
  platforms?: any[]; // List of compatible platforms
  homepage?: string; // Offical project URL
}

export const LibraryInfoSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  authors: z
    .array(
      z.object({
        name: z.string(),
        email: z.string().optional(),
        maintainer: z.boolean().optional(),
      }),
    )
    .optional(),
  repository: z
    .object({
      type: z.string(),
      url: z.string(),
    })
    .optional(),
  version: z.string().optional(),
  frameworks: z.array(z.any()).optional(),
  platforms: z.array(z.any()).optional(),
  homepage: z.string().optional(),
});

export const LibrariesArraySchema = z.array(LibraryInfoSchema);
export const LibrariesObjectSchema = z.record(
  z.string(),
  z.array(LibraryInfoSchema),
);

/**
 * Schema for a paginated response from the library registry search API.
 */
export const LibrarySearchResponseSchema = z.object({
  searchQuery: z.string().optional(),
  total: z.number().optional(),
  page: z.number().optional(),
  items: z.array(LibraryInfoSchema),
});

export interface LibrarySearchConfig {
  query: string;
  limit?: number;
}

export const LibrarySearchConfigSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  limit: z.number().positive().optional(),
});

export interface LibraryInstallConfig {
  library: string;
  projectDir?: string;
  version?: string;
}

export const LibraryInstallConfigSchema = z.object({
  library: z.string().min(1, "Library name is required"),
  projectDir: z.string().optional(),
  version: z.string().optional(),
});

export interface LibraryInstallResult {
  success: boolean;
  library: string;
  message: string;
}

// ============================================================================
// Platform Types
// ============================================================================

export interface PlatformInfo {
  name: string;
  title: string;
  version?: string;
  description?: string;
  homepage?: string;
  repository?: string;
  frameworks?: string[];
  packages?: string[];
}

// ============================================================================
// MCP Tool Parameter Schemas
// ============================================================================

// List boards parameters
export const ListBoardsParamsSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe("Optional filter by platform, framework, or MCU"),
});

// Hardware Lock parameters
export const AcquireLockParamsSchema = z.object({
  sessionId: z
    .string()
    .min(1)
    .describe(
      "Unique ID of the agent session acquiring the lock for a multi-step pipeline",
    ),
  reason: z
    .string()
    .optional()
    .describe("Reason for acquiring the lock (e.g., Task Name)"),
});

export const ReleaseLockParamsSchema = z.object({
  sessionId: z
    .string()
    .min(1)
    .describe("Unique ID of the agent session releasing the lock"),
});


// Get board info parameters
/**
 * Zod schema for get_board_info tool parameters.
 */
export const GetBoardInfoParamsSchema = z.object({
  boardId: z.string().min(1).describe("Board ID to retrieve information for"),
});

// Init project parameters
export const InitProjectParamsSchema = z.object({
  board: z.string().min(1).describe("Board ID for the project"),
  framework: z
    .string()
    .optional()
    .describe("Framework to use (e.g., arduino, espidf)"),
  projectDir: z
    .string()
    .describe("Directory path where the project should be created"),
  platformOptions: z
    .record(z.string(), z.string())
    .optional()
    .describe("Additional platform-specific options"),
});

// Build project parameters
export const BuildProjectParamsSchema = z.object({
  projectDir: z
    .string()
    .min(1)
    .describe("Path to the PlatformIO project directory"),
  environment: z
    .string()
    .optional()
    .describe("Specific environment to build (from platformio.ini)"),
  sessionId: z
    .string()
    .optional()
    .describe("Agent session ID for pipeline lock validation"),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "If true, returns the complete verbose build log in the result instead of truncating it on success",
    ),
  background: z
    .boolean()
    .optional()
    .describe("If true, dispatches the long-running compilation to the background and returns immediately to prevent MCP timeouts. You must poll status subsequently."),
});

// Clean project parameters
export const CleanProjectParamsSchema = z.object({
  projectDir: z
    .string()
    .min(1)
    .describe("Path to the PlatformIO project directory"),
  sessionId: z
    .string()
    .optional()
    .describe("Agent session ID for pipeline lock validation"),
  background: z
    .boolean()
    .optional()
    .describe("If true, dispatches the long-running compilation to the background and returns immediately to prevent MCP timeouts. You must poll status subsequently."),
});

// Upload firmware parameters
export const UploadFirmwareParamsSchema = z.object({
  projectDir: z
    .string()
    .min(1)
    .describe("Path to the PlatformIO project directory"),
  port: z
    .string()
    .optional()
    .describe("Upload port (auto-detected if not specified)"),
  environment: z
    .string()
    .optional()
    .describe("Specific environment to upload (from platformio.ini)"),
  sessionId: z
    .string()
    .optional()
    .describe("Agent session ID for pipeline lock validation"),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "If true, returns the complete verbose upload log in the result instead of truncating it",
    ),
  background: z
    .boolean()
    .optional()
    .describe("If true, dispatches the long-running compilation to the background and returns immediately to prevent MCP timeouts. You must poll status subsequently."),
});

// Upload filesystem parameters
export const UploadFilesystemParamsSchema = z.object({
  projectDir: z
    .string()
    .min(1)
    .describe("Path to the PlatformIO project directory"),
  port: z
    .string()
    .optional()
    .describe("Upload port (auto-detected if not specified)"),
  environment: z
    .string()
    .optional()
    .describe("Specific environment to upload (from platformio.ini)"),
  sessionId: z
    .string()
    .optional()
    .describe("Agent session ID for pipeline lock validation"),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "If true, returns the complete verbose upload log in the result instead of truncating it",
    ),
  background: z
    .boolean()
    .optional()
    .describe("If true, dispatches the long-running compilation to the background and returns immediately to prevent MCP timeouts. You must poll status subsequently."),
});


// Search libraries parameters
export const SearchLibrariesParamsSchema = z.object({
  query: z.string().min(1).describe("Search query for libraries"),
  limit: z
    .number()
    .optional()
    .default(20)
    .describe("Maximum number of results to return"),
});

// Install library parameters
export const InstallLibraryParamsSchema = z.object({
  library: z.string().min(1).describe("Library name or ID to install"),
  projectDir: z
    .string()
    .optional()
    .describe("Project directory (installs globally if not specified)"),
  version: z.string().optional().describe("Specific version to install"),
});

// List installed libraries parameters
/**
 * Zod schema for list_installed_libraries tool parameters.
 */
export const ListInstalledLibrariesParamsSchema = z.object({
  projectDir: z
    .string()
    .optional()
    .describe("Project directory (lists global libraries if not specified)"),
});

// Monitor parameters
export const StartMonitorParamsSchema = z.object({
  port: z.string().optional().describe("Optional serial port to monitor (auto-detected if not specified)"),
  baudRate: z.number().optional().describe("Baud rate for serial connection (defaults to 115200)"),
  projectDir: z.string().optional().describe("Optional project directory for workspace log storage"),
  environment: z.string().optional().describe("Optional PlatformIO environment context"),
});

export const StopMonitorParamsSchema = z.object({
  port: z.string().describe("Serial port to stop monitoring"),
  projectDir: z.string().optional().describe("Optional project directory containing the workspace logs"),
});

export const QueryLogsParamsSchema = z.object({
  lines: z.number().optional().describe("Number of tail lines to retrieve (default: 100)"),
  searchPattern: z.string().optional().describe("Optional Regex pattern to filter logs"),
  projectDir: z.string().optional().describe("Optional project directory containing the workspace logs"),
  port: z.string().optional().describe("Specific port to query logs for"),
});

export const CheckTaskStatusParamsSchema = z.object({
  projectDir: z.string().optional().describe("Optional project directory containing the workspace logs"),
});

