## MCP Tools

The server exposes 12 tools:

### Board Discovery

#### `list_boards`
Lists all available PlatformIO boards with optional filtering.
| Parameter | Required | Description |
|---|---|---|
| `filter` | no | Filter by platform, framework, or MCU (e.g. "esp32", "arduino", "stm32") |

#### `get_board_info`
Gets detailed information about a specific board.
| Parameter | Required | Description |
|---|---|---|
| `boardId` | yes | Board ID (e.g. "esp32dev", "uno", "nucleo_f401re") |

### Device Management

#### `list_devices`
Lists all connected serial devices. No parameters.

### Project Operations

#### `init_project`
Initializes a new PlatformIO project.
| Parameter | Required | Description |
|---|---|---|
| `board` | yes | Board ID |
| `projectDir` | yes | Project directory path |
| `framework` | no | Framework (e.g. "arduino", "espidf", "mbed") |
| `platformOptions` | no | Additional platform options |

#### `check_task_status`
Polls an active or historical background compilation/upload job safely.
| Parameter | Required | Description |
|---|---|---|
| `taskId` | yes | The unique ID returned when a command was invoked with background: true |

#### `build_project`
Compiles the project and generates firmware binary.
| Parameter | Required | Description |
|---|---|---|
| `projectDir` | yes | Path to project directory |
| `environment` | no | Specific environment from platformio.ini |
| `background` | no | Execute asynchronously to prevent timeouts. Returns a taskId. (default: false) |

#### `clean_project`
Removes build artifacts.
| Parameter | Required | Description |
|---|---|---|
| `projectDir` | yes | Path to project directory |

#### `upload_firmware`
Uploads compiled firmware to a connected device.
| Parameter | Required | Description |
|---|---|---|
| `projectDir` | yes | Path to project directory |
| `port` | no | Upload port (auto-detected if omitted) |
| `environment` | no | Specific environment from platformio.ini |
| `background` | no | Execute asynchronously to prevent timeouts. Returns a taskId. (default: false) |

#### `upload_filesystem`
Uploads a SPIFFS/LittleFS filesystem image from the project's `data/` directory to a connected device.
| Parameter | Required | Description |
|---|---|---|
| `projectDir` | yes | Path to project directory |
| `port` | no | Upload port (auto-detected if omitted) |
| `environment` | no | Specific environment from platformio.ini |
| `background` | no | Execute asynchronously to prevent timeouts. Returns a taskId. (default: false) |

#### `start_monitor`
Returns the command for starting serial monitor.
| Parameter | Required | Description |
|---|---|---|
| `port` | no | Serial port |
| `baud` | no | Baud rate (e.g. 115200) |
| `projectDir` | no | Project directory |

### Library Management

#### `search_libraries`
Searches the PlatformIO library registry.
| Parameter | Required | Description |
|---|---|---|
| `query` | yes | Search query |
| `limit` | no | Maximum results (default: 20) |

#### `install_library`
Installs a library from the PlatformIO registry.
| Parameter | Required | Description |
|---|---|---|
| `library` | yes | Library name or ID |
| `projectDir` | no | Project directory (global if omitted) |
| `version` | no | Specific version (e.g. "^6.21.0") |

#### `list_installed_libraries`
Lists installed libraries.
| Parameter | Required | Description |
|---|---|---|
| `projectDir` | no | Project directory (global if omitted) |
