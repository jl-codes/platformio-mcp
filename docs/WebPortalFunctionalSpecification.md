# Web Portal Functional Specification

## 1. Architectural Philosophy
*   **The 2-Tier State Model:** Clear delineation between Global Physical Resources (Serial Ports) and Local Workspace State (Build Queues).
*   **Task-Centric Routing:** `taskId` is the core primitive for streaming telemetry, replacing `projectDir` as the primary identifier.
*   **PIO Home Integration Strategy:** The UI natively mirrors the PlatformIO IDE (VS Code extension) and PIO Home aesthetic to provide a frictionless, integrated developer experience.

---

## 2. Global Layout & Routing (ASCII Wireframe)

```text
+---+-------------------------------------------------------------------------+
| P | [Project: platformio-mcp v]                   [Server Status: ONLINE]   |
+---+-------------------------+-----------------------------------------------+
|   |                         |                                               |
| I |  AGENT TASK STREAM      |  TERMINAL LOGS (Task: 98b50e...)   [x] Close  |
|   |  [+ New Command]        |  +-----------------------------------------+  |
| A |  +-------------------+  |  | > pio run --environment esp32dev        |  |
| G |  | [RUNNING] Build   |  |  | > Compiling .pio/build/src/main.o       |  |
| E |  | ID: 98b50e...     |  |  | > Linking .pio/build/firmware.elf       |  |
| N |  +-------------------+  |  | _                                       |  |
| T |  | [FAILED] Upload   |  |  |                                         |  |
|   |  | ID: 12f40c...     |  |  +-----------------------------------------+  |
| P |  +-------------------+  |                                               |
| I |                         |                                               |
| O |-------------------------+-----------------------------------------------+
|   |                                                                         |
| H |  +-------------------------------------------------------------------+  |
| W |  | v HARDWARE RACK (Expanded Mode)                                   |  |
|   |  |   [ /dev/cu.usb1 ] Status: BUSY (Agent Build)  [ Stop Monitor ]   |  |
|   |  |   [ /dev/cu.usb2 ] Status: IDLE                [ Start Monitor ]  |  |
|   |  +-------------------------------------------------------------------+  |
+---+-------------------------------------------------------------------------+

[Key for Thin Activity Bar (Leftmost Column)]:
P     = Project Switcher (Top)
I     = Project Info Mode (Shows boards, libraries, config)
AGENT = Agent Task Stream Mode (Active in wireframe)
PIO   = Launch PIO Home
HW    = Hardware Rack Toggle (Bottom Button)
```

---

## 3. Component Architecture & Exact Native Styling

The portal uses the exact DOM dimensions and color hexes natively used by PIO Home to ensure the MCP interface feels like a first-party extension.

### A. Global Theme
*   **Primary Background:** Deep Charcoal (`#1E1E1E`)
*   **Secondary Background (Nav/Bars):** Dark Gray (`#323232`)
*   **Accent Color:** PlatformIO Blue (`#4080D0`)
*   **Text:** White (`#FFFFFF`) / Muted Gray (`#989898`) for inactive states.

### B. Thin Left Command Bar (Activity Bar)
*   Acts as the global routing spine. Determines the contents of the Main Viewport.
*   **Dimensions:** Exactly 64px wide.
*   **Styling:** Background `#323232`. Vertical icon-driven menu. Active items get a `#4080D0` indicator.
*   **Top Buttons:** Project Switcher, Project Info Mode, Agent Task Stream Mode.
*   **Middle Buttons:** "Open PIO Home" (backgrounds `pio home` and opens it).
*   **Bottom Buttons:**
    *   `[ ! ]` Reset Server State (Emergency kill switch, triggers a confirmation dialog).
    *   Hardware Rack Toggle.

### C. Top Navigation (Global Header & Project Selector)
*   **Dimensions:** Approximately 48px high.
*   **Styling:** Background `#323232`.
*   **Content:** 
    *   **Right Side:** Global server health/status indicator (`[ONLINE]`).
    *   **Left Side (The Project Selector):** A prominent dropdown menu displaying the currently active project path. 
        *   Clicking it reveals a list of all known initialized directories (parsed from the backend `workspaces.json` ledger).
        *   **Action:** The bottom of this dropdown contains an `[ + Open Project ]` option. Clicking this launches a native file/directory picker, allowing the user to locate a directory containing a `platformio.ini` file and add it to the tracked `workspaces.json` ledger.
*   **"Auto-Tracking" Behavior:** 
    *   The Project Selector features an "Auto-Track Context" toggle (enabled by default).
    *   When an autonomous agent (or background process) initiates a command via the MCP server (e.g., `build_project` on `Project B`), the Portal will automatically detect the incoming `taskId` webhook, switch the global UI context to `Project B`, and immediately display the active log stream.
    *   This prevents the user from manually hunting through the dropdown when the agent begins rapid autonomous execution across multiple projects.

### D. The Main Viewport
*   **Styling:** Background `#1E1E1E`.
*   The content of the entire viewport completely swaps out based on the active 'mode' button selected in the Thin Left Command Bar.
    
    *   **When "Agent Task Stream Mode" is active:** 
        *   The viewport splits into a master-detail pattern.
        *   The wider left-hand context bar shows the chronological history of tasks (`CommandRegistry`). The tasks are presented as foldable drawers.
        *   **Action Buttons:** A prominent "[+ New Command]" launcher sits at the top of this contextual task list.
        *   **Task Headers:** Compact summary showing a status icon, parsed readable action name (e.g., "Build Project"), and direct log view buttons.
        *   **Foldable Details (Expanded Drawer):** Opening a task drawer reveals explicit execution telemetry:
            *   **PID:** The underlying OS `PID` (linking to Hardware Rack processes)
            *   **MCP Parameters:** The exact JSON parameters sent in the MCP tool call (rather than the raw PIO CLI flags), providing transparency into agent intentions.
            *   **MCP Response:** The direct response payload sent back to the agent via the MCP protocol.
            *   **Diagnostics:** The unique registry task UUID.
            *   **Result:** The Result of the task  `Exit Code`.
            *   **Log References:** The absolute/relative paths to the persisted `.log` spools on disk.
        *   The right-hand area holds Tab Viewers. When a user clicks a log button in the feed, it opens a tab showing the terminal logs.
        
    *   **When "Project Info Mode" is active:**
        *   The viewport swaps entirely to display a consolidated summary of the project's configuration.
        *   Displays active boards, installed libraries, and parsed `platformio.ini` details.

### E. Hardware Rack (Bottom Drawer)
*   Anchored to the bottom of the main viewport.
*   **Compact View (Closed State):** 
    *   Sits as a minimal status strip running along the bottom edge of the Main Viewport, adjacent to the Activity Bar toggle.
    *   Displays a highly condensed summary of the active ports (e.g., a simple indicator light [Green/Red] and the port name like `cu.usb1`). 
    *   Does *not* contain the complex play/stop buttons to save vertical space.
*   **Open View (Expanded Drawer):** 
    *   Slides up from the bottom to reveal the full device manager.
    *   Renders the rich controls for all physical ports (`/dev/cu.*`), showing their global lock status explicitly (`BUSY` / `IDLE`).
    *   Provides manual `[Start Monitor]` / `[Stop Monitor]` action buttons for each port.

---

## 4. State Hydration & Webhooks
*   **Historical Bootstrapping:** UI bootstraps historical data on load by reading the `.pio-mcp-workspace/tasks/` JSON lines.
*   **Real-Time Subscriptions:** UI listens to real-time `hardware_state_updated` socket pushes for the Hardware Rack, and subscribes to the Universal Spooler for active terminal logs based on the selected `taskId`.

---

## 5. Command Launcher Modal ("New Command")

The `[+ New Command]` button (located exclusively at the top of the contextual **Agent Task Stream** panel, *not* the global title bar) invokes a centralized dialog box to manually trigger PlatformIO executions. 

### A. Verb Evaluation (Exclusions)
To prevent UI clutter and respect the separation of concerns, the following MCP verbs are strictly **excluded** from the Command Launcher:
*   **Internal State/Polling:** `acquire_lock`, `release_lock`, `get_lock_status`, `check_task_status`, `query_logs` (handled by background React Hooks).
*   **Contextual UI Features:** `start_monitor`, `stop_monitor`, `list_devices` (handled natively by the Hardware Rack drawer).
*   **Project Info Tab Features:** `get_project_config`, `get_board_info`, `system_info` (handled by the `[ I ] Project Info` Mode).
*   **Dependency Management:** `install_library`, `update_library`, `uninstall_library`, `search_libraries` (deferred entirely to the "Open PIO Home" launcher).
*   **Global Server Operations:** `reset_server_state` (This is a destructive action and lives on the Thin Left Activity Bar with a confirmation dialog).
*   **Redundancies:** `get_dashboard_url` (meaningless inside the dashboard).

### B. Supported Verbs & Parameter Editing
The modal provides a dropdown to select one of the following execution verbs. Upon selection, the modal dynamically renders form inputs for the relevant parameters. *(Note: `projectDir` is omitted from the forms as it is automatically inherited from the active Project Switcher context).*

1.  **`build_project`**
    *   `environment` (Dropdown: parsed from `platformio.ini`, optional)
    *   `verbose` (Toggle: default false)
2.  **`clean_project`**
    *   No parameters required (operates on the active context).
3.  **`upload_firmware`**
    *   `environment` (Dropdown: optional)
    *   `port` (Dropdown: populated from `list_devices`, optional auto-detect)
    *   `start_monitor` (Toggle: default false)
    *   `verbose` (Toggle: default false)
4.  **`upload_filesystem`** (SPIFFS/LittleFS)
    *   `environment` (Dropdown: optional)
    *   `port` (Dropdown: populated from `list_devices`, optional auto-detect)
5.  **`run_tests`** (Unit Testing)
    *   `environment` (Dropdown: optional)
6.  **`check_project`** (Static Analysis)
    *   `environment` (Dropdown: optional)

### C. UX Flow
When the user fills the parameters and clicks **[ Execute ]**:
1.  The modal closes organically.
2.  The backend fires the command and generates a `taskId`.
3.  The portal intercepts the `taskId` webhook, immediately routing the Main Viewport back to the **Agent Task Stream** mode and opening the live logs for the new task.
