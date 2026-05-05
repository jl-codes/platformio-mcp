# PlatformIO MCP Agent Command Reference

This is a distilled reference designed specifically for AI agents. It contains the 26 tools provided by the PlatformIO MCP server, focusing entirely on required arguments, best practices, and edge cases. JSON schemas and parameter types are omitted here as they are automatically provided to you via your native MCP Tool Declarations.

## Command Index

| Command | Description |
|---|---|
| **Board Discovery** | |
| `list_boards` | Lists all available PlatformIO boards with optional filtering by platform, framework, or MCU. |
| `get_board_info` | Gets detailed information about a specific board. |
| **Device Management** | |
| `list_devices` | Lists all connected serial devices that can be used for firmware upload and monitoring. |
| **Project Operations** | |
| `init_project` | Initializes a new PlatformIO project. |
| `get_project_config` | Dumps `platformio.ini` JSON. |
| `system_info` | Gets sys diagnostic path output. |
| **Build and Upload** | |
| `build_project` | Compiles the project source code and generates firmware binary. |
| `clean_project` | Removes build artifacts and compiled files from the project. |
| `upload_firmware` | Uploads compiled firmware to a connected device. |
| `upload_filesystem` | Builds and uploads a SPIFFS/LittleFS filesystem image to the connected device. |
| `check_task_status` | Polls the status of an ongoing background build or upload task. |
| **Testing and Analysis** | |
| `check_project` | Static analysis validation. |
| `run_tests` | Validates unit tests locally/remote. |
| **Hardware Locking** | |
| `acquire_lock` | Explicitly claim the hardware queue lock for multi-step tasks. |
| `release_lock` | Release the explicit queue lock matching your session ID. |
| `get_lock_status` | Reveals who currently owns the hardware queue lock. |
| `reset_server_state` | Forcefully cleans all server locks and terminates any tracked daemon or compilation PIDs globally or locally. |
| **Serial Monitor** | |
| `start_monitor` | Manually start or restart the background serial-to-disk spooler for a specific device. |
| `stop_monitor` | Kills the active background serial listener and unlocks the UART. |
| `query_logs` | Scans the latest active background serial trace spool, returning a filtered string block. |
| **Library Management** | |
| `search_libraries` | Searches the PlatformIO library registry for available libraries by name, keywords, or description. |
| `install_library` | Installs a library from the PlatformIO registry to a specific project boundary. |
| `list_installed_libraries` | Lists all installed libraries for a specific project boundary. |
| `uninstall_library` | Removes target library. |
| `update_library` | Upgrades library versions. |
| **Diagnostics/Dashboard** | |
| `get_dashboard_url` | Retrieves the address and auth token for the MCP Web Dashboard. |

## Detailed Best Practices

### Board Discovery
- **`list_boards`**: Use broad queries (via `filter`) when unsure of the exact board ID.
- **`get_board_info`**: Use `list_boards` first to confirm the exact `boardId`.

### Device Management
- **`list_devices`**: Call this before uploading or monitoring to discover the correct port dynamically.

### Project Operations
- **`init_project`**: Requires `board` and `projectDir`. Ensure the `projectDir` path is accessible and writable.
- **`get_project_config`**: Requires `projectDir`. Useful for auditing project environments.
- **`system_info`**: Useful for identifying PlatformIO Core installation issues.

### Build and Upload
- **`build_project`**: Requires `projectDir`. ALWAYS use `background: true` for large compilations.
- **`clean_project`**: Requires `projectDir`. Use this before major framework updates or to clear corrupt state.
- **`upload_firmware`**: Requires `projectDir`. ALWAYS use `background: true`. Providing a specific `port` is safer if multiple devices are attached. **HAZARD:** If `environment` is omitted, PIO attempts to flash ALL default environments sequentially. Explicitly specify unless targeting a monolithic project.
- **`upload_filesystem`**: Requires `projectDir`. Ensure `data/` directory exists and has files before calling. **HAZARD:** If `environment` is omitted, PIO sequentially flashes FS for ALL default environments. Explicitly specify target to prevent cross-flashing logic strings.
- **`check_task_status`**: Poll every few minutes. Ensure to release hardware queue locks after completion.

### Testing and Analysis
- **`check_project`**: Requires `projectDir`. Useful before final validation of code logic.
- **`run_tests`**: Requires `projectDir`. Set `background: true` if tests run on actual hardware and might take a long time.

### Hardware Locking
- **`acquire_lock`**: Requires `sessionId`. Only claim this explicitly when chaining operations to prevent interference.
- **`release_lock`**: Requires `sessionId`. ALWAYS call this when your background task finishes or fails if you supplied a `sessionId`.
- **`get_lock_status`**: Use this to debug if a device seems unresponsive.
- **`reset_server_state`**: Run this if you are stuck or experience runaway PIDs.

### Serial Monitor
- **`start_monitor`**: Logs are spooled to disk to avoid flooding context limits. Fetch them via `query_logs`.
- **`stop_monitor`**: Requires `port`. Must be called to free the port for subsequent firmware uploads if it isn't automatically managed.
- **`query_logs`**: Use `searchPattern` to find specific anomalies without reading thousands of lines.

### Library Management
- **`search_libraries`**: Requires `query`. Find exact registry IDs before installing.
- **`install_library`**: Requires `library` and `projectDir`. Explicitly declare library versions to ensure reproducible builds.
- **`list_installed_libraries`**: Requires `projectDir`. Use this to verify a library has correctly registered.
- **`uninstall_library`**: Requires `library` and `projectDir`. Clean out unused dependencies regularly.
- **`update_library`**: Requires `library` and `projectDir`. Always rebuild code after library updates.

### Diagnostics/Dashboard
- **`get_dashboard_url`**: Use this to surface the observability UI to the human user automatically.
