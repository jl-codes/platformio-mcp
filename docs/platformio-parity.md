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
