---
name: pio-manager
description: The absolute Single Source of Truth for executing PlatformIO operations via the MCP Server (compiling, flashing, log-reading, uploading filesystems, managing libraries, testing, and queue locking). Agents MUST route all hardware executions through this skill. Use this to actively solve 'Resource busy' errors, macOS ESP32 port drift/anomalies, invoke esptool.py to clear corrupted flash memory, or configure hardware-less target simulators. Do NOT trigger this skill for general code editing, simply writing text into a platformio.ini file, or querying general macOS/Docker host analytics.
---

# PIO Manager (Mega-Skill)

This skill provides the mandatory 3-Tier Execution Architecture for interacting with PlatformIO builds, hardware flashing, and serial port logs. All agents MUST consult this skill before executing any target compilation.

## The 3-Tier Execution Hierarchy

### 🟢 Tier 1 (Preferred): MCP Server Primitives
The `platformio-mcp` server encapsulates atomic locking, compilation, and log spooling safely. **You must ALWAYS attempt to use these tools first:**
1. **Compilation/Deployment/Analysis:** `mcp_platformio_build_project`, `mcp_platformio_clean_project`, `mcp_platformio_upload_firmware`, `mcp_platformio_upload_filesystem`, `mcp_platformio_check_project`, `mcp_platformio_run_tests`
2. **Asynchronous Polling:** `mcp_platformio_check_task_status`
3. **Hardware Locking:** `mcp_platformio_get_lock_status`, `mcp_platformio_acquire_lock`, `mcp_platformio_release_lock`, `mcp_platformio_reset_server_state`
4. **Serial Monitor:** `mcp_platformio_start_monitor`, `mcp_platformio_stop_monitor`, `mcp_platformio_query_logs`
5. **Environment/Libraries:** `mcp_platformio_list_boards`, `mcp_platformio_list_devices`, `mcp_platformio_init_project`, `mcp_platformio_search_libraries`, `mcp_platformio_install_library`, `mcp_platformio_uninstall_library`, `mcp_platformio_update_library`, `mcp_platformio_list_installed_libraries`
6. **Diagnostics/Dashboard:** `mcp_platformio_get_dashboard_url`, `mcp_platformio_get_project_config`, `mcp_platformio_system_info`

**Targeting Rules & Hazard Advisory:** You MUST explicitly map the `environment` parameter (e.g., `esp32dev` or `esp32s3nano`) harvested from `platformio.ini` when executing commands like `upload_firmware` or `upload_filesystem`. **HAZARD:** If `environment` is omitted, PlatformIO will aggressively aggregate and attempt to upload ALL active configured environments found in `default_envs` (or literally every environment in the file) sequentially over the port, which causes overlapping flashes and bricked hardware on multi-target repos. You are only permitted to omit `environment` if the repository strictly contains a single environment block, or if the user explicitly demands a multi-environment parallel build/flash.

**Handling Long-Running Tasks (Build & Flash):**
Builds and firmware/filesystem uploads are often long-running processes. You **MUST** use the `background: true` parameter when calling `mcp_platformio_build_project`, `mcp_platformio_clean_project`, `mcp_platformio_upload_firmware`, or `mcp_platformio_upload_filesystem` inside your tool invocation to prevent the server from timing out on large compilations.

When triggered with the `background` flag, the tool will initiate the task offline and return a `{ status: "running", taskId: "..." }` signature (along with an optional array of `logPaths`). DO NOT assume failure, declare completion, or sit idle indefinitely. Instead, use the `mcp_platformio_check_task_status` tool (passing `taskId`) to periodically poll the ongoing background process.

**ADVISORY - TASK ID PRIORITY:** For any active background operations (`build_project`, `clean_project`, `upload_firmware`, `upload_filesystem`, `run_tests`), you MUST ALWAYS prioritize using the generated `taskId` with BOTH `mcp_platformio_check_task_status` (for polling state) AND `mcp_platformio_query_logs` (for efficiently reading the compilation/flash output). While background tasks may transparently return a `logPaths` string array enabling you to execute native host file-tailing, you must prefer this tokenized task correlation over native `.log` file reading or broad port-based querying whenever a `taskId` is available. When using `query_logs`, always utilize the `searchPattern` parameter (Regex) to filter the spool for specific keywords or anomalies instead of brute-force reading thousands of lines.

**CRITICAL:** Once any explicit background task is fully complete (status is "completed" or "failed") and you have acquired a manual lock, you MUST explicitly call `mcp_platformio_release_lock` (using the same session ID) to free the hardware queue. Failing to release the lock will brick the user's GUI Dashboard.

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

---

## PIO v6 Advanced Diagnostics
If you are debugging corrupted hardware memory, need to clear flash partitions, or are trying to invoke low-level toolchain binaries like `esptool.py` directly, IMMEDIATELY read the sandboxing pattern reference:
- View `references/v6-pkg-exec-sandboxing.md` (relative to this skill's root directory).

## Hardware-less Emulation & Testing
If you need to run unit-tests or validate C++ logic but **no physical board is plugged in**, or the user asks to setup a simulator, IMMEDIATELY read the emulation pattern reference:
- View `references/v6-hardware-less-emulation.md` (relative to this skill's root directory).


