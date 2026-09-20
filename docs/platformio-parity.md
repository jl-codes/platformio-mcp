# PlatformIO compatibility guide

### Build and cleanup options

The canonical build_project tool accepts optional jobs (integer 1–1024) and forceExecution (boolean). The latter bypasses cached-result replay without enabling verbose logs. CLI equivalents are --jobs and --force-execution on the build command. The canonical clean_project tool accepts optional environment and full; full requests PlatformIO fullclean, including downloaded dependencies. Both options are included in the authorized request. Omitting these fields preserves previous behavior. The dashboard launcher exposes parallel build jobs, cleanup environment selection, and an explicit option to remove downloaded dependencies. Dashboard builds already run as background tasks and therefore execute without cached-result replay.


### Static analysis

The canonical check_project tool accepts optional severity (low, medium or high), pattern, skipPackages and tool fields. For foreground calls, structuredReport=true adds analysisReport with defect locations, severity totals, CWE and tool status. Existing calls keep their response shape. Background calls still return task metadata; structured report retrieval from completed background tasks remains unfinished. The dashboard launcher and command API accept severity, source-pattern, analyzer and dependency-exclusion filters. Leaving optional fields empty preserves the project defaults.


### Per-case test reports

Set structuredReport=true on the canonical run_tests tool to include validated testReport data from a foreground run. Existing calls keep their response shape. Missing or invalid reports produce success=false and testReportError. Combining structuredReport with background is rejected until background report lifecycle/retrieval is implemented. Build-only policy still prevents upload and test execution.


The canonical run_tests tool and dashboard command API also accept filter, ignore, withoutUploading, withoutBuilding, uploadPort and verbose. Skipping upload alone can still run tests and open hardware; use compileOnly to disable upload and execution. The dashboard launcher exposes suite inclusion/exclusion patterns and Build tests only. Stage controls cannot override build-only policy.


### CLI access

Use clean, check and test with --project-dir and optional --environment. Clean supports --full. Check supports --severity, --pattern, --tool, --skip-packages and --structured-report. Test supports --filter, --ignore, --compile-only, --without-uploading, --without-building, --upload-port, --verbose and --structured-report. All three support --background; structured test reports require foreground execution. Commands use the corresponding canonical permissions and shared executors. Reported execution failures set a nonzero CLI exit code.


## Post-upload monitor selection

Automatic monitoring follows only a unique exact USB VID:PID and SER identity from the uploaded board. A changed port or USB location can be followed, but matching only the device model, a serial-number prefix, or duplicated descriptors is insufficient. If the board has no usable serial metadata or cannot be uniquely rediscovered, upload success is retained and automatic monitoring is skipped with a diagnostic; select its monitor port explicitly. USB descriptors are discovery evidence, not cryptographic device authentication. The monitor no longer falls back to the first connected board.


## Retained analysis binaries

Crash and size reports include elf.archivePath, a hash-verified ELF copy retained under the server data directory in artifacts/elf. Later builds do not overwrite these copies, and a corrupt existing object is rejected rather than replaced. Private working snapshots are still removed after analysis. Retention is currently manual; archived ELF files may contain symbols and source paths and remain until explicitly removed. A retained ELF does not by itself prove which binary was flashed: flashedFirmwareVerified stays false until upload-manifest evidence establishes that relationship.


To decode an earlier retained build, pass archivedElfSha256 to decode_backtrace or --archived-elf-sha256 to the decode-backtrace CLI command. Use the hash returned by the original report. Retained history is scoped to the exact metadata-resolved ELF source path; it is not a global hash lookup across projects. The original source path must still resolve, and current environment metadata/toolchain discovery still requires build permission. Historical toolchain and flashed-image correspondence remain separate manifest requirements.


The optional compatibility extension archived_elf_sha256 provides the same retained-build selection through pio_decode_backtrace. Its result includes elf_archive_path. Canonical project/configuration, analysis and owned-session permissions still apply.

### Named target execution

The canonical run_target MCP tool accepts projectDir, target, environment, uploadPort and stopOpenSessions. With compatibility enabled, pio_run_target accepts the reference spellings project_dir, env, upload_port and stop_open_sessions. Both use the same executor and effect-specific permission categories; custom target names require privileged host-code permission. A concrete run_target or pio_run_target denial also applies to their internal effect operations.

Serial targets resolve a configured upload port or one unambiguous likely board, coordinate caller-owned monitor cleanup, and retain endpoint custody until process cleanup. This implementation still lacks network/probe destination integration, complete uploaded-artifact binding and full physical acceptance. It does not establish complete PAR-35 parity.

The CLI uses the same target executor: pio-agent run-target --project-dir <dir> --target <name> [--environment <env>] [--upload-port <port>]. It accepts --stop-open-sessions and the scoped --approval-id, --config-approval-id and --selection-approval-id options. CLI session ownership is confined to that invocation; it cannot take ownership of another client's monitor.

The pio_upload compatibility alias now delegates to the same target workflow with a fixed upload target. It accepts project_dir, env, upload_port and stop_open_sessions, plus scoped approval extensions. Existing upload_firmware behavior is preserved. The alias inherits the current serial workflow's remaining network/probe and immutable artifact limitations; its registration is not complete PAR-39 acceptance.

The opt-in pio_system_info alias reports canonical Core metadata, effective host policy, obsolete-install warnings and caller-owned open monitor sessions. Missing Core returns pio_not_found. Policy disclosure and session listing retain their own canonical permissions. Compatibility exposure is now 86 tools (55 canonical plus 31 aliases); registration counts do not establish full reference-contract parity.

Offline partition inspection is available as the canonical partition_table MCP tool and partition-table CLI command. Supply projectDir/tablePath/format/tableOffset (CLI: --project-dir, --table-path, --format, --table-offset); flashSize, firmwarePath and observedTablePath are optional. Paths must resolve inside the authorized workspace. The command reads existing files only, hashes the inspected bytes and labels comparisons as offline evidence. It requires get_project_config permission and honors a concrete partition_table denial. Automatic project/framework table discovery, the pio_partition_table compatibility contract and device reads remain pending. The public inventory is 56 canonical tools and 87 with compatibility enabled (31 aliases).

Partition inspection also accepts sdkconfigPath (CLI --sdkconfig-path) instead of tableOffset. It reads the existing workspace file under the same permission grant, extracts CONFIG_PARTITION_TABLE_OFFSET and includes the file hash and offset source. When both inputs are supplied they must agree. Missing, duplicate or contradictory offset evidence is an error; no default offset is substituted.

When tablePath is omitted, partition_table reads Core configuration and selects the requested environment or a single default environment. It uses board_build.partitions (otherwise project partitions.csv), board_upload.partition_table_offset and board_upload.flash_size. Configuration access has its own configApprovalId when approval is required. Explicit inputs remain available, and multiple defaults require environment selection. Files supplied by framework packages and missing generation-offset evidence are not guessed; that discovery remains pending.

Set buildMetadata: true (CLI --build-metadata) to obtain the selected environment partition binary and offset from Core metadata. This is separately authorized as project_metadata/build_project, can run project scripts, and uses metadataApprovalId when required. An explicit binary tablePath must match that environment flash inventory; otherwise exactly one partitions.bin must be identified. Metadata does not prove a prior binary is fresh or flashed. Explicit offline mode remains the default.

Partition inspection now supports readDevice with an explicit port (CLI --read-device --port). It reads the resolved table sector through PlatformIO esptool package execution, coordinates serial custody and compares decoded device bytes with the inspected layout. The operation can reset hardware. It requires both device permission (esp_flash_read/upload_firmware, readApprovalId) and package-command execution permission (esp_flash_read_command/run_shell_command, commandApprovalId); read-only permission is insufficient. Active serial custody is not forcibly displaced. Completed staging bytes are removed; uncertain process termination retains staging and custody for recovery. The implementation has mocked-executor coverage but still requires physical acceptance and confirmed installed esptool compatibility.

Flash reads use Core pkg exec without a package-install selector, so a missing installed esptool executable fails rather than being downloaded implicitly. Core selects its installed executable provider; privileged command permission remains required. Both scoped flash-read grants are checked before either is consumed, and approval transport identifiers are excluded from the operation payload at this adapter boundary.

For configured ESP-IDF environments, partition inspection now discovers the existing sdkconfig.<environment> file or board_build.esp-idf.sdkconfig_path override. An explicitly configured missing path is an error; only an absent conventional file is optional. Reads remain workspace-bounded and no environment-variable expansion is performed by the inspector.

With buildMetadata enabled, a configured framework CSV filename can be resolved from the selected environment include inventory. The host Core location, package.json and .piopm registration must agree; only the framework partition directory is searched. Host system-info access uses systemApprovalId when needed. Configured project CSVs take precedence. Framework CSVs are compared with the selected build binary, and reports include package identity. Missing or ambiguous packages fail explicitly; framework defaults are not guessed from unrelated installations.

The opt-in pio_partition_table alias now accepts project_dir, env, read_device=false and port, plus explicit artifact/approval extensions. Build metadata discovery defaults on for this adapter and retains build permission; build_metadata=false permits explicitly resolved offline inspection. Omitted device ports use the separately authorized configured/unique serial selection workflow. Binary-only evidence reports csv_path/csv_source as null and supplies effective_table_path/format rather than inventing CSV provenance. Existing firmware.bin beside the selected built partition table is included when present; that does not establish flashed-image identity. Inventory is 56 canonical tools plus 32 aliases (88 when enabled). Full PAR acceptance, including physical behavior and remaining exact result-contract details, is not complete.

Partition reports now fall back to the permitted board catalogue for missing flash capacity or MCU metadata. Explicit and configured values retain precedence. flash_size_source distinguishes explicit input, project configuration, catalogue and unknown; catalogue data is not a physical measurement. A denied/unavailable optional lookup leaves capacity unknown and is identified in board_lookup. boardApprovalId (compatibility board_approval_id) supports separately granted lookup.

### Offline ESP core dumps

Use MCP `coredump` or CLI `coredump --project-dir <workspace> --dump-path <file> --format base64 --analyze false` to inspect bounded raw/serial-base64 input without executing an analyzer. The response contains source/content hashes and firmware identity evidence, not raw memory bytes.

Analysis defaults to enabled and requires an explicit `elfPath` (`--elf-path` in CLI), matching processor architecture and a separate host-command permission. Configure absolute `PIO_MCP_COREDUMP_PYTHON` and `PIO_MCP_COREDUMP_GDB` paths in the server environment, plus `PIO_MCP_DEBUGGER_ROOTS` as a JSON array of trusted debugger installation roots. Install the Python distribution's optional `coredump` extra explicitly into the selected interpreter environment; it pins esp-coredump 1.10.0 and setuptools 84.0.0. No tool request accepts executable paths or installs missing packages automatically.

Use `approvalId` and `commandApprovalId` for the separate inspection/execution grants. `expectedInputSha256` pins the original input file, while `expectedElfSha256` pins the selected ELF. Embedded partial ELF hashes are reported as partial matches, not exact firmware identity. Private temporary dump/core files are removed when offline analysis finishes or fails. Current reports provide bounded current-thread backtrace/register output; missing reason/task information stays null. Live-device core acquisition and `pio_coredump` compatibility remain under implementation.

MCP `coredump` also accepts `device` instead of `dumpPath`: provide an explicit `port` and `table` object using the same `projectDir` plus the partition-inspection options. For example, `device: {port: "COM5", table: {projectDir: "C:/firmware", tablePath: "partitions.csv", tableOffset: 32768}}`. This example offset is explicit user input, not a default. Use `device.partitionName` when more than one crash partition exists. `device.approvalId` and `device.commandApprovalId` authorize the flash read and its host command; top-level `commandApprovalId` covers optional analysis. Table discovery has its own scoped grants. Captured bytes stay internal and are analyzed in private temporary storage; no recorded crash returns `ok: false` with `error: "no_coredump"`. The CLI device options and `pio_coredump` adapter remain under implementation.

CLI device acquisition is available with `coredump --project-dir <workspace> --port <port> --table-path <csv> --table-offset <bytes> --analyze false`. Use `--elf-path <elf>` for analysis, `--partition-name <name>` for ambiguous crash storage, and `--table-format binary` for a built table. Table metadata/configuration flags match partition inspection. Grants are separate: `--approval-id` for the outer inspection, `--command-approval-id` for analysis, `--read-approval-id` and `--read-command-approval-id` for acquisition, and `--table-approval-id` plus the config/metadata/system/board grant flags for table resolution. File and device inputs are mutually exclusive; device-only options require a port. Empty-crash results exit unsuccessfully rather than claiming a report was generated.

Device acquisition accepts outPath (CLI --out-path) with a separate exportApprovalId (--export-approval-id). The existing parent directory must be inside the authorized project. Export is private and never replaces an existing destination. Empty partitions can still be exported, while the result remains no_coredump. Explicit exports have user-managed retention; delete them when no longer needed.


For private managed storage, device requests can select retainDump: true (CLI --retain-dump true) instead of outPath. This uses the same export permission and returns the saved path, hash and expiresAt timestamp. At most 32 dumps of up to 16 MiB are retained. Expiry cleanup runs on subsequent retention access and a live-process timer; a stopped server cannot delete expired files until cleanup resumes. Explicit paths remain user-managed. Canonical requests do not retain dumps unless one of these save options is selected.


## Current core-dump compatibility exposure

The opt-in pio_coredump tool now resolves project/environment/serial selection, saves captures by default in private managed storage, and supports out_path plus optional analysis. Missing ELF output preserves the capture with analysis=null; unconfigured analysis tools are reported without claiming analysis ran. Explicit output remains workspace-contained and never replaces an existing file. Metadata execution, partition inspection, device reads, exports and analyzer execution retain separate scoped permissions; table_config_approval_id and elf_metadata_approval_id avoid reusing a consumed selection grant.

The inventory is now 57 canonical tools plus 39 compatibility tools (96 with compatibility enabled). Registration and offline checks do not prove full PAR-05 parity: physical capture, remaining reference result details and the wider acceptance gates remain outstanding.


## Flash and boot verification

With compatibility enabled, `pio_flash_and_verify` accepts `project_dir`, `env`, `expect`, `fail_on`, `timeout_s`, `upload_port`, `monitor_port`, `baud`, `stop_open_sessions`, `max_lines` and `settle_s`. It resolves project monitor defaults, preflights capture permissions, uses the shared upload executor and collects fresh output from an owned serial session. Failed uploads do not open a monitor. Crash decoding runs only with its own configuration/analysis permissions and never changes a failed boot into a pass.

The existing quiet-window and built-in crash checks remain active. `stability_window_s` defaults to ten seconds and can be explicitly changed. Unlike first-match-only verification, crash evidence takes precedence over a ready marker; missing/truncated evidence or uncertain cleanup cannot pass. Captures are bounded to 300 seconds, 10,000 retained lines and 1 MiB of text; `settle_s` is bounded to 20 seconds, with the reference's additional half-window included. Unsupported regex syntax fails explicitly through the bounded matcher.

Separate grants are `workflow_approval_id` (the composite verifier), `approval_id` (upload), `config_approval_id`, `selection_approval_id`, `monitor_approval_id`, `read_approval_id`, `preflight_discovery_approval_id`, `discovery_approval_id`, `decode_approval_id` and `decode_config_approval_id`. Denials of `pio_flash_and_verify`, `agent_flash_monitor_verify` or `upload_firmware` block flashing. Opening uses the same request/device identity checked before upload; USB replacement causes a failure rather than selecting another board. USB metadata is not cryptographic identity.

Results explicitly report `firmware_identity: identity_unverified` until the upload manifest is bound to immutable images and ELF. Automatic crash decoding currently uses the selected environment ELF and reports that matching the uploaded firmware has not been verified. Complete upload-to-monitor custody, matching-image evidence, dedicated CLI exposure and physical acceptance remain outstanding. Registration does not establish complete PAR-12 acceptance.


## OTA upload

Opt-in `pio_upload_ota` accepts the reference `host`, `project_dir`, `env`, `port`, `auth`, `filesystem`, `build`, `timeout_s` and `verify_reachable` fields. ESP32/ESP8266 port defaults come from computed upload flags or 3232/8266 respectively. Build mode builds the image without uploading, freezes its bytes, and calls the registered framework uploader directly. `build=false` transfers an existing image. Custom artifacts can use `image_path` and `expected_image_sha256`.

Upload, host execution, configuration, build, image inspection, host tool discovery and DNS resolution have separate approval extensions: `approval_id`, `command_approval_id`, `config_approval_id`, `build_approval_id`, `image_approval_id`, `system_approval_id`, and `resolve_approval_id`. Filesystem writes retain their own canonical permission. A concrete `pio_upload_ota` denial blocks both transfer types. Credentials travel via private stdin and are excluded from approval records and process arguments.

Configured `-I`/`--host_ip`, `-P`/`--host_port`, and `-t`/`--timeout` select numeric IPv4 callback bindings and bounded invitation deadlines; progress output is enabled. Debug option dumps are suppressed to avoid credentials. Configured filesystem mode must agree with the request. Flags overriding the selected destination or image, unknown flags, and ambiguous/quoted credential tokens fail explicitly. The current resolver pins IPv4 and rejects ambiguous DNS; supported host framework layout is the registered default Arduino framework package beneath the host packages directory. Alternate framework layouts and IPv6 remain unsupported here.

ICMP failure never blocks an upload: `reachable` is null with an explicit not-probed/not-requested diagnostic. `upload_path` is `pio_build_espota_direct` for build mode and `espota_direct` otherwise. Successful transfer reports the captured image SHA-256 and `runtime_verified: false`; it does not establish healthy firmware execution. This remains incomplete physical/platform acceptance, not a full parity claim.

The native bridge can be checked without a board using `node --import tsx scripts/verify-ota-bridge.mts <absolute-python-path> [evidence-path]`. It uses only loopback UDP/TCP fixtures and dummy credentials. Windows evidence is recorded in `docs/reviews/ota-bridge-windows-evidence.json`.


### Live debugger compatibility

Compatibility mode now exposes `pio_debug_start`, `pio_debug_cmd`, `pio_debug_list` and `pio_debug_stop`. Sessions belong to the current MCP connection. Startup uses the installed PlatformIO configuration and generated initialization, a retained ELF, and a uniquely identified USB probe. Supply `probe: {vendor_id, product_id, serial_number}` when discovery is ambiguous. Currently implemented owned local bindings are OpenOCD and modern J-Link; standalone ST-Link and remote/pipe transports remain incomplete.

Startup approvals are separate for preparation, discovery, host code and target effects. Completed preparation stages survive approval retries on the same connection. Discovery authorization is consumed per attempt; if a later startup approval is requested, obtain a fresh discovery approval on the next attempt. Never reuse a consumed grant as permission. Normal stop authorizes the configured reset/run hook; `process_only: true` performs recovery cleanup without sending target commands. A reset/run acknowledgment does not independently prove that the physical target is running.

Native supervisors require empty owned process groups/Windows jobs for both GDB and its backend before releasing probe custody. Optional host verification can impose an additional check. This proves closure of owned process handles, not that another application cannot open the probe afterward; privileged project/debugger code is not an OS sandbox. Failed or uncertain cleanup retains a recoverable session.

Registration is not full debugger acceptance: physical ESP/Cortex probe evidence, remaining backend bindings, response parity details, endpoint-conflict handling and complete CLI/dashboard integration remain outstanding. Power profiling is the remaining unregistered reference tool. No release has been published.

### Power execution permissions (implementation in progress)

The internal PPK2 operation preflights `power_meter_command` (under `run_shell_command`) and either `power_meter_measure` (under `start_monitor`) or the independent `power_source` permission. Source permission is not inherited from upload, monitor, or host-command permissions. An operator must explicitly configure `power_source` in `approval_required` or `allow`; it is otherwise denied. Request-bound approvals include the meter and DUT resource identities, interpreter, measurement/source mode, voltage, software current-trip threshold, and duration. The current limit is a software trip, not a hardware current regulator.

The retained operation owner cancels collection on policy revision and remains available for cleanup retries. This internal service is not yet the public `pio_power_profile` tool: trusted meter/DUT discovery, optional dependency setup, connection ownership, public routing, and physical acceptance remain incomplete.

### Explicit optional PPK2 dependency setup

Run `python -I scripts/setup-ppk2.py <new-environment-directory>` using a trusted host Python. The parent directory must exist; the environment directory must not. The command installs only hash-pinned binary wheels for `ppk2-api==0.9.2` and `pyserial==3.5` from PyPI, then checks isolated imports, package versions and required API methods without opening hardware. It writes `ppk2-setup.json` only after validation succeeds. Failed installations are left for operator inspection and cannot be reused by rerunning this command. Measurement requests never install dependencies automatically.

The setup script is included in npm, plugin and Python runtime packaging. Its environment is not automatically trusted or selected by the still-incomplete public PPK2 adapter. Import success is dependency evidence only, not device identity, voltage/current approval, or physical acceptance.

Set `PIO_MCP_PPK2_ENV` in the server's environment to explicitly select the dedicated virtual environment. Keep that directory outside the firmware project and keep `include-system-site-packages = false`. This selects a host runtime; it does not grant meter access or source-power permission, and public meter routing remains in development.
