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

All 54 canonical tools remain available (64 total in compatibility mode).
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
