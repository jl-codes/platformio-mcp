# Modern package management

The canonical MCP tools `pkg_search`, `pkg_install`, `pkg_uninstall`, `pkg_list`, `pkg_outdated`, and `pkg_update` use PlatformIO's modern package commands. Existing library tools retain their original names and behavior. CLI equivalents replace underscores with hyphens.

| Tool | Arguments | Server policy action |
| --- | --- | --- |
| `pkg_search` | `query`, optional `kind` (library/platform/tool), `page` | `search_libraries` |
| `pkg_install`, `pkg_uninstall` | `projectDir`, `spec`, optional `environment`, `kind` | `install_library`, `uninstall_library` respectively |
| `pkg_list`, `pkg_outdated` | `projectDir`, optional `environment` | `build_project` |
| `pkg_update` | `projectDir`, optional `environment` | `update_library` |

An omitted environment applies to the project's environments as PlatformIO defines them. Project operations require an explicit directory; they do not select a dashboard's last workspace. `kind` defaults to `library`; an empty search query lists that kind. Registry specifications, version constraints, repository URLs, and local `file://` specifications are passed as individual arguments, without a shell. Use an external credential helper for private repositories; embedded URL credentials are rejected before approval/execution. These project tools do not accept `global`, arbitrary arguments or custom storage locations. Existing global library operations remain available through the legacy tools.

```text
pio-agent pkg-search --query ArduinoJson --kind library --page 1 --json
pio-agent pkg-install --project-dir C:/firmware --environment esp32 --spec bblanchon/ArduinoJson@^7 --json
pio-agent pkg-list --project-dir C:/firmware --environment esp32 --json
pio-agent pkg-outdated --project-dir C:/firmware --environment esp32 --json
pio-agent pkg-update --project-dir C:/firmware --environment esp32 --json
pio-agent pkg-uninstall --project-dir C:/firmware --environment esp32 --spec bblanchon/ArduinoJson --json
```

Package inspection is not necessarily pure file reading. PlatformIO Core 6.1.16 loads installed platform Python code for project list/outdated commands, so those new tools require build permission and are marked as capable of side effects. Install/uninstall/update retain their respective library-management permission categories. Approval requests also bind the concrete package operation, directory, environment, specification and kind; an approved request cannot be substituted or replayed. CLI approval follows the existing interactive/explicit `--approve` behavior. MCP does not approve requests.

PlatformIO determines the dependency changes and versions. Since its save operation rewrites INI files, the server merges only permitted dependency-option changes back into the original text, preserving unrelated settings, comments and line endings. Ambiguous syntax or unexpected changes return `PACKAGE_CONFIG_CONFLICT`; inspect the file before retrying because the subprocess may already have changed packages or configuration. New package handlers serialize against each other per real project directory and check policy revisions before execution and before the merge. This is not yet a common lock with legacy library/build operations, nor a sandbox against arbitrary same-user processes.

Results retain `exitCode`, a bounded 40-line/32-KiB `outputTail`, and a private redacted `logPath` for project commands. Configuration evidence contains before/after hashes and a `changed` flag, never file contents. At most 200 completed package logs are retained. Search returns a nullable log path and bounded result rows. Core 6 search/list text parsers preserve package kinds, environment context and explicit registry identities; a display name is not promoted into an owner-qualified registry identity. Unknown or incomplete output is reported as such, rather than as an empty successful dependency set. Outdated output remains the CLI report. Package subprocess output uses UTF-8 on Windows.

Verification uses [the reproducible MCP acceptance script](../scripts/verify-package-mcp.ts), a separate PlatformIO core, local data-only platform/tool/library fixtures, and one public registry search. [Windows evidence](reviews/package-mcp-windows-evidence.json) records all six operations. No firmware is built or device accessed by this acceptance run.

Remaining parity work includes opt-in reference aliases/result shapes and default-directory resolution, dashboard package controls, modern global-package scope, common locks across all package/build adapters, and the release/platform acceptance gates. These canonical tools alone do not complete PAR-24 through PAR-29.

Command behavior is grounded in PlatformIO's [package installation](https://docs.platformio.org/en/latest/core/userguide/pkg/cmd_install.html), [package listing](https://docs.platformio.org/en/latest/core/userguide/pkg/cmd_list.html), and [registry search](https://docs.platformio.org/en/latest/core/userguide/pkg/cmd_search.html) documentation and the installed Core 6.1.16 command source.
