# Optional package compatibility tools

Start the MCP server with `--compat platformio-mcp-python`, or set
`PIO_MCP_COMPAT=platformio-mcp-python` in its launch environment. Both the CLI
entry point and direct server entry point accept this setting. Unknown modes
fail startup. Without this opt-in, the existing tool names remain unchanged.

This development revision adds six aliases: `pio_pkg_search`, `pio_pkg_install`,
`pio_pkg_uninstall`, `pio_pkg_list`, `pio_pkg_outdated`, and `pio_pkg_update`.
All 53 canonical tools remain available. This is partial implementation of the
pinned 40-tool reference contract, not a declaration of complete parity.

Aliases accept snake-case reference arguments. Project operations resolve an
explicit `project_dir`, then the launch-time `PLATFORMIO_MCP_PROJECT_DIR`, then
the working directory. The selected directory must contain `platformio.ini`.
The optional `approval_id` extension carries a scoped canonical approval;
it does not grant permission by itself. Every alias uses the canonical package
executor and server policy. Codex continues to enforce its own host permissions.

Successful executor responses use compact `ok`, `summary`, `log_path` and
operation-specific fields. Unknown registry pagination counts are null rather
than invented. Validation and policy exceptions currently use the existing MCP
error envelope; complete reference error-shape coverage remains outstanding.
Canonical commands and response envelopes are unchanged.
