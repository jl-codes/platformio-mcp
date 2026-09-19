# Resolved project inspection

Three canonical tools expose computed project information through the shared server authorization boundary. Existing `get_project_config`, `get_project_context` and target-resolution contracts are unchanged.

| MCP tool | CLI command | Behavior and permission |
| --- | --- | --- |
| `project_envs` | `project-envs` | Reads PlatformIO's resolved configuration; `get_project_config` category, read-only annotation |
| `project_metadata` | `project-metadata` | Generates selected/all-environment build metadata; `build_project` category |
| `list_targets` | `list-targets` | Uses structured targets from the same metadata source as PlatformIO's target-list command; `build_project` category |

All require `projectDir` (`--project-dir` in the CLI). Metadata and target discovery accept an optional `environment` (`--environment`); omission reports all environments. `project_envs` returns the entire environment inventory. No command selects the first environment or last dashboard workspace implicitly.

```text
pio-agent project-envs --project-dir C:/firmware --json
pio-agent project-metadata --project-dir C:/firmware --environment esp32 --json
pio-agent list-targets --project-dir C:/firmware --environment esp32 --json
```

`project_envs` preserves Core's nested/multiple `extends`, common `[env]` settings, dynamic substitutions and extra configuration files. It reports board, platform, framework, monitor/upload settings, dependencies and flags for each environment. `defaultEnvironments` contains declared defaults, or all environments when no default is configured. This is computed configuration, not proof of which physical board is connected.

Metadata includes definitions, compiler paths/flags, program and debug paths, library source directories, flash-image/offset extras, and target descriptors. Build include paths are capped at 40 with their original count; toolchain include count is separate. Known secret fields/assignment patterns are redacted. JSON is bounded to 10 MiB with structure/array limits. Wrong environment identities, duplicate configuration entries, invalid defaults and malformed output fail explicitly. Missing target metadata is unavailable, rather than a successful empty target set; an explicitly empty target array remains valid.

Metadata generation and target discovery can execute project scripts and install dependencies. Read-only policy denies those operations. Listing a target does not run it or authorize its effects. Named target execution, effect classification, artifact/device binding and common build locks remain separate implementation work. Program paths and image offsets in metadata are reported evidence, not a retained build/upload identity manifest.

Both MCP and CLI use the same validated handlers, scoped approvals and policy revision checks. CLI approvals use the existing operator interaction. The server retains the command's exit status and bounded failure tail; it does not treat malformed JSON or a failed subprocess as success. The new adapters currently require explicit project paths and do not yet provide the reference aliases/result formats or dashboard controls.

[Live Windows MCP evidence](reviews/project-inspection-mcp-windows-evidence.json) verifies nested/multiple inheritance, common settings, an extra INI file, a default that is not the first environment, read-only configuration access and metadata denial, plus metadata/target discovery for the repository-owned ESP32-S3 fixture. Reproduce with [verify-project-inspection-mcp.ts](../scripts/verify-project-inspection-mcp.ts). It performs no device operations.

Behavior follows PlatformIO's [computed configuration](https://docs.platformio.org/en/latest/core/userguide/project/cmd_config.html), [build metadata](https://docs.platformio.org/en/latest/core/userguide/project/cmd_metadata.html), and [target listing](https://docs.platformio.org/en/latest/core/userguide/cmd_run.html) documentation and the installed Core 6.1.16 source. Cross-platform and full parity acceptance remain open.
