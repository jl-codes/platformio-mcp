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

## Dashboard command authorization

Dashboard build, clean, upload, test, package-mutation, serial-monitor, reset and PIO Home commands now evaluate the same server policy as MCP/CLI operations before execution. Authentication alone does not authorize a command. A policy denial returns HTTP 403; an approval request returns HTTP 409 with the request identifier.

The dashboard asks the operator to approve a challenged operation and then retries the original payload with that grant. It stops if policy challenges the retry again. The concrete workflow is part of the grant scope: an approval for a firmware upload does not authorize the broader flash-and-monitor workflow.

### Compile-only tests

The `build_only` profile forces PlatformIO test execution to include both `--without-uploading` and `--without-testing`. Skipping upload alone is insufficient because the testing stage can still open/reset a device. This rule is enforced in the shared runner at execution time, including direct internal callers and dashboard requests. `compileOnly: false` cannot override it.

MCP `run_tests` and the dashboard command API also accept the optional boolean `compileOnly`; `true` requests this behavior under any profile. Omission preserves existing full-test behavior outside `build_only`. This stage restriction does not sandbox arbitrary project build scripts. Native-versus-embedded target classification and hardware-test approval binding remain separate implementation work.

### Project enrollment

Project permission increases require an operator record outside the project. Without a matching record, project policies can restrict the built-in/operator baseline but cannot remove its approvals, denies, or mandatory safety switches. A selected `lab_admin` profile therefore does not by itself grant unapproved uploads. `policy-status` reports `projectEnrollment.enrolled` and the normalized document digest.

After reviewing both `.pio-mcp-policy.json` and `.pio-mcp-workspace/policy.yaml`, an operator can run:

```text
pio-agent policy-enroll --project-dir <absolute-project-path>
pio-agent policy-revoke --project-dir <absolute-project-path>
```

Records live under the configured operator policy directory's `project-enrollments` folder, keyed by real project path. Enrollment binds both normalized policy documents. Changing a policy value or copying the project to another path requires new enrollment; formatting alone does not. Enrolled project policy still cannot weaken operator restrictions. Malformed records fail closed and can be revoked locally. Enrollment storage inside the project, including directory aliases, is rejected.

These commands are local operator administration, not MCP tools or dashboard routes. They are not proof of human identity against an agent or script that already has unrestricted execution and write access as the operator's OS user. Protect this boundary with host/process permissions. Enrollment is not an OS sandbox for PlatformIO project scripts or package hooks.

### Dashboard approval authority

Dashboard viewing/operation access, including an MCP-returned launch URL and its session cookie, does not authorize approval changes. Approve and deny routes require a separate operator capability in addition to normal dashboard authentication.

To enable dashboard approval, an operator configures a randomly generated secret of at least 32 characters using `PIO_MCP_APPROVAL_TOKEN` in the server's protected launch environment. The server accepts 32–256 characters and captures the value at startup. Restart the server to rotate it. The UI asks for the capability per approval; it is sent only in the approval request header and is not retained in browser storage. Do not put it in project files, URLs, or tool arguments. If it is not configured, use the local `pio-agent approve <id>` or `pio-agent deny <id>` operator CLI instead.

The capability is never returned by dashboard launch or MCP APIs. Possession grants operator approval authority; it is not proof of human identity. An unrestricted process running as the operator can read its environment or invoke the CLI, so host/OS permissions remain the trusted boundary. Existing dashboard clients must supply the separate capability to approval mutation routes; ordinary operations retain their existing authentication.
