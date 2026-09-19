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

## Approval lifecycle

An approval now binds the complete operation arguments, project scope, automation scope and effective-policy digest. Changing any operation parameter or policy source requires a new approval. Argument secrets participate in the hash but are not copied into normal policy-generated approval records.

Approved requests expire after their configured lifetime (30 minutes by default). A grant is consumed once before execution. Consumption is serialized across processes and recorded with an exclusive on-disk claim; a crash while saving the final status does not make the grant reusable. Denied, expired and consumed records cannot be approved again. A failed operation may consume its grant and require a fresh approval for retry.

Existing approval records without an exact scope digest or expiry remain readable but cannot authorize execution. Create a new request and approve it through the operator workflow. Caller-supplied `approved`/`__approved` booleans and an `actor: user` label no longer grant authority inside the policy engine. The CLI retains its explicit confirmation/`--approve` workflow by approving a scoped request rather than bypassing evaluation.

This lifecycle does not by itself establish operator identity. Entrypoint authentication, queued execution revalidation and resolved artifact/device binding remain separate enforcement requirements tracked in the implementation plan.
