# Optional compatibility tools

Start the MCP server with `--compat platformio-mcp-python`, or set
`PIO_MCP_COMPAT=platformio-mcp-python` in its launch environment. Both the CLI
entry point and direct server entry point accept this setting. Unknown modes
fail startup. Without this opt-in, the existing tool names remain unchanged.

This development revision adds six package aliases: `pio_pkg_search`, `pio_pkg_install`,
`pio_pkg_uninstall`, `pio_pkg_list`, `pio_pkg_outdated`, and `pio_pkg_update`.
It also adds `pio_project_envs`, `pio_project_metadata`, and `pio_list_targets`, using the same
resolved project configuration and bounded compiler metadata as their canonical
counterparts. Metadata generation requires build permission because project
scripts and dependency installation may run.

All 72 normal-mode tools remain available (112 total with the 40 reference aliases).
`pio_deps_check` additionally maps dependency inspection and optional build
evidence to the canonical `deps_check` service. This is partial implementation of the
pinned 40-tool reference contract, not a declaration of complete parity.

Aliases accept snake-case reference arguments. Project operations resolve an
explicit `project_dir`, then the launch-time `PLATFORMIO_MCP_PROJECT_DIR`, then
the working directory. The selected directory must contain `platformio.ini`.
The optional `approval_id` extension carries a scoped canonical approval;
it does not grant permission by itself. Every alias uses its canonical
executor and server policy. Codex continues to enforce its own host permissions.

Successful executor responses use compact `ok`, `summary`, `log_path` and
operation-specific fields. Unknown registry pagination counts are null rather
than invented. Validation and policy exceptions use a compact `ok: false` result. Expected
errors map to reference categories such as `policy_denied` and `not_found`, with
the canonical code retained in `details.code`. Approval requests remain blocked
and retain scoped `approval_id` and selected policy details. Diagnostics are
bounded and redacted; arbitrary exception context is omitted. Complete
reference error-class equivalence remains outstanding.
Canonical commands and response envelopes are unchanged.

Target discovery uses structured PlatformIO metadata instead of parsing console
tables. It preserves environment identity when multiple environments expose the
same target. An unavailable inventory returns `TARGETS_UNAVAILABLE`; it is not
reported as an empty successful list. This inspection does not execute a target,
but requires build permission because metadata generation can execute scripts.

### Owned serial sessions in normal mode

`serial_session_start`, `serial_session_read`, `serial_session_write`,
`serial_session_list`, and `serial_session_stop` expose the owned-session lifecycle
without compatibility mode. They share the corresponding `pio_monitor_*` schemas,
handlers, permission checks, and connection-bound ownership. Existing `start_monitor`,
`query_logs`, `get_monitor_status`, and `stop_monitor` behavior is unchanged.
`monitor_capture`, `memory_watch`, and `port_diagnose` also use the shared
reference schemas and handlers in normal mode. Capture and memory collection retain
separate opening/reading authorization; port diagnosis does not open the port.

### OTA reachability

`verify_reachable` defaults to true. Under the discovery permission, OTA resolves one
IPv4 address and sends one bounded ICMP probe to that exact address before building
or uploading. A negative result is retained as `reachable: false` with its
`reachability_status`; the separately authorized OTA operation still proceeds.
Unlike the pinned reference, a failed ping does not return `host_unreachable` or
block upload: ICMP may be filtered while OTA is available. Set
`verify_reachable=false` to skip the diagnostic probe. Missing system ping utilities
report `reachable: null`. A ping reply establishes neither OTA service availability nor firmware
runtime health. The system utility is selected from fixed OS paths without a shell
or PATH search; public requests cannot choose its command or arguments.

### OTA from the CLI

Use `pio-agent upload-ota --project-dir <dir> --host <address>` with the same
configuration, build, image, network, upload, and host-command permissions as MCP.
Optional flags include `--environment`, `--port`, `--filesystem`, `--build false`,
`--verify-reachable false`, `--timeout`, `--image-path`, `--elf-path`, and
`--expected-image-sha256`. For an explicit password, use `--auth-env <variable>`;
the selected host environment variable supplies it without putting the password in
process arguments. Without this flag, project configuration supplies authentication.
The CLI supports the same seven scoped approval IDs using hyphenated flags and
in-process interactive approvals (`--approve`, or prompts outside JSON mode).
Approval never overrides policy denial. A failed result exits nonzero.


### Bounded debugger CLI sequence

`pio-agent debug-run --project-dir <dir> --commands '["bt","info registers"]'`
starts one owned debugger session, executes the JSON array in order, and performs
the normal authorized reset/run stop. The array is validated before startup and
limited to 32 commands; execution stops after a failed or timed-out command.
`--environment`, `--probe-serial`, `--load false`, `--timeout` (startup seconds),
and `--command-timeout` (seconds per command/stop) select the workflow. Shell
quoting of JSON depends on the caller's shell.

`--process-only` requests cleanup without the normal target reset/run hook.
Otherwise that hook requires its own host and target permissions. All paths
attempt process cleanup on failure and report uncertain cleanup rather than
claiming the probe is free. `--approve` permits interactive approval-required
stages in this invocation but cannot override policy denial. The sequence uses
the same local backend limitations as MCP; it does not create a session that a
later CLI process can borrow. Use the persistent MCP connection for interactive
step-by-step debugging.

### Serial observation CLI

`monitor-capture --project-dir <dir>` opens, captures, and closes a temporary owned
serial session. Use `--port`, `--environment`, `--baud`, `--seconds`, `--until`,
and `--max-lines` to narrow the capture. `memory-watch --project-dir <dir>` uses
the same ownership path and accepts `--pattern`, `--stack-unit`,
`--stack-word-bytes`, and `--stack-warn-bytes`. Word-valued stack telemetry requires
an explicit word size. Both commands retain opening/read permissions and report
uncertain cleanup. They cannot borrow another process's session; use the MCP
session tools for persistent interactive monitoring. Missing instrumentation or
incomplete capture is not proof of healthy firmware or a memory leak.

`port-diagnose --project-dir <dir> [--port <port>] [--environment <env>]`
uses the shared read-only metadata and holder inspection path. It does not open or
reset the port, change OS permissions, or stop other processes. Missing holder
information remains unknown; it does not prove exclusive access. CLI session
listings cannot see another MCP connection's owned session inventory.
