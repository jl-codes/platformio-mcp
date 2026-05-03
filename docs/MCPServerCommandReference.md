# MCP Server Command Reference

This document serves as the definitive reference for all tools exposed by the PlatformIO MCP Server.

## Command Index

| Command | Description |
|---|---|
| **Board Discovery** | |
| [`list_boards`](#list_boards) | Lists all available PlatformIO boards with optional filtering by platform, framework, or MCU. |
| [`get_board_info`](#get_board_info) | Gets detailed information about a specific board including MCU, frequency, flash, RAM, and supported frameworks. |
| **Device Management** | |
| [`list_devices`](#list_devices) | Lists all connected serial devices that can be used for firmware upload and monitoring. |
| **Project Operations** | |
| [`init_project`](#init_project) | Initializes a new PlatformIO project with the specified board and optional framework. |
| [`get_project_config`](#get_project_config) | Dumps `platformio.ini` JSON. |
| [`system_info`](#system_info) | Gets sys diagnostic path output. |
| **Build and Upload** | |
| [`build_project`](#build_project) | Compiles the project source code and generates firmware binary. |
| [`clean_project`](#clean_project) | Removes build artifacts and compiled files from the project. |
| [`upload_firmware`](#upload_firmware) | Uploads compiled firmware to a connected device. |
| [`upload_filesystem`](#upload_filesystem) | Builds and uploads a SPIFFS/LittleFS filesystem image to the connected device. |
| [`check_task_status`](#check_task_status) | Polls the status of an ongoing background build or upload task. |
| **Testing and Analysis** | |
| [`check_project`](#check_project) | Static analysis validation. |
| [`run_tests`](#run_tests) | Validates unit tests locally/remote. |
| **Hardware Locking** | |
| [`acquire_lock`](#acquire_lock) | Explicitly claim the hardware queue lock for multi-step tasks. |
| [`release_lock`](#release_lock) | Release the explicit queue lock matching your session ID. |
| [`get_lock_status`](#get_lock_status) | Reveals who currently owns the hardware queue lock. |
| [`reset_server_state`](#reset_server_state) | Forcefully cleans all server locks and terminates any tracked daemon or compilation PIDs globally or locally. |
| **Serial Monitor** | |
| [`start_monitor`](#start_monitor) | Manually start or restart the background serial-to-disk spooler for a specific device. |
| [`stop_monitor`](#stop_monitor) | Kills the active background serial listener and unlocks the UART. |
| [`query_logs`](#query_logs) | Scans the latest active background serial trace spool, returning a filtered string block. |
| **Library Management** | |
| [`search_libraries`](#search_libraries) | Searches the PlatformIO library registry for available libraries by name, keywords, or description. |
| [`install_library`](#install_library) | Installs a library from the PlatformIO registry to a specific project boundary. |
| [`list_installed_libraries`](#list_installed_libraries) | Lists all installed libraries for a specific project boundary. |
| [`uninstall_library`](#uninstall_library) | Removes target library. |
| [`update_library`](#update_library) | Upgrades library versions. |
| **Diagnostics/Dashboard** | |
| [`get_dashboard_url`](#get_dashboard_url) | Retrieves the address and auth token for the MCP Web Dashboard. |

## Board Discovery

### `list_boards`
- **Description:** Lists all available PlatformIO boards with optional filtering by platform, framework, or MCU. Supports 1000+ boards across 30+ platforms.
- **Underlying PIO Command:** `pio boards`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filter` | string | no | Optional filter by platform (e.g., "espressif32"), framework (e.g., "arduino"), or MCU name |
- **Returns:** JSON array of board objects.

- **Usage Example:**

**Prompt your agent:**
> "Find the right board ID for an esp32."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "list_boards",
  "arguments": {
    "filter": "esp32"
  }
}
```


- **Return Example:**

```json
[
  {
    "id": "esp32dev",
    "name": "Espressif ESP32 Dev Module",
    "platform": "espressif32",
    "mcu": "ESP32",
    "frameworks": ["arduino", "espidf"]
  }
]
```


- **Best Practices / Edge Cases:** Use broad queries when unsure of the exact board ID.

### `get_board_info`
- **Description:** Gets detailed information about a specific board including MCU, frequency, flash, RAM, and supported frameworks.
- **Underlying PIO Command:** `pio boards`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `boardId` | string | yes | Board ID (e.g., "esp32dev", "uno", "nucleo_f401re") |
- **Returns:** JSON object containing detailed board specifications.

- **Usage Example:**

**Prompt your agent:**
> "Get the hardware specifications for the esp32dev board."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "get_board_info",
  "arguments": {
    "boardId": "esp32dev"
  }
}
```


- **Return Example:**

```json
{
  "id": "esp32dev",
  "name": "Espressif ESP32 Dev Module",
  "platform": "espressif32",
  "mcu": "ESP32",
  "frameworks": ["arduino", "espidf"]
}
```


- **Best Practices / Edge Cases:** Use `list_boards` first to confirm the exact `boardId`.

## Device Management

### `list_devices`
- **Description:** Lists all connected serial devices that can be used for firmware upload and monitoring.
- **Underlying PIO Command:** `pio device list`
- **Parameters:** None
- **Returns:** JSON array of connected serial devices and their properties.

- **Usage Example:**

**Prompt your agent:**
> "List the serial ports currently connected to my computer."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "list_devices",
  "arguments": {}
}
```


- **Return Example:**

```json
[
  {
    "port": "/dev/cu.usbserial-1410",
    "description": "CP2102 USB to UART Bridge Controller",
    "hwid": "USB VID:PID=10C4:EA60 SNR=0001",
    "detectedBoard": "esp32dev"
  }
]
```


- **Best Practices / Edge Cases:** Call this before uploading or monitoring to discover the correct port dynamically.

## Project Operations

### `init_project`
- **Description:** Initializes a new PlatformIO project with the specified board and optional framework. Creates project structure with src/, include/, lib/, and test/ directories.
- **Underlying PIO Command:** `pio project init`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `board` | string | yes | Board ID for the project |
| `projectDir` | string | yes | Directory path where the project should be created |
| `framework` | string | no | Optional framework (e.g., "arduino", "espidf", "mbed") |
| `platformOptions` | object | no | Optional platform-specific configuration options |
- **Returns:** JSON object with initialization status and directory structure.

- **Usage Example:**

**Prompt your agent:**
> "Initialize a new PlatformIO project for the esp32dev board using the Arduino framework in my project directory."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "init_project",
  "arguments": {
    "board": "esp32dev",
    "projectDir": "/path/to/project",
    "framework": "arduino"
  }
}
```


- **Return Example:**

```json
{
  "success": true,
  "path": "/path/to/project",
  "message": "Project initialized successfully."
}
```


- **Best Practices / Edge Cases:** Ensure the `projectDir` path is accessible and writable.

### `get_project_config`
- **Description:** Dumps `platformio.ini` JSON.
- **Underlying PIO Command:** `pio project config`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectDir` | string | yes | Path to the PlatformIO project directory |
- **Returns:** JSON representation of the parsed `platformio.ini`.

- **Usage Example:**

**Prompt your agent:**
> "Read the configuration details from the platformio.ini file in my project directory."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "get_project_config",
  "arguments": {
    "projectDir": "/path/to/project"
  }
}
```


- **Return Example:**

```json
{
  "env:esp32dev": {
    "platform": "espressif32",
    "board": "esp32dev",
    "framework": "arduino"
  }
}
```


- **Best Practices / Edge Cases:** Useful for auditing project environments.

### `system_info`
- **Description:** Gets sys diagnostic path output.
- **Underlying PIO Command:** `pio system info`
- **Parameters:** None
- **Returns:** JSON object with system diagnostic paths and environment details.

- **Usage Example:**

**Prompt your agent:**
> "Check the system diagnostics and PlatformIO Core paths."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "system_info",
  "arguments": {}
}
```


- **Return Example:**

```json
{
  "core_dir": "/Users/user/.platformio",
  "core_version": "6.1.15",
  "python_version": "3.9.6",
  "system": "Darwin"
}
```


- **Best Practices / Edge Cases:** Useful for identifying PlatformIO Core installation issues.

## Build and Upload

### `build_project`
- **Description:** Compiles the project source code and generates firmware binary. Automatically downloads required toolchains and libraries on first build.
- **Underlying PIO Command:** `pio run`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectDir` | string | yes | Path to the PlatformIO project directory |
| `environment` | string | no | Optional specific environment to build from `platformio.ini`. If omitted, PIO aggregates and builds all `default_envs` (or all environments if none is default). |
| `sessionId` | string | no | Agent session ID for pipeline lock validation |
| `verbose` | boolean | no | If true, returns the complete verbose build log in the result instead of truncating it on success |
| `background` | boolean | no | If true, dispatches the compilation to the background and returns immediately to prevent MCP timeouts. You must poll status subsequently. |
- **Returns:** JSON object indicating success or failure. If `background: true`, returns a `taskId` .

- **Usage Example:**

**Prompt your agent:**
> "Compile my project firmware in the background."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "build_project",
  "arguments": {
    "projectDir": "/path/to/project",
    "background": true
  }
}
```


- **Return Example:**

```json
{
  "status": "running",
  "taskId": "task-1234-abcd",
  "logPaths": [
    ".pio-mcp-workspace/logs/build/task-1234-abcd.log"
  ],
  "message": "Build dispatched to background."
}
```


- **Best Practices / Edge Cases:** ALWAYS use `background: true` for large compilations.

### `clean_project`
- **Description:** Removes build artifacts and compiled files from the project.
- **Underlying PIO Command:** `pio run -t clean`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectDir` | string | yes | Path to the PlatformIO project directory |
| `sessionId` | string | no | Agent session ID for pipeline lock validation |
| `background` | boolean | no | Optional. If true, dispatches execution to the background. Defaults to `false` (synchronous execution). |
- **Returns:** JSON object indicating success. If `background: true` is passed, returns a `{ status: "running", taskId }` payload instead.

- **Usage Example (Default Synchronous):**

**Prompt your agent:**
> "Clean the build artifacts from my project directory."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "clean_project",
  "arguments": {
    "projectDir": "/path/to/project"
  }
}
```

- **Return Example (Synchronous):**

```json
{
  "success": true,
  "message": "Cleaned project successfully.",
  "status": "completed"
}
```


- **Best Practices / Edge Cases:** Use this before major framework updates or to clear corrupt state.

### `upload_firmware`
- **Description:** Uploads compiled firmware to a connected device. Automatically builds if necessary. Supports automatic port detection.
- **Underlying PIO Command:** `pio run -t upload`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectDir` | string | yes | Path to the PlatformIO project directory |
| `port` | string | no | Optional upload port (auto-detected if not specified) |
| `environment` | string | no | Optional specific environment. **HAZARD:** If omitted, PIO attempts to flash ALL default environments sequentially. Explicitly specify unless targeting a monolithic project. |
| `sessionId` | string | no | Agent session ID for pipeline lock validation |
| `verbose` | boolean | no | If true, returns the complete verbose upload log |
| `background` | boolean | no | If true, dispatches the upload to the background and returns immediately. |
| `start_monitor` | boolean | no | If true, automatically starts the background serial monitor after a successful upload, handling OS-level port re-enumeration. |
- **Returns:** JSON object with upload output and status. If `background: true`, returns `taskId` .

- **Usage Example:**

**Prompt your agent:**
> "Upload my compiled firmware to the connected device and start the serial monitor in the background."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "upload_firmware",
  "arguments": {
    "projectDir": "/path/to/project",
    "background": true,
    "start_monitor": true
  }
}
```


- **Return Example:**

```json
{
  "status": "running",
  "taskId": "task-upload-1234",
  "logPaths": [
    ".pio-mcp-workspace/logs/upload/task-upload-1234.log"
  ],
  "message": "Upload dispatched to background."
}
```


- **Best Practices / Edge Cases:** ALWAYS use `background: true`. Providing a specific `port` is safer if multiple devices are attached.

### `upload_filesystem`
- **Description:** Builds and uploads a SPIFFS/LittleFS filesystem image to the connected device. Automatically builds if necessary.
- **Underlying PIO Command:** `pio run -t uploadfs`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectDir` | string | yes | Path to the PlatformIO project directory |
| `port` | string | no | Optional upload port (auto-detected if not specified) |
| `environment` | string | no | Optional specific environment. **HAZARD:** If omitted, PIO sequentially flashes FS for ALL default environments. Explicitly specify target to prevent cross-flashing logic strings. |
| `sessionId` | string | no | Agent session ID for pipeline lock validation |
| `verbose` | boolean | no | If true, returns the complete verbose upload log |
| `background` | boolean | no | If true, dispatches the compilation to the background |
| `start_monitor` | boolean | no | If true, automatically starts the background serial monitor after successful upload. |
- **Returns:** JSON object indicating upload output and status. If `background: true`, returns `taskId` .

- **Usage Example:**

**Prompt your agent:**
> "Upload the SPIFFS filesystem image to my device in the background."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "upload_filesystem",
  "arguments": {
    "projectDir": "/path/to/project",
    "background": true
  }
}
```


- **Return Example:**

```json
{
  "status": "running",
  "taskId": "task-uploadfs-1234",
  "logPaths": [
    ".pio-mcp-workspace/logs/uploadfs/task-uploadfs-1234.log"
  ],
  "message": "Filesystem upload dispatched to background."
}
```


- **Best Practices / Edge Cases:** Ensure `data/` directory exists and has files before calling.

### `check_task_status`
- **Description:** Polls the status of an ongoing background build or upload task.
- **Underlying PIO Command:** None (Internal Server Task)
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `taskId` | string | no | Optional task ID to check status. |
- **Returns:** JSON object containing `status` (success of the polling operation), `targetStatus` (the current state of the background task: `running`, `completed`, `failed`), output log tail, and a `logPaths` string array.

- **Usage Example:**

**Prompt your agent:**
> "Check the status of my background build task."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "check_task_status",
  "arguments": {
    "taskId": "task-1234-abcd"
  }
}
```


- **Return Example:**

```json
{
  "status": "success",
  "targetStatus": "running",
  "output": "Compiling .pio/build/esp32dev/src/main.cpp.o...",
  "taskId": "task-1234-abcd",
  "logPaths": [
    ".pio-mcp-workspace/logs/build/task-1234-abcd.log"
  ]
}
```


- **Best Practices / Edge Cases:** Poll every few minutes. Ensure to release hardware queue locks after completion.

## Testing and Analysis

### `check_project`
- **Description:** Static analysis validation.
- **Underlying PIO Command:** `pio check`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectDir` | string | yes | Path to the PlatformIO project directory |
| `environment` | string | no | Specific environment to check |
| `background` | boolean | no | Run slow analysis in background |
- **Returns:** JSON object with static analysis output.

- **Usage Example:**

**Prompt your agent:**
> "Run a static analysis check on my project code."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "check_project",
  "arguments": {
    "projectDir": "/path/to/project"
  }
}
```


- **Return Example:**

```json
{
  "success": true,
  "output": "Checking cppcheck... \nNo defects found.",
  "status": "completed"
}
```


- **Best Practices / Edge Cases:** Useful before final validation of code logic.

### `run_tests`
- **Description:** Validates unit tests locally/remote.
- **Underlying PIO Command:** `pio test`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectDir` | string | yes | Path to the PlatformIO project directory |
| `sessionId` | string | no | Agent session ID for pipeline lock validation |
| `environment` | string | no | Specific environment to test |
| `background` | boolean | no | Run testing in background |
- **Returns:** JSON object with test suite results. If `background: true`, returns `taskId` .

- **Usage Example:**

**Prompt your agent:**
> "Run the unit tests for my project in the background."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "run_tests",
  "arguments": {
    "projectDir": "/path/to/project",
    "background": true
  }
}
```


- **Return Example:**

```json
{
  "status": "running",
  "taskId": "task-test-1234",
  "logPaths": [
    ".pio-mcp-workspace/logs/test/task-test-1234.log"
  ],
  "message": "Testing dispatched to background."
}
```


- **Best Practices / Edge Cases:** Set `background: true` if tests run on actual hardware and might take a long time.

## Hardware Locking

### `acquire_lock`
- **Description:** Explicitly claim the hardware queue lock for multi-step tasks. Throws if already held.
- **Underlying PIO Command:** None (Internal Server Lock)
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | Your active Session ID |
| `reason` | string | no | Reason for locking |
- **Returns:** JSON object confirming acquisition.

- **Usage Example:**

**Prompt your agent:**
> "Acquire the hardware queue lock so I can perform a multi-step flash operation safely."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "acquire_lock",
  "arguments": {
    "sessionId": "agent-123",
    "reason": "Uploading firmware and filesystem"
  }
}
```


- **Return Example:**

```json
{
  "success": true,
  "message": "Hardware queue lock acquired.",
  "sessionId": "agent-123"
}
```


- **Best Practices / Edge Cases:** Only claim this explicitly when chaining operations to prevent interference.

### `release_lock`
- **Description:** Release the explicit queue lock matching your session ID.
- **Underlying PIO Command:** None (Internal Server Lock)
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | Your active Session ID |
- **Returns:** JSON object confirming release.

- **Usage Example:**

**Prompt your agent:**
> "Release my hardware queue lock now that the operation is complete."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "release_lock",
  "arguments": {
    "sessionId": "agent-123"
  }
}
```


- **Return Example:**

```json
{
  "success": true,
  "message": "Hardware queue lock released."
}
```


- **Best Practices / Edge Cases:** ALWAYS call this when your background task finishes or fails if you supplied a `sessionId`.

### `get_lock_status`
- **Description:** Reveals who currently owns the hardware queue lock.
- **Underlying PIO Command:** None (Internal Server Lock)
- **Parameters:** None
- **Returns:** JSON object with the current lock owner and reason.

- **Usage Example:**

**Prompt your agent:**
> "Check who currently owns the hardware queue lock."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "get_lock_status",
  "arguments": {}
}
```


- **Return Example:**

```json
{
  "locked": true,
  "owner": "agent-123",
  "reason": "Uploading firmware and filesystem"
}
```


- **Best Practices / Edge Cases:** Use this to debug if a device seems unresponsive.

### `reset_server_state`
- **Description:** Forcefully cleans all server locks and terminates any tracked daemon or compilation PIDs globally or locally.
- **Underlying PIO Command:** None (Internal Server State Management)
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectDir` | string | no | Optional target directory for scoped cleanup. |
- **Returns:** JSON object indicating cleanup success.

- **Usage Example:**

**Prompt your agent:**
> "Reset the MCP server state and kill any stuck background processes."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "reset_server_state",
  "arguments": {}
}
```


- **Return Example:**

```json
{
  "success": true,
  "message": "Server state reset successfully. 1 active lock released. 1 background task terminated."
}
```


- **Best Practices / Edge Cases:** Run this if you are stuck or experience runaway PIDs.

## Serial Monitor

### `start_monitor`
- **Description:** Manually start or restart the background serial-to-disk spooler for a specific device.
- **Underlying PIO Command:** `pio device monitor`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `port` | string | no | Optional COM path. Falls back to default. |
| `baudRate` | number | no | Optional baud rate. Defaults to 115200. |
| `projectDir` | string | no | Target project boundary to deposit raw hardware logs into instead of the global server cache. |
| `environment` | string | no | Optional PlatformIO environment context. |
- **Returns:** JSON object with status.

- **Usage Example:**

**Prompt your agent:**
> "Start listening to the serial port at 115200 baud."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "start_monitor",
  "arguments": {
    "baudRate": 115200,
    "projectDir": "/path/to/project"
  }
}
```


- **Return Example:**

```json
{
  "success": true,
  "port": "/dev/cu.usbserial-1410",
  "baudRate": 115200,
  "message": "Serial monitor started successfully."
}
```


- **Best Practices / Edge Cases:** Logs are spooled to disk to avoid flooding context limits. Fetch them via `query_logs`.

### `stop_monitor`
- **Description:** Kills the active background serial listener and unlocks the UART.
- **Underlying PIO Command:** None (Internal Server Task)
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `port` | string | yes | COM port to stop listening on. |
| `projectDir` | string | no | Target project containing the workspace. |
- **Returns:** JSON object with status.

- **Usage Example:**

**Prompt your agent:**
> "Stop the background serial monitor on /dev/ttyUSB0."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "stop_monitor",
  "arguments": {
    "port": "/dev/ttyUSB0"
  }
}
```


- **Return Example:**

```json
{
  "success": true,
  "message": "Serial monitor stopped on /dev/cu.usbserial-1410."
}
```


- **Best Practices / Edge Cases:** Must be called to free the port for subsequent firmware uploads if it isn't automatically managed.

### `query_logs`
- **Description:** Scans the latest active background serial trace spool, returning a filtered string block.
- **Underlying PIO Command:** None (Internal Log Query)
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `lines` | number | no | Fetch this many tail lines from the end of the log (default: 100) |
| `searchPattern` | string | no | Optional Regex pattern to filter the spool for specific keywords. |
| `taskId` | string | no | Target standard task ID to retrieve logs for. |
| `port` | string | no | Specific COM port to query logs for. |
- **Returns:** String containing the latest log output.

- **Usage Example:**

**Prompt your agent:**
> "Fetch the last 50 lines of the serial monitor logs for my project task."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "query_logs",
  "arguments": {
    "taskId": "task-1234-abcd",
    "lines": 50
  }
}
```


- **Return Example:**

```json
"Rebooting...\n[12:34:56] Initializing Wi-Fi...\n[12:34:57] Connected to network." 
```


- **Best Practices / Edge Cases:** Use `searchPattern` to find specific anomalies without reading thousands of lines.

## Library Management

### `search_libraries`
- **Description:** Searches the PlatformIO library registry for available libraries by name, keywords, or description.
- **Underlying PIO Command:** `pio pkg search`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search query (library name, keyword, or description) |
| `limit` | number | no | Maximum number of results (default: 20) |
- **Returns:** JSON array of matching libraries.

- **Usage Example:**

**Prompt your agent:**
> "Search the registry for the ArduinoJson library."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "search_libraries",
  "arguments": {
    "query": "ArduinoJson",
    "limit": 5
  }
}
```


- **Return Example:**

```json
[
  {
    "id": 64,
    "name": "ArduinoJson",
    "description": "A simple and efficient JSON library for embedded C++.",
    "version": "6.21.3",
    "authors": [{"name": "Benoit Blanchon"}]
  }
]
```


- **Best Practices / Edge Cases:** Find exact registry IDs before installing.

### `install_library`
- **Description:** Installs a library from the PlatformIO registry either globally or to a specific project. Supports version specification.
- **Underlying PIO Command:** `pio pkg install`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `library` | string | yes | Library name or ID to install |
| `projectDir` | string | yes | Project directory (required to enforce workspace boundary compliance) |
| `version` | string | no | Optional specific version (e.g., "1.0.0", "^2.1.0") |
- **Returns:** JSON object confirming installation success.

- **Usage Example:**

**Prompt your agent:**
> "Install the ArduinoJson library into my project."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "install_library",
  "arguments": {
    "library": "ArduinoJson",
    "projectDir": "/path/to/project"
  }
}
```


- **Return Example:**

```json
{
  "success": true,
  "library": "ArduinoJson",
  "message": "Library installed successfully."
}
```


- **Best Practices / Edge Cases:** Explicitly declare library versions to ensure reproducible builds.

### `list_installed_libraries`
- **Description:** Lists all installed libraries either globally or for a specific project.
- **Underlying PIO Command:** `pio pkg list`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectDir` | string | yes | Project directory (required to enforce workspace boundary compliance) |
- **Returns:** JSON array of installed libraries.

- **Usage Example:**

**Prompt your agent:**
> "List all the libraries currently installed in my project."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "list_installed_libraries",
  "arguments": {
    "projectDir": "/path/to/project"
  }
}
```


- **Return Example:**

```json
[
  {
    "name": "ArduinoJson",
    "version": "6.21.3"
  }
]
```


- **Best Practices / Edge Cases:** Use this to verify a library has correctly registered.

### `uninstall_library`
- **Description:** Removes target library.
- **Underlying PIO Command:** `pio pkg uninstall`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `library` | string | yes | Library name or ID to uninstall |
| `projectDir` | string | yes | Project directory (required to enforce workspace boundary compliance) |
- **Returns:** JSON object confirming removal.

- **Usage Example:**

**Prompt your agent:**
> "Uninstall the ArduinoJson library from my project."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "uninstall_library",
  "arguments": {
    "library": "ArduinoJson",
    "projectDir": "/path/to/project"
  }
}
```


- **Return Example:**

```json
{
  "success": true,
  "library": "ArduinoJson",
  "message": "Library uninstalled successfully."
}
```


- **Best Practices / Edge Cases:** Clean out unused dependencies regularly.

### `update_library`
- **Description:** Upgrades library versions.
- **Underlying PIO Command:** `pio pkg update`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `library` | string | yes | Library name or ID to update |
| `projectDir` | string | yes | Project directory (required to enforce workspace boundary compliance) |
- **Returns:** JSON object confirming upgrade.

- **Usage Example:**

**Prompt your agent:**
> "Update the ArduinoJson library in my project to the latest version."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "update_library",
  "arguments": {
    "library": "ArduinoJson",
    "projectDir": "/path/to/project"
  }
}
```


- **Return Example:**

```json
{
  "success": true,
  "library": "ArduinoJson",
  "message": "Library updated successfully to 6.21.3."
}
```


- **Best Practices / Edge Cases:** Always rebuild code after library updates.

## Diagnostics/Dashboard

### `get_dashboard_url`
- **Description:** Retrieves the address and auth token for the MCP Web Dashboard. Automatically starts the web server on demand if offline.
- **Underlying PIO Command:** `pio home --no-open`
- **Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `open` | boolean | no | If true, automatically opens the authenticated GUI link natively in the system's browser. |
- **Returns:** JSON object with dashboard URL and auth token.

- **Usage Example:**

**Prompt your agent:**
> "Open the PlatformIO MCP web dashboard so I can see the compilation telemetry."

When you execute a prompt like this, your agent will typically make the following MCP call:

```json
{
  "name": "get_dashboard_url",
  "arguments": {
    "open": true
  }
}
```


- **Return Example:**

```json
{
  "url": "http://localhost:3000",
  "token": "abc123xyz"
}
```


- **Best Practices / Edge Cases:** Use this to surface the observability UI to the human user automatically.
