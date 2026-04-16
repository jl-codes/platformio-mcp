---
name: pio-manager
description: The absolute Single Source of Truth for executing PlatformIO operations (compiling, flashing, log-reading, and queue locking). Agents must strictly route all hardware checks and commands through this skill. Use this skill when auditing or reviewing platformio.ini, resolving port conflicts, build port errors, port not found, device not configured, or resource busy errors.
---

# PIO Manager (Mega-Skill)

This skill provides the mandatory 3-Tier Execution Architecture for interacting with PlatformIO builds, hardware flashing, and serial port logs. All agents MUST consult this skill before executing any target compilation.

## The 3-Tier Execution Hierarchy

### 🟢 Tier 1 (Preferred): MCP Server Primitives
The `platformio-mcp` server encapsulates atomic locking, compilation, and log spooling safely. **You must ALWAYS attempt to use these tools first:**
1. **Compilation/Deployment:** `mcp_platformio_build_project`, `mcp_platformio_clean_project`, `mcp_platformio_upload_firmware`, `mcp_platformio_upload_filesystem`
2. **Asynchronous Polling:** `mcp_platformio_check_task_status`
3. **Hardware Locking:** `mcp_platformio_get_lock_status`, `mcp_platformio_acquire_lock`, `mcp_platformio_release_lock`, `mcp_platformio_reset_server_state`
4. **Serial Monitor:** `mcp_platformio_start_monitor`, `mcp_platformio_stop_monitor`, `mcp_platformio_query_logs`
5. **Environment/Libraries:** `mcp_platformio_list_boards`, `mcp_platformio_list_devices`, `mcp_platformio_init_project`, `mcp_platformio_search_libraries`, `mcp_platformio_install_library`

**Targeting Rules:** You MUST explicitly map the `environment` parameter (e.g., `esp32dev` or `esp32s3nano`) harvested from `platformio.ini` unless the user requires a full multi-environment compatibility check.

**Handling Long-Running Tasks (Build & Flash):**
Builds and firmware/filesystem uploads are often long-running asynchronous processes. When triggered, they may return immediately while the task operates completely in the background. If you anticipate a lengthy execution or observe a background task initiated, DO NOT assume failure or sit idle indefinitely. Instead, use the `mcp_platformio_check_task_status` tool to periodically poll the background process (e.g., check in every 1 to 3 minutes) until the task formally resolves.

### 🟡 Tier 2 (Self-Healing): Auto-Installer
If the native `mcp_platformio_*` tools are completely unavailable in your context:
1. STOP. Do not immediately attempt bash commands.
2. Formally ask the user: *"The MCP agent is unavailable. Would you like me to install/re-install it?"*
3. If the user explicitly says YES, run `python skills/pio-manager/scripts/install_pio_mcp_server.py`. Once complete, instruct the user to reload the AI session to ingest `mcp.json`.
4. If installation fails, ask the user again. **Only proceed to Tier 3 if the user explicitly says NO to further installation attempts.**

### 🔴 Tier 3 (Fallback): Dumb Assets
If (and only if) the user refuses the MCP installation (Tier 2), you may proceed using raw shell wrappers.
**WARNING:** Locks are completely bypassed in Tier 3. Inform the user that they are operating without mutex safety.
Use the pre-built asset wrappers inside `skills/pio-manager/assets/` to save tokens. Do NOT write verbose `pio run` commands natively:
- Build: `./assets/build.sh [env]`
- Flash: `./assets/flash.sh [env]` (or use the advanced `safe-flash.sh` fallback auto-detect script)
- Clean: `./assets/clean.sh [env]`
- Logs: `python ./assets/read-logs.py logs/latest-monitor.log -n 50`

---

## Troubleshooting & Deadlocks
If you discover a stray session ID is permanently holding the hardware lock, or you encounter runaway daemon compilation PIDs blocking execution, execute `mcp_platformio_reset_server_state` to forcefully clean all server locks and terminate any tracked PIDs. If port conflicts occur, use `mcp_platformio_stop_monitor` to kill the active background serial listener.

---

## ESP32 Config & macOS Auditing
If the user asks you to audit or review a `platformio.ini` file for ESP32 devices, or if you encounter persistent flashing anomalies on macOS (such as `[Errno 16] Resource busy`, `Device not configured`, or port drift where the serial port increments/changes), you MUST immediately load and read the bundled knowledge reference:
- View the bundled knowledge reference located at `references/esp32-macos-tuning.md` (relative to this skill's root directory).

This reference contains highly specific configurations (DTR/RTS overrides, Native USB CDC flags) and deterministic port resolution strategies required to stabilize the ESP32 macOS flashing pipeline.
