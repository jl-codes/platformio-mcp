# Policy sources and Codex configuration

PlatformIO MCP enforces its operation policy independently of the host application. Codex controls host approvals, sandboxing and tool visibility through its effective configuration, including `config.toml`, managed settings, profiles and launch overrides. PlatformIO MCP does not treat a host setting such as `approval_policy = "never"` as permission to flash hardware.

## Selecting server policy

Use one explicit operator policy file for predictable discovery:

```sh
platformio-mcp --policy-file /absolute/path/operator.yaml policy-status --json
```

Alternatively, set `PIO_MCP_POLICY_FILE` in the server's launch environment. If the launch flag and environment variable both exist, they must resolve to the same path. Empty, conflicting, missing or unreadable explicit selections are errors.

Without an explicit file, the legacy operator location is `~/.platformio-mcp/policy.yaml`, or `policy.yaml` under an explicitly set `PIO_MCP_DATA_DIR`. Discovery does not probe temporary, working-directory or writable-cache alternatives. An absent optional file uses built-in defaults; an invalid existing file never does.

Policies accept `.json`, `.yaml` and `.yml`. Parsing rejects unknown fields/actions/profiles, duplicate keys, YAML aliases, multiple documents, incorrect value types and files larger than 64 KiB. JSON syntax errors are never retried as YAML. For example:

```yaml
allow: [list_devices, get_policy_status, build_project]
approval_required: [upload_firmware]
require_workspace_boundary: true
require_device_lock_for_upload: true
```

Supported profile names remain `read_only`, `build_only`, `monitor_only`, `flash_requires_approval`, `lab_runner` and `lab_admin`. An explicit `allow: []` stays empty. A project override cannot remove operator denials, mandatory safety switches or approval requirements, or exceed an explicit operator allow/approval set.

`get_policy_status` reports the contributing paths, presence of optional sources, file hashes and effective-policy digest. With invalid configuration it returns `valid: false` and a repair diagnostic; execution is denied. These diagnostics describe the server policy, not the host's merged runtime permissions.

## Codex installation

The Codex installer selects `$CODEX_HOME/config.toml`, falling back to `~/.codex/config.toml` only when `CODEX_HOME` is unset. An explicitly empty value is rejected. See the [official configuration locations](https://learn.chatgpt.com/docs/config-file/config-advanced).

The installer edits launch values through a TOML syntax tree and preserves unrelated settings, comments, environment entries, enabled/disabled tool settings and custom launchers. Npm launch updates retain runtime flags such as `--policy-file`. An existing remote server entry is rejected rather than converted implicitly to a local transport.

Invalid TOML remains untouched. Valid updates use a temporary file in the same directory followed by atomic replacement; a replacement failure keeps the original file and removes the temporary file. Installation refuses an observed concurrent edit. Tests use temporary configurations and never modify the developer's real host settings.

For a standalone server, this environment entry selects the server policy while host tool permissions remain in their own Codex settings:

```toml
[mcp_servers.platformio.env]
PIO_MCP_POLICY_FILE = "/absolute/path/operator.yaml"
```

Plugin-managed server configuration is a separate launch surface; do not assume a standalone `mcp_servers.platformio` entry also configures a bundled plugin. Plugin host acceptance and permission propagation must be verified against the final packaged release.
