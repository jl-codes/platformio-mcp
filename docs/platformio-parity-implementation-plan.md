# PlatformIO MCP feature parity, permission integration and namespace protection plan

## Goal Description

Deliver one complete implementation PR to `jl-codes/platformio-mcp` that adds the capabilities of `powerdragonfire/platformio.mcp` while retaining every supported PlatformIO MCP / PIO Agent workflow. Offer the alternative tool vocabulary and compact workflow as an opt-in. Keep the existing TypeScript runtime, npm packages, CLI, dashboard, plugins, device coordination, diagnostics, and reports as the canonical implementation.

The requested `jl-codex/platformio-mcp` is interpreted as `jl-codes/platformio-mcp`, the verified workspace Git remote. This document plans the implementation PR; it does not claim that the implementation or PR already exists.

Success means complete behavioral coverage of the **40 registered reference tools at the frozen revision below**, usable installation choices, correctly sourced permissions, and verifiable project identity across the supported distribution channels. Existing users must not need to switch tools or enable compatibility mode to obtain new capabilities. Safety defects are corrected explicitly rather than preserved as compatibility behavior.

Namespace protection means maintaining controlled names, authentic installation paths, provenance and a bounded lookalike watchlist. It cannot mean owning every similar string or preventing an independent project from existing. The other repository's similar name does not establish malicious intent; document the collision and authorship without alleging malware or impersonation without evidence.

### Baseline and evidence

- Inspected local revision: `a88b6351e875053fe6744b158770f2f2a62929c4`, with unrelated working-tree changes already present. Do not include or overwrite those changes.
- Review performed on 2026-09-19. Product upstream SHA: `40e12ccb8e85fcaf33b46c50b6d832665728e773`. Reference SHA: `a7b31021982f20b5406eaf80732899f8e75bd464`. The [checked-in source inventory](reviews/platformio-parity-baseline.json) records 40 tool names, proposed canonical actions, parameter declarations and source hashes extracted without executing reference code. The earlier 29-tool README is stale relative to this reference commit.
- The current upstream README describes a newer PIO Agent release with a 42-tool registry, target resolution, monitor health, task cancellation/history, and additional policy profiles. The local checkout has an older 34-tool registry. Implement against the selected pinned product base, not this older snapshot; select a newer base only after the documented impact review. Reconcile every finding below before changing code and reuse fixes already upstream.
- Use the pinned registered source as the parity baseline, including debugger, OTA, partition/core-dump, power and telemetry modules. [Pinned registry](https://github.com/powerdragonfire/platformio.mcp/blob/a7b31021982f20b5406eaf80732899f8e75bd464/src/platformio_mcp/tools/__init__.py). Later competitor features require a separately approved scope update, not automatic expansion of this goal.
- The current product's dashboard, CLI, board audits, reports, policies, and plugin workflows remain part of the acceptance baseline. [PIO Agent](https://github.com/jl-codes/platformio-mcp).
- Existing local plans for the Codex plugin, premium control plane, and firmware verification remain independent. Reuse already shipped capabilities; this PR must not require implementing those entire plans.

## User Review Required

> [!IMPORTANT]
> **Permission authority is explicit.** Codex resolves and enforces its host settings; the server resolves its hardware policy. Both must permit execution. Do not translate `approval_policy = "never"`, a permissive sandbox, or a tool invocation into blanket hardware approval. Do not silently overwrite the user's Codex tool settings during installation or update.

> [!IMPORTANT]
> **Compatibility is additive.** Preserve existing names, arguments, response fields, command aliases, package identities, monitor filters, dashboard behavior, and policy profiles. Invalid policy input, unknown actions, forged approval flags, and mismatched/replayed approvals are deliberate safety corrections with migration notes.

> [!NOTE]
> **Installation parity uses one engine.** Provide an optional `uvx` entry point with a packaged Node runtime and optional PlatformIO dependency, so users need not install Node separately. Describe it accurately as Python-launched, not Python-native. A second Python implementation would duplicate the policy and hardware engine and is outside this design.

These are implementation decisions and reviewer callouts, not requests to pause planning. Registry publishing and any physical test requiring an unbound device remain release/test operations with their own existing authorization requirements.

> [!IMPORTANT]
> **The PyPI name collision already exists.** `platformio.mcp`, `platformio-mcp` and `platformio_mcp` normalize to one PyPI project, currently linked to `powerdragonfire/platformio.mcp`. npm ownership does not confer PyPI ownership. Do not attempt to publish over it or imply that another spelling is free. Use the approved project-owned distribution names in section 9.

## Proposed Changes

### 1. Freeze scope and compatibility contracts

[NEW] [parity manifest](../tests/fixtures/parity/reference-manifest.json), [compatibility contracts](../tests/parity-contract.test.ts), and [parity reference guide](platformio-parity.md).

Start from the pinned product baseline, or explicitly record a newer product base and review its change impact. Keep the reference SHA fixed. Expand the existing source inventory into the executable contract manifest: resolve named default constants, derive MCP schemas with a pinned isolated reference runtime, enumerate result variants and accepted safety divergences, and attach tests to each `PAR-01` through `PAR-40` requirement. Reference server startup/schema enumeration may run only in an isolated test environment with no devices or credentials; never invoke hardware tools merely to inspect a schema. Inventory all current product surfaces and record baseline checks and pre-existing failures. No moving `main` references in test fixtures.

The manifest maps every reference tool to a canonical action, its legacy equivalent where available, capability requirements, result adapter, and acceptance test. Keep reference-derived fixtures small, attributed, and licensed; implement the behavior in the existing engine. Preserve copyright/license notices for any adapted code and record provenance in [third-party notices](../THIRD-PARTY-NOTICES.md).

| Reference tool(s) | Required implementation and parity acceptance |
| --- | --- |
| `pio_system_info` | Reuse system information; add resolved executable/version, effective policy provenance, capabilities, and actionable doctor results. |
| `pio_list_boards`, `pio_board_info`, `pio_list_devices` | Reuse existing discovery; map reference filters, limits, memory/clock fields and device hints without treating a hint as confirmed device identity. |
| `pio_project_init`, `pio_project_envs`, `pio_project_metadata` | Use PlatformIO initialization and resolved configuration/metadata; include inherited environments, defaults, board/framework, port/baud, definitions, include paths, build and toolchain locations. |
| `pio_build`, `pio_upload`, `pio_clean` | Reuse build/upload/clean services and cache; add compact results, source-located errors/warnings, memory summaries, timing and retained log references. Preserve background execution and port recovery. |
| `pio_list_targets`, `pio_run_target` | Expose existing target helpers through the shared dispatcher; classify filesystem builds, uploads, erase, and custom targets by actual effects before execution. |
| `pio_monitor_start`, `pio_monitor_read`, `pio_monitor_write`, `pio_monitor_stop`, `pio_monitor_list`, `pio_monitor_capture` | Provide bounded sessions, cursor reads, regex waits, serial writes, listing and one-shot capture, with shared ownership and lock enforcement. |
| `pio_test`, `pio_check` | Preserve existing runners; return per-case test results and structured static-analysis defects with severity, location and CWE when available. |
| `pio_pkg_search`, `pio_pkg_install`, `pio_pkg_uninstall`, `pio_pkg_list`, `pio_pkg_outdated`, `pio_pkg_update` | Add modern package coverage, including reference-supported package kinds/scopes, environment selection and persisted dependency changes. Preserve legacy library commands. |
| `pio_flash_and_verify` | Reuse the existing verification workflow, adding crash decoding and reference-compatible arguments/results without weakening existing stability assertions. |
| `pio_decode_backtrace` | Add dedicated crash decoding against a matching ELF, usable with supplied text or an owned serial session. |
| `pio_size_report` | Add sections, symbols, file attribution, filters and memory-budget reporting against an existing ELF. |
| `pio_port_diagnose` | Add bounded port diagnostics; distinguish OS visibility, busy ownership, transport errors and possible reset effects. |
| `pio_upload_ota` | Add scoped network firmware/filesystem upload with protocol-specific configuration, secret handling and independent runtime verification. |
| `pio_partition_table`, `pio_coredump` | Resolve ESP32 partition layout and decode permitted core-dump inputs with correct offsets, artifact identity and bounded sensitive-data retention. |
| `pio_power_profile` | Support serial-derived power samples and the reference PPK2 meter path with explicit measurement/source modes and physical limits. |
| `pio_deps_check` | Audit declared/installed dependencies, name collisions/shadowing, unpinned/missing/leftover libraries, manifest cycles and optional build-derived LDF graph; distinguish evidence from heuristic warnings. |
| `pio_memory_watch` | Analyze heap/stack telemetry, sample-window trends, units and missing instrumentation without claiming an unobserved leak. |
| `pio_debug_start`, `pio_debug_cmd`, `pio_debug_stop`, `pio_debug_list` | Add persistent GDB/MI sessions, owned debug-probe access, bounded command/results, target-effect permissions and defined detach/stop behavior. |

These rows cover all 40 tools. The JSON inventory provides a separate requirement ID and exact parameter declaration per tool; executable input/output contracts remain S0 work and are not claimed to pass yet.

### 2. Centralize action execution and optional compatibility

[MODIFY] [MCP entry point](../src/index.ts), [CLI](../src/cli.ts), [schemas](../src/types.ts), [API server](../src/api/server.ts), and existing `src/core/` services.

[NEW] [action catalog](../src/core/action-catalog.ts), [action dispatcher](../src/core/dispatch-action.ts), [compatibility adapter](../src/adapters/platformio-compat.ts), and [result summaries](../src/core/result-summary.ts). Reuse equivalent upstream modules instead if already present.

- Every legacy name, new canonical name, CLI command, API route and compatibility alias resolves to one canonical action and validated effects. Authorize at this shared boundary, including internal composite steps, before any process, serial connection, package change or file write.
- Normal mode retains all current tools and adds canonical analysis/package/session capabilities. `--compat platformio-mcp-python` (or `PIO_MCP_COMPAT=platformio-mcp-python`) additionally advertises the reference `pio_*` tools. Existing tools remain callable. Invalid mode values fail validation.
- Compatibility changes names, argument mapping and output shape only. It cannot select a more permissive policy, disable locks, or create separate hardware sessions. Canonical restrictions apply equally to aliases; test host tool lists and alias exposure to avoid accidental re-enablement.
- Preserve existing result fields and status semantics. Reference adapters provide `ok`, concise `summary`, structured details and a nullable `log_path`; new canonical fields are additive. Report pending approvals, queued tasks, cancellation and timeouts as non-success states without claiming completion.
- Bound text tails, result sizes, regex work and process time. Keep full output in managed local artifacts, with existing redaction and access restrictions. Reference-compatible defaults use a 40-line command tail and 200 completed log files unless configured; never delete active artifacts or files outside the log root. Preserve existing product defaults outside compatibility mode.
- Task history, dashboard events, cancellation, persistent reports and CLI JSON all use the same action/result objects. Use structured errors and deterministic summaries, not an extra model call.

### 3. Fix permission resolution and defaults

[MODIFY] [policy loader](../src/core/policy/load-policy.ts), [profiles](../src/core/policy/profiles.ts), [evaluator](../src/core/policy/evaluate-policy.ts), [policy types](../src/core/policy/types.ts), [approval store](../src/core/policy/approvals.ts), [status](../src/core/policy/status.ts), and [paths](../src/utils/paths.ts).

[NEW] [policy schema](../src/core/policy/policy-schema.ts), [configuration provenance](../src/core/policy/policy-sources.ts), and [permissions guide](permissions.md).

#### 3.1 Correct source of authority

Codex host policy belongs in the effective Codex configuration. User configuration normally lives at `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`); project layers, selected profiles, launch overrides and managed requirements can change the effective value. A server reading one file cannot reconstruct or override all of that state. Let Codex enforce its resolved host policy. [Official configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic).

Preserve and document the documented server-specific controls: `mcp_servers.<id>.enabled`, `enabled_tools`, `disabled_tools`, and `default_tools_approval_mode`. For a bundled plugin, preserve the corresponding `plugins.<plugin>.mcp_servers.<server>` controls and documented per-tool approval settings, using the installed identity rather than guessing it. [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), [plugin configuration](https://developers.openai.com/plugins/build/plugins).

Hardware permissions remain in the existing PlatformIO policy files. Add an explicit launch-time `--policy-file` / `PIO_MCP_POLICY_FILE` selector for an operator-controlled JSON or YAML policy. Codex can pass this server option through its documented command/arguments or environment configuration. Other MCP hosts and standalone CLI users use the same server configuration mechanism.

Do not add arbitrary PlatformIO policy keys to Codex's TOML schema. Do not read credentials or dump full host configuration in diagnostics. `get_policy_status` must distinguish `serverPolicy` from `hostPolicy`: report host enforcement as external/unknown unless a supported trusted host interface supplies effective state. A file read for troubleshooting is labeled a configured snapshot, never a verified runtime grant. This PR does not invent an approval-token protocol or require a new Codex API.

#### 3.2 Resolution, trust and migration rules

1. Separate policy storage from writable log/cache fallback paths. A permission file must not silently move to the current directory or a temporary directory when the intended user location is unavailable.
2. With no configured source, retain `flash_requires_approval`. Known inspection/build operations remain usable; hardware mutations require the existing approval path. Missing optional policy is different from an explicitly selected missing file.
3. Validate the existing order: built-in profile -> project `.pio-mcp-policy.json` profile/overrides -> operator global `policy.yaml` -> project `.pio-mcp-workspace/policy.yaml`. Maintain valid legacy outcomes unless they weaken an operator restriction; show all contributing layers and conflicts instead of reporting only the profile file.
4. An explicit launch policy replaces the legacy operator-global source. Error on conflicting flag/environment selections rather than picking silently. Its denies, approval requirements and mandatory boundaries are a ceiling: project layers may narrow them but cannot relax them. Apply this ceiling to legacy global restrictions as well. Document changed outcomes with exact migration examples.
5. Project policy that expands permissions requires operator enrollment outside the project (real path plus content digest). Restrictive project policy can apply immediately. A changed permissive file invalidates that enrollment. Preserve valid `lab_admin` and upstream `lab_runner` behavior through explicit enrollment/scoping; do not remove those capabilities.
6. Parse JSON/YAML with real parsers and strict schemas. Unknown profiles/actions/keys, malformed booleans, invalid lists, unreadable selected files and conflicting declarations produce `POLICY_CONFIG_INVALID` with location/remediation. Never reinterpret malformed JSON as valid empty YAML, and never fall back to `full`, `lab_admin` or an implicitly permissive default.
7. Invalid policy blocks execution, while a small recovery surface remains available: policy status/doctor, bounded status inspection, and cancellation/cleanup of already-owned processes or sessions. Recovery cannot run project scripts, open a new device, reset hardware or change policy.
8. Remove implicit unknown-action allowance. Authorization requires an explicitly catalogued action allowed by its profile, or a valid scoped approval for an approval-required action. Explicit deny wins. Empty allow lists stay empty. Populate profiles for every existing action before enabling this change.
9. Evaluate hardware effects for tests, targets, serial writes and composite workflows. `pio test` can upload; build-only mode must prevent that upload. A custom target can execute project code: require an explicit classification/grant, not inference from its name. Metadata/check-size operations that invoke build scripts require build permission; offline ELF reading can remain inspection-only.
10. Bind approvals to canonical action, normalized arguments, project/environment, stable device identity, artifact identity where applicable, policy digest, expiry and single-use execution. Consume atomically; retries refer to the same execution record. Reject expired, denied, changed-target, changed-artifact, replayed and caller-forged `approved`/`__approved` inputs. Preserve authenticated human approval interfaces and upstream fixes already implementing this.
11. Evaluate policy again before queued work starts and before each mutation stage. Changed policy invalidates grants; cancellations and cleanup remain possible. The compatibility option and tool annotations never serve as authority.

12. Distinguish native tests, embedded compile-only tests and embedded hardware tests. Compile-only runs must pass both `--without-uploading` and `--without-testing`; skipping upload alone can still open/reset a device during testing. [PlatformIO test stages](https://docs.platformio.org/en/latest/core/userguide/cmd_test.html).
13. Separate dashboard viewing/operation tokens from approval-grant authority. An MCP-returned dashboard URL/token must not authorize approval mutation routes. Use the existing upstream trusted approval channel if it has this separation; otherwise add a human/operator approval capability that is never returned through MCP or ordinary dashboard launch APIs. Test the complete get-dashboard-URL -> approve-request attack path, not only the evaluator. A bearer token proves possession, not human intent.
14. Define the threat model: project scripts, package hooks, toolchains and privileged debugger commands execute code. Server profiles constrain this API's behavior; they are not an OS sandbox and cannot contain an adversarial process with unrestricted access to the same user's files/credentials. Protected approval state/enrollment requires a trusted host/operator boundary. Document this limit and do not promise that build-only blocks malicious `extra_scripts` from using hardware. [PlatformIO scripting](https://docs.platformio.org/en/latest/scripting/index.html).

Make policy decisions deterministic: apply an explicit deny first; then operator ceilings; then profile/project grants; then any valid scoped approval. Treat configuration errors as errors, not implicit denials that another layer can override. Enrollment uses a versioned digest of the exact normalized policy plus real project path, stored in the operator policy directory; expose explicit CLI enroll/revoke commands for the operator. An agent-callable boolean is never enrollment. Add a decision table for every action/effect in every retained profile, including upstream `monitor_only` and `lab_runner` when present.

The local snapshot contains permissive unknown-action logic, weak file validation and caller-supplied approval flags. These are verified local findings, not claims that all remain in current upstream. The implementation must close any that remain and retain regression tests for all of them.

#### 3.3 Preserve Codex settings during installation

[MODIFY] [Codex installer](../scripts/installers/codex.js), [shared installer](../scripts/installers/_shared.js), and the current upstream plugin installer/launcher.

- Resolve `$CODEX_HOME` correctly and preserve explicit configuration paths. Update only owned launch fields; retain server environment values, enabled/disabled tool lists, approval modes, unrelated tables and comments. Do not replace the entire MCP block.
- Use a TOML-aware, round-trip-preserving edit strategy, atomic writes and backups. Invalid existing TOML must produce an actionable error without rewriting it. Reinstallation must be idempotent.
- Respect existing host settings instead of installing unconditional approval defaults. Offer an explicit operator-selected policy-file option. Changing compatibility mode must not broaden either host or server policy.
- Host tool controls are name-based: Codex cannot be assumed to know that two names are aliases. During an explicitly requested compatibility installation, map existing canonical denies and per-tool approval settings to the corresponding aliases in the same edited scope; retain existing entries and never expand a host allow list implicitly. For manual configuration, provide the equivalent mapping and warn that an alias has its own host tool entry. Do not claim that the server can discover hidden host-layer restrictions. Managed/project-layer restrictions must be verified by the host integration acceptance check before advertising that migration as preserving effective permissions.
- Add permission-source display to doctor and the existing dashboard policy view. Explain which layer blocked an operation without claiming visibility into unavailable host state. Do not introduce duplicate approval prompts where a supported, scoped authorization already exists; absent such evidence, retain server approvals.

### 4. Implement shared ELF/toolchain analysis

[NEW] [toolchain resolver](../src/core/analysis/toolchain-resolver.ts), [ELF identity](../src/core/analysis/elf-identity.ts), [crash decoder](../src/core/analysis/crash-decoder.ts), [size report](../src/core/analysis/size-report.ts), and [analysis tools](../src/tools/analysis.ts).

- Resolve compiler, `addr2line`, `nm`, `size`, environment and ELF from PlatformIO metadata and package locations. Handle quoted paths, spaces, Unicode, Windows executables and multiple environments. Never select the first unrelated toolchain on PATH or interpolate a shell command.
- Support reference crash formats: ESP32 Xtensa backtraces/registers and Cortex-M PC/LR dumps, causes/reset reasons, corrupted traces and inline frames. Preserve raw addresses, normalize Xtensa return-address window bits only for the correct architecture, deduplicate with bounded limits, and retain unresolved frames.
- Dedicated decoding accepts text or an owned monitor session, an explicit environment and optional ELF. Return function/file/line/inline frames, cause, reset reason, resolved count and artifact provenance. Avoid treating arbitrary data addresses as program counters unless explicitly requested.
- Retain a content-addressed build/upload manifest linking the ELF, every uploaded image and offset, toolchain, environment and build settings. Hashes of unrelated files do not prove correspondence. Hold a project/environment lock through final artifact capture and upload, or upload immutable captured files; if the uploader rebuilds, capture/re-authorize its final manifest before the actual write. Do not use the existing newest-file heuristic to select the ELF. A known mismatch is an error; absent evidence is `identity_unverified`. Preserve old ELF/images across later builds so earlier crashes remain decodable. Test a rebuild racing with a queued upload and decoding after a later rebuild. Missing/stripped symbols produce actionable partial results.
- Size reports use GNU section/symbol data, demangled names, file/line attribution, top-N and bounded filters. Prefer PlatformIO partition-aware accounting when authorized; label offline estimates explicitly. Avoid double-counting sections, aliases or inline contributions; keep unknown file attribution visible. Static RAM excludes heap/stack peaks.
- Read an existing ELF without compiling in read-only mode. If accurate partition data requires `checkprogsize` or metadata execution, request build permission separately; absence of that permission must not trigger hidden compilation/downloads. Unsupported binary formats/toolchains return a capability error.
- Add canonical `decode_backtrace` and `size_report` MCP tools and CLI commands, plus the reference aliases. Support JSON reports and dashboard access to results without requiring the dashboard to be open.

### 5. Complete serial and verification parity

[MODIFY] [monitor tools](../src/tools/monitor.ts), [monitor core](../src/core/monitor.ts), [verification workflow](../src/tools/agent.ts), [runtime assertions](../src/core/runtime-assertions.ts), [spooler](../src/utils/spooler.ts), and existing lock/process management.

[NEW] [session service](../src/core/serial/session-manager.ts) and [serial transport](../src/core/serial/serial-transport.ts), unless upstream equivalents exist.

- Keep the current PlatformIO monitor/filter path operational. Add an explicit direct-serial transport for session read/write parity, using a pinned maintained serial implementation. Both backends share the same global port registry, ownership, device identity, cancellation and cleanup. Do not silently drop PlatformIO filters in direct mode; report the capability difference.
- Support multiple disjoint sessions; reject a second owner of the same device across processes. A monitor may release/reacquire only its own port around a permitted upload. Handle device re-enumeration using established target resolution, not just a remembered port name.
- Use one stable per-user device/probe lock root independent of log/cache paths and `PIO_MCP_DATA_DIR`, shared by npm, plugin and wheel launches. Canonicalize aliases to stable physical identity; record owner process start identity plus nonce, not PID alone. Use atomic acquisition/handoff and verify stale ownership before recovery. Session IDs identify sessions but do not authorize callers. Test simultaneous launches with different working directories/data paths and PID reuse.
- Reads return session/cursor, bounded lines, partial line, dropped-line count, next cursor and disconnect/error state. Bound memory, wait time, write bytes and regex evaluation. Distinguish stale cursors, normal timeouts, stopped sessions and disconnected devices.
- Writes support defined text/encoding/newline behavior; any binary support must be explicit. Authorize before writing. Opening a port may toggle reset lines, so configure and classify DTR/RTS behavior rather than assuming every monitor start is side-effect-free.
- One-shot capture uses the same service with `finally` cleanup; it must not stop another caller's session. Server shutdown, task cancellation and failed opens release owned resources.
- Extend existing flash/monitor verification with optional auto-decoding. Preserve `expectAll`, rejection patterns, boot-loop detection and stability windows. An early boot marker followed by a crash must fail the established stability test. The reference adapter translates its regex parameters; document stricter safety behavior rather than duplicating unsafe early-pass behavior.
- Preserve literal substring matching for existing assertion arguments. Add explicit regex mode for new/reference parameters using a documented ECMAScript-compatible subset; translate supported Python named-group syntax and reject unsupported constructs clearly. Run regex evaluation in a terminable worker with input/work limits; a Promise timeout around synchronous RegExp is insufficient. Test adversarial backtracking, named groups, malformed patterns and literal metacharacters in legacy inputs.
- Capture sufficient bounded post-crash output for symbolication. Decoder failure cannot change a crash verdict to success. Return upload failure, runtime failure, timeout, disconnection and inconclusive evidence distinctly; persist reports with exact target/artifact identity.

### 6. Finish metadata, package, target and quality tools

[MODIFY] [project tools](../src/tools/projects.ts), [build tools](../src/tools/build.ts), [library tools](../src/tools/libraries.ts), and [PlatformIO executor](../src/platformio.ts).

[NEW] [package service](../src/core/packages.ts), [quality parsers](../src/core/diagnostics/quality-parsers.ts), and [target effect classification](../src/core/target-effects.ts).

- Use resolved PlatformIO configuration for environment inheritance, including multiple/nested bases and common settings. Keep current project inspection and readiness validation outputs compatible.
- Expose target discovery and execution without a generic shell escape. Maintain locks, timeouts, spooled logs, task tracking and policy for built-in and custom targets.
- Prefer supported PlatformIO JSON outputs; use tested version-specific parsers only where necessary. Test/analysis failures preserve exit status and partial parsed evidence, including skipped/failed cases and unparsed output. Do not report an empty parse as successful testing.
- Expand package management beyond library-only wrappers where required by the pinned reference. Support search, install/uninstall, list/outdated/update, versions and environment/scope selectors. Project operations persist dependency changes through PlatformIO; global operations require explicit scope and policy. Preserve unrelated INI entries/comments and report changes.
- Resolve explicit PlatformIO executable selection, PATH and the existing `~/.platformio/penv` installation consistently across all commands. Add doctor diagnostics without installing anything implicitly.

#### 6.1 Complete the additional eleven reference tools

[NEW] [debug service](../src/core/debug/debug-session.ts), [GDB/MI parser](../src/core/debug/gdb-mi.ts), [OTA service](../src/core/ota.ts), [flash inspection](../src/core/analysis/flash-inspection.ts), [telemetry analysis](../src/core/analysis/telemetry.ts), [power meter adapter](../src/core/power/power-meter.ts), and [dependency checks](../src/core/dependency-checks.ts).

- **Debugger:** implement GDB/MI token matching, asynchronous stop events, session/probe locks, cancellation, bounded output and debugger exit cleanup. Starting/loading/halting/stepping/writing registers or memory affect the target. `shell`, `python`, `source` and raw command escape paths can execute host code: default-deny those unless an explicit privileged debugger grant permits them. Preserve useful inspect/break/step/continue commands with classified effects; reject unknown commands before sending them. Debug stop may resume/reset the target, so define separate authorized detach/resume and process-only cleanup paths. Never treat all stop commands as harmless recovery.
- Start GDB with controlled initialization (`-nx` and early `set auto-load off` before loading ELF/core files), with only explicitly trusted initialization exceptions. Inspect mode disables target function calls (`set may-call-functions off`) and rejects assignments, command separators and MI escapes; `print foo()` is not inherently read-only. Test untrusted `.gdbinit`, ELF auto-load scripts/pretty-printers and mutating expressions, including indirect command paths. [GDB auto-loading](https://www.sourceware.org/gdb/current/onlinedocs/gdb.html/Auto_002dloading.html), [target function calls](https://www.sourceware.org/gdb/current/onlinedocs/gdb.html/Calling.html).
- **OTA:** implement reference-supported ESP32/ESP8266 firmware/filesystem upload through the shared executor, with an explicitly bound network target and artifact. Preserve secret redaction; keep credentials out of logs/reports/process listings where the uploader supports secure input. Report protocol failures accurately. ICMP reachability is diagnostic only: failed ping must not prove that OTA is unavailable. Network upload success does not prove runtime health; use a separately configured observation path.
- **Partitions/core dumps:** resolve chip/project partition offset and effective table instead of assuming `0x8000` or a generic framework default. Support offline input first; explicit device reads can reset hardware and require the corresponding permission. Parse lengths/offsets defensively. Use version-pinned optional `esp-coredump` tooling when required, with immutable matching ELF and private dump retention/redaction. Report unsupported/encrypted formats explicitly.
- **Power:** implement serial samples and optional `ppk2-api` integration as typed adapters. A measurement request cannot silently select source mode. Source mode must bind meter and DUT, require approved voltage/current limits and power permission, and define output-off cleanup on failure/cancellation. Measure actual sample-window duration and units; report whether values are firmware estimates or meter measurements. Optional dependencies are installed only by an explicit setup action and tested before advertising availability.
- **Memory/dependencies/ports:** preserve heap/stack metric units (including FreeRTOS words versus bytes), timestamps and sampling windows; identify insufficient samples/instrumentation rather than infer a leak. Dependency diagnostics audit declared-versus-installed libraries, collisions/shadowing, unpinned/missing/leftover entries, library manifests/cycles and optional build-derived LDF graph. Cite installed versions and evidence; do not claim a proven link winner from static inspection or replace this scope with a version solver. `build=true` requires build permission. Port diagnostics distinguish unknown holder/permission status from a free port and never open/reset a device, kill unrelated processes or change OS permissions automatically.

Expose these through canonical tools/CLI, the same reference adapters and the existing dashboard result path. Include all optional backends in the release capability manifest with installation requirements; dependency absence produces a clear capability-unavailable result, not a passing stub. Full acceptance exercises each claimed backend with its dependencies present.

### 7. Optional installation and host integration

[MODIFY] [package manifest](../package.json), existing installers, current plugin bundle/skills and CI release scripts.

[NEW] [Python launcher package](../packages/python-launcher/pyproject.toml), [launcher](../packages/python-launcher/src/pio_agent_launcher/__main__.py), and [launcher acceptance tests](../tests/python-launcher.test.ts).

- Preserve npm `platformio-mcp` and all upstream `pio-agent`/`pio-mcp` aliases and plugin identifiers. Optional compatibility must not affect default installs.
- Build versioned platform wheels containing the same tested runtime bundle plus a pinned redistributable Node runtime. Canonical planned PyPI distribution: `pio-agent-platformio`, subject to verified publication control before release. Provide useful `pio-agent` and `pio-mcp` compatibility launcher distributions if those names can be controlled; each pins the exact canonical release. Never use the competitor's normalized PyPI name. Provide an explicit `uvx --from <distribution> pio-agent` command and optional `[platformio]` extra that installs a compatible tested PlatformIO Core in isolation.
- Target Windows x64, macOS arm64/x64 and glibc Linux x64/arm64. In S0, pin Python/Node versions, wheel tags, minimum OS/glibc versions, serial ABI/prebuilds, runtime licenses and exact CI runners in the support manifest. musl and Windows arm64 are excluded from this wheel release unless explicitly added and tested. Prove one wheel and signal/stdio forwarding early, then expand to the five-platform matrix. Unsupported platforms fail with a clear npm fallback, without silently downloading/executing an unverified runtime. Include checksums and software inventory.
- The wheel and npm paths execute identical action/policy code and pass identical contracts. Use wheel-built artifacts in fresh-environment tests; no dependency on this checkout or a globally installed Node. Python source purity is explicitly not claimed.
- Add reference-supported Claude Code, Cursor and Windsurf installation choices where missing; retain Claude Desktop, Codex, Cline, VS Code and other existing choices. Verify their current official schemas during implementation. Supply a print-only MCP configuration option and doctor command.
- Update skills/rules to teach crash decoding, size analysis, serial sessions and policy-source inspection. Preserve existing skill workflows. No post-install hardware action, host permission broadening or automatic dependency upgrade.

### 8. Documentation and dashboard integration

[MODIFY] [README](../README.md), [command reference](MCPServerCommandReference.md), [Codex guide](CODEX.md), [troubleshooting](TroubleshootingGuide.md), [changelog](../CHANGELOG.md), [policy view](../web/src/components/safety-policy-overview.tsx), and current report/dependency views.

Document opt-in setup, canonical/reference name mappings, supported architectures, serial transport differences, identity limits, size-estimate limits, permission-file locations, configuration precedence, and recovery from invalid policy. Include a migration example preserving customized Codex tool settings. Surface decoded frames, largest symbols and policy provenance through the current dashboard components; do not replace the dashboard or require a new UI for CLI/MCP use.

All new or modified TypeScript modules follow the house style: kebab-case filenames, module JSDoc, exported declaration documentation, PascalCase types/schemas, camelCase functions, typed errors, schema validation and project formatting/lint rules.

### 9. Namespace ownership, authentic distribution and lookalike detection

[NEW] [namespace inventory](../config/namespaces.json), [namespace schema](../config/namespaces.schema.json), [namespace audit](../scripts/audit-namespaces.ts), [authentic installation guide](official-installation.md), [namespace tests](../tests/namespace-identity.test.ts), and [audit workflow](../.github/workflows/namespace-audit.yml).

#### 9.1 Checked observations and bounded coverage

Read-only registry checks on 2026-09-19 found the following; [saved primary-name observations](reviews/platformio-namespace-observations.json) retain timestamps and distinguish publication metadata from control verification:

| Namespace/surface | Observed state | Required action |
| --- | --- | --- |
| npm `platformio-mcp`, `pio-agent`, `pio-mcp` | All latest versions `3.0.0`; repository metadata points to `jl-codes/platformio-mcp`; listed maintainer `forkbomb` | Preserve all three working names. Verify authenticated publication/admin control in release preflight; metadata alone is not proof of that control. |
| PyPI normalized `platformio-mcp` | Published as `platformio.mcp` version `0.2.0`; project links point to `powerdragonfire/platformio.mcp` | Record as third-party occupied; never install it as this product or treat punctuation changes as separate names. |
| PyPI `pio-agent-platformio`, `pio-agent`, `pio-mcp` | JSON endpoints returned HTTP 404 | Candidate primary/functional aliases; verify registry acceptance and operator control before release. A 404 does not prove a name is reservable. |
| npm punctuation/concatenation candidates | `platformio.mcp`, `platformio_mcp`, `platformiomcp`, `pio.agent`, `pio_agent`, `pioagent`, `pio.mcp`, `pio_mcp`, `piomcp`, `platformio-agent` latest endpoints returned HTTP 404 | Watchlist only until registry rules and useful alias need are verified. Do not imply these are protected or publish empty placeholders. |
| Owner-scoped npm | Candidate `@forkbomb/platformio-mcp`, using the observed maintainer identity | Require authenticated scope control; ship a tested exact-version alias only if that control is verified. This supplements the three existing unscoped names. |
| GitHub | Canonical `jl-codes/platformio-mcp` verified as the local remote | Protect this repository and release workflow. Owner-local `jl-codes/pio-agent` or `jl-codes/platformio.mcp` landing repositories are optional redirects only if available; another owner's same basename cannot be reserved. |
| MCP Registry | Proposed `io.github.jl-codes/platformio-mcp` | Verify GitHub namespace authority and publish the authentic runtime identity; no global ownership follows from the display name. |
| Codex/plugin/client IDs | Retain existing `platformio-mcp` plugin/marketplace/skill identifiers and installed MCP server keys | Verify marketplace source and pinned package provenance. A local server key or product title is not a globally reserved name. |
| Other distribution channels | Domains, Docker Hub/GHCR, VS Code/Open VSX, Homebrew, winget, Chocolatey and similar registries not audited/claimed here | Mark unsupported or unverified in the inventory. Add an owner-scoped authentic identity before advertising any future installer; do not fabricate ownership or publish unused packages. |

Primary registry metadata endpoints are [npm platformio-mcp](https://registry.npmjs.org/platformio-mcp/latest), [npm pio-agent](https://registry.npmjs.org/pio-agent/latest), [npm pio-mcp](https://registry.npmjs.org/pio-mcp/latest), and [PyPI platformio.mcp](https://pypi.org/pypi/platformio.mcp/json). Recheck during release; record timestamp and raw-response digest, not a permanent claim from this review.

The inventory must distinguish `observed_project_link`, `control_verified`, `published_verified`, `third_party`, `lookup_missing`, `registry_blocked`, `unknown` and `unsupported`. Each entry includes registry, exact name, normalization rule, canonical distribution, supported executable names, owner evidence, source URL, review timestamp, provenance status and operator. Never collapse a timeout/403/429 into availability. The initial operator role is the repository maintainer; S0 must record an accountable person before any release gate can pass.

#### 9.2 Registry-specific rules and installation behavior

- **PyPI:** lowercase and collapse runs of dot/hyphen/underscore for comparisons. `platformio.mcp == platformio-mcp == platformio_mcp`; likewise `pio.agent == pio-agent == pio_agent`. Import module names and executable names are separate namespaces. Test that a generated install command can never resolve this project's Python path to the occupied reference distribution. [Python normalization](https://packaging.python.org/en/latest/specifications/name-normalization/).
- **npm:** use npm's actual name/scope rules, not PyPI normalization. npm discourages confusingly similar unscoped names and may reject new lookalikes even after an absent lookup. Prefer the existing working names plus verified owner-scoped identity; do not promise registration of every punctuation variant. [npm guidelines](https://docs.npmjs.com/package-name-guidelines/), [scopes](https://docs.npmjs.com/cli/v11/using-npm/scope/).
- **MCP Registry:** use the owner-qualified server name and required package ownership metadata (`mcpName` for npm; `mcp-name` declaration for PyPI) pointing to the same server identity. Verify the package, publisher and repository together; display names and client-local MCP keys are insufficient. [Namespace authentication](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx), [package verification](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx).
- **Functional aliases only:** npm/Python alias packages delegate to an exact tested canonical version, preserve exit codes/signals/stdin/stdout, and offer the same useful CLI/MCP behavior. No empty placeholder packages, automatic package-manager fallback, unpinned `latest` runtime downloads or install-time scripts that retrieve code from similarly named projects. PyPI explicitly treats empty name-squatting projects as invalid. [PyPI name policy](https://docs.pypi.org/project-management/name-retention/).
- **Command identity:** document `npx --package platformio-mcp@<version> pio-agent` and `uvx --from pio-agent-platformio==<version> pio-agent` as explicit examples with actual release versions substituted. Preserve `platformio-mcp`, `pio-agent` and `pio-mcp` executables. Add `doctor --identity --json` reporting engine/distribution version, executable path, embedded build commit and canonical source. This is diagnostic metadata, not a cryptographic proof; verify it against package attestation before treating it as authentic. Test PATH collisions/co-installation and never silently uninstall or shadow unrelated software.

#### 9.3 Publishing and ongoing checks

- Configure package-by-package trusted publishing from a protected release workflow, pinned third-party actions, release environment controls, 2FA and recovery ownership. Prefer OIDC over long-lived tokens; verify emitted provenance/attestations for the actual supported provider. Stage the canonical package before exact-version aliases and run fresh registry-installed smoke checks before updating recommended installation commands. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/).
- Generate one release identity manifest containing artifact hashes, source commit, package versions, registry identifiers and attestations. npm/plugin/wheel documentation derives identities from the same inventory; CI rejects mismatched package names, source URLs, scope, executable aliases and version pins. Test a deliberately wrong-but-similar name and tampered artifact as negative cases.
- Implement a read-only namespace audit for the finite inventory plus a checked-in watchlist. Start with the three stems above, their punctuation/concatenation variants and explicitly approved common misspellings. Cap each run at 100 names, use caching/backoff, and retain status changes as evidence. Do not execute or install discovered packages.
- Run the audit on release and on a repository-controlled weekly schedule after the maintainer enables the workflow. Surface meaningful owner/repository/provenance changes, newly occupied candidate names and lookup failures through workflow status/artifacts; unchanged observations produce no new notification. A tested schedule is finite implementation work; operating it is ongoing maintenance. This review does not create a live monitor or send messages to third parties.
- Publish an authentic-installation table with exact registry links and source identity, and an incident procedure for suspicious changes. Maintainers assess evidence before reporting impersonation or requesting a transfer. Existing third-party projects and names that cannot be acquired are documented exclusions, not infinite blockers or automatic allegations.

Namespace acceptance is bounded: protect verified supported identities, test their functional aliases and install paths, configure authentic publication, and account for every inventory entry. It is impossible to prove that no future typo or competing project can exist. Account creation, domain purchases, publication, transfers and disputes are operator-owned release actions, never silently performed by the implementation goal.

## Goal Contract and Prerequisites

The implementation goal is: **produce one complete, reviewable PR against the selected product base that satisfies PAR-01 through PAR-40, retains the frozen legacy inventory, passes permission and namespace software gates, and records all required host/platform/hardware acceptance evidence.** Publication is a separate, explicitly requested release goal. Do not create or start either goal merely because this plan describes it.

Use three statuses: `implementation_complete` (code, local artifacts, docs and software tests), `acceptance_complete` (all required real host/platform/hardware evidence; PR may become ready), and `release_complete` (authorized publication/control checks and registry-installed verification). Finishing software must not be presented as full acceptance; missing publication must not prevent testing local artifacts. A draft PR and a precise blocker report are legitimate intermediate deliverables, not overall completion.

S0 creates [support and prerequisite manifest](../config/parity-support.json) with exact versions, runner/device identity, accountable executor and evidence path:

| Prerequisite | Assigned role and early proof | If unavailable |
| --- | --- | --- |
| Product/reference source and baseline checks | Implementation agent pins commits and captures introduced-vs-pre-existing failures | Stop dependent work on unresolved source mismatch; continue independent research |
| Node/Python/PlatformIO/serial/optional backends | Implementation agent pins supported versions and dependency locks; one early packaged-wheel launch | Record exact incompatibility; fix before expanding packaging matrix |
| Five OS/CPU wheel combinations | Repository CI maintainer supplies exact OS/libc/Python/Node/ABI runners; per-platform install/signal smoke | Build independent platforms; affected distribution acceptance remains blocked |
| Codex and other advertised host versions | Host-test operator provides isolated configs and actual launch/approval observations | Do not claim host acceptance from edited config fixtures alone |
| ESP32 Xtensa + Cortex-M | Hardware operator binds boards, ports and healthy/crashing firmware | Complete software tests; physical acceptance stays blocked |
| Debug probe, OTA-capable ESP32/ESP8266, coredump firmware, PPK2/serial meter | Hardware operator supplies explicit bindings and safe power envelope | Individual claimed backends remain blocked, not silently optional at acceptance |
| Namespace publication control and release credentials | Repository/package maintainer verifies control for supported names and configures trusted publishing | Software PR can proceed; public release/control status remains pending |

No field may remain an unnamed future dependency when S0 completes: fill it with a concrete executor/resource or an explicit `blocked` state and next action. Work that does not depend on a missing resource continues. Record pre-existing failures separately with impact and disposition; introduced failures cannot be relabeled baseline debt. No waiver may remove required parity, safety or identity coverage without a scope revision.

## Implementation Sequence

| Stage | Work | Exit evidence |
| --- | --- | --- |
| S0 | Validate frozen source inventory, contracts, prerequisites, licenses and namespace observations | Complete 40-tool contract manifest and legacy inventory; one wheel smoke; concrete resources or named blockers; clean isolated branch |
| S1 | Shared action catalog and result adapters | Existing entry points reach one dispatcher; future action contracts defined; unchanged legacy contracts |
| S2 | Policy resolver, approvals, configuration migration and installer preservation | Permission matrix passes before adding new mutation paths |
| S3 | Toolchain/ELF/crash/size analysis | Real ELF/toolchain fixtures and structured reports pass |
| S4 | Serial sessions and verified flash integration | Ownership, cancellation, disconnect and late-crash tests pass |
| S5 | Project/target/package/quality plus debugger/OTA/flash-inspection/power/telemetry parity | All remaining reference tool contracts implemented and tested |
| S6 | CLI/API/dashboard/skills, optional launcher and namespace controls | Fresh-install/upgrade/identity tests pass; release controls and audit workflow ready |
| S7 | Full regression, physical verification, documentation and PR review | All required gates green; evidence attached; no placeholder features |

Create one feature branch such as `codex/platformio-parity-permissions` from the selected product base, with reviewable commits following these stages. Keep one implementation PR; new tools are advertised only after their implementations/contracts land. Reconcile intervening product upstream changes through a documented impact review and rerun affected evidence; do not automatically expand the frozen competitor scope. Independent parser, packaging and contract work may proceed in parallel after interfaces are fixed.

## Verification Plan

### Automated acceptance

Add a machine-readable acceptance manifest connecting requirements to tests and artifacts. Each entry contains requirement ID (`PAR-*`, `LEG-*`, `POL-*`, `NS-*`), implementation status, command/manual procedure, environment identity, tested source commit, artifact hashes, expected assertion, evidence path, executor, timestamp, `pass|fail|blocked` outcome and next action. The aggregator rejects missing, stale, skipped or hash-mismatched evidence. Preserve and run the selected upstream release gates; proposed script names below must be implemented by this PR, not assumed to exist today.

| Gate | Required evidence |
| --- | --- |
| `test:parity` | All 40 reference tools, parameter mappings and important success/failure states; canonical and compatibility modes; each documented safety divergence tested |
| `test:permissions` | Missing vs invalid sources, unknown actions/keys, strict types, conflicting files, precedence/ceilings, project enrollment, profile coverage, policy changes while queued, and full provenance |
| Approval integrity | Denied/expired/replayed/forged/mismatched approvals, alias equivalence, changed device/artifact, atomic consumption and composite actions; no effects before authorization |
| Host configuration | Custom `CODEX_HOME`, standalone/plugin identities, existing env/tool restrictions/approval modes, invalid TOML, comments, repeated install and atomic rollback; never modify the developer's real config in tests |
| ELF analysis | Real pinned ELF fixtures built from repository-owned source for Xtensa and Cortex-M; inline/stripped/unresolved/corrupt/mismatched cases, spaces/Unicode, symbol totals, partition accounting and tool failures |
| Serial | Fake transport fault injection plus process-boundary ownership tests; ring overflow/cursors, partial UTF-8, bounded writes/regex/timeouts, cleanup, re-enumeration, two clients/one port and two distinct devices |
| Workflow | Known-good marker, early marker then panic, missing marker, delayed backtrace, decoder failure, upload failure and cancellation; legacy stability assertions preserved |
| Packages/quality | Native PlatformIO fixture with real CLI execution; deterministic test/static-analysis samples and local package fixtures; scoped installs/updates, INI preservation and hardware-test denial under build-only |
| Legacy regression | Existing MCP/CLI/API schemas and defaults, dashboard/auth/events, locks/cache/tasks/log redaction, library commands, board audits/reports, filesystem upload, plugin/automation paths and policy profiles |
| `test:distribution` | Packaged npm/plugin/wheel installation and update on supported platforms, no global Node for wheel tests, matching engine version, stdio cleanliness and uninstall leaving unrelated user data/config intact |
| New backends | GDB/MI framing/events/target state and host-code rejection; OTA interrupted/auth-failed transfers; custom partition offsets and real core dumps; PPK2 power limits/cleanup; telemetry units and dependency/port unknown states |
| `test:namespaces` | Registry-specific normalization, functional aliases, all three existing npm identities, explicit Python distribution selection, wrong-package rejection, pinned versions, inventory/config/doc consistency, provenance verification and bounded audit failure handling |

Run current upstream typecheck, lint, formatting, unit/component, integration, browser, package-smoke and plugin validation gates. The final aggregate `test:parity:acceptance` must fail if a required test is skipped, unavailable or incomplete. Distinguish mocked contracts, real CLI execution and physical evidence in its report. Do not update snapshots merely to hide changed legacy behavior.

In an isolated Codex configuration/session, verify actual standalone and bundled-plugin tool visibility and approval behavior, including an explicitly disabled mutation and its compatibility alias. Configuration fixtures alone do not prove host enforcement. Keep host version and effective scope in the evidence; unsupported host behavior must be reported rather than bypassed or represented as verified.

### Physical hardware acceptance

Use the repository's existing PIO manager workflow and hardware test runner for all build/flash/monitor execution. Select explicit project/environment/device bindings and obtain any required device authorization once through the established policy path.

1. On an ESP32 Xtensa board, flash repository-owned healthy and deliberately crashing test firmware. Confirm decoding to the expected source location, false-pass prevention after an early marker, crash capture, cleanup and reflash recovery.
2. On a Cortex-M board with an explicit fault-register UART fixture, verify PC/LR decoding against the flashed ELF. A compiler fixture alone does not prove physical crash capture.
3. On a board with a safe echo fixture, verify serial write/read, disconnect/reconnect and competing-client rejection. Exercise the existing PlatformIO-filter monitor independently from direct mode.
4. Exercise the existing firmware/filesystem upload paths, runtime assertions and dashboard visibility to demonstrate retention. Reuse approved existing hardware evidence only when it matches the final implementation revision and relevant platform/behavior.
5. Save bounded sanitized artifacts with revision, toolchain, board/environment, artifact hashes and pass/fail reasons. Restore the designated test firmware and confirm no leaked monitor, process or lock.
6. Validate a real debug-probe session including inspect/step/resume, upload exclusion and disconnect cleanup; generate/retrieve/decode a configured ESP32 core dump; compare a custom partition layout with the device.
7. Perform firmware and filesystem OTA acceptance on the declared ESP32/ESP8266 support matrix, including runtime observation and a controlled failed transfer. Exercise real PPK2 measurement and explicitly authorized source mode with verified limits and output-off cleanup. Do not substitute synthetic samples for meter acceptance.

Unavailable boards are an explicit acceptance blocker, not a reason to mark physical tests passed. Continue software work, but keep the PR draft until required evidence is obtained or the user explicitly changes scope. Unit fixtures and native integration cannot substitute for these checks.

### Completeness and PR handoff

The implementation PR is complete only when:

- All 40 manifest entries have passing behavioral tests; no advertised tool is a stub or an unreviewed shell escape.
- Both new analysis tools work through canonical MCP/CLI and compatibility aliases; serial, package, quality and target gaps are closed.
- Optional installation artifacts are built and tested, while existing npm/plugin/CLI/dashboard workflows remain functional.
- Host configuration is preserved and respected, server policy sources are explicit, and invalid/unknown permissions cannot grant access.
- Every legacy surface in the frozen inventory passes or has an explicitly documented safety correction and a working migration path.
- Required software and physical evidence matches the final PR revision; no acceptance waiver is hidden in a skip or TODO.
- Docs, schemas, changelog, provenance/license notices, package content checks and rollback instructions are included in the same PR.
- Namespace inventory, working supported aliases, collision-aware install commands, provenance controls and bounded monitoring pass software acceptance. Third-party/unsupported names are explicitly accounted for; public ownership/publication is reported separately and cannot be implied by a merged PR.

Suggested PR title: **Add PlatformIO tool parity, validated permissions and authentic distribution controls**.

The PR description should lead with the resulting user behavior, then list compatibility choices, permission corrections, configuration/migration examples, exact validation evidence and remaining limitations. Keep it draft while any required gate is incomplete. Choose the release version according to verified compatibility impact; do not promise a minor release if removing an unsafe public approval shortcut breaks documented clients. Do not downgrade users to vulnerable policy behavior as a rollback: disable optional features while retaining the permission fixes, or provide a corrected rollback release.

### Plan review completed

The 2026-09-19 review corrected stale 29-tool scope to 40 source-registered tools, added a pinned per-tool inventory, tightened approval/artifact/regex/serial/test semantics, defined executable acceptance and external prerequisites, and added namespace-specific defenses. Two independent reviews covered technical soundness and goal actionability. This remains an implementation specification, not evidence that features, acceptance tests, namespace registrations or publication have been completed. Proposed new file links intentionally resolve only after implementation.
