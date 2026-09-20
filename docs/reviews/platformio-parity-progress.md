# Implementation evidence and remaining work

Goal active. Branch: `codex/platformio-parity-permissions`.
Product base: `40e12ccb8e85fcaf33b46c50b6d832665728e773`.
Competitor contract: `a7b31021982f20b5406eaf80732899f8e75bd464` (40 tools).

## Completed software work

- Strict bounded YAML/JSON policy parsing; reject duplicate keys, aliases, unknown fields/actions/profiles and malformed booleans.
- Launch-only `--policy-file` and `PIO_MCP_POLICY_FILE`; conflicting selectors fail rather than silently choosing one.
- Policy lookup independent of writable cache fallback. Existing explicitly selected `PIO_MCP_DATA_DIR` remains supported.
- Operator restrictions survive project overrides. Explicit empty permission lists remain empty.
- Invalid configuration blocks operations while `get_policy_status` returns a repair diagnostic.
- Valid status reports ordered source provenance, file hashes and effective-policy digest.

These are partial S2 implementation changes, not completion of S0-S7 or the full policy security model.

- Codex installer now resolves CODEX_HOME, uses TOML-aware field edits, preserves custom launchers/environment/permissions, rejects invalid files and remote transport conflicts, and replaces valid files atomically with cleanup on failure.

## Verification

- Baseline: 37 unit files, 157 tests passed before changes.
- TypeScript compilation passed after changes.
- Focused policy tests: 3 files, 26 tests passed (including 14 new strict-configuration cases).
- Policy milestone: 38 files, 171 tests passed; evidence in `policy-unit.log`.
- Installer/source-selection milestone: 40 files, 196 tests passed; evidence in `policy-installer-unit-verbose.log`. The preceding run had one unexpected Vitest worker exit (39 files/189 tests completed); the detailed rerun passed all tests. This intermittent failure remains recorded rather than hidden.
- All 13 reference tool modules matched their pinned SHA-256 hashes. `scripts/capture-reference-contracts.py` produced and checked 40 input schemas, including resolved literal defaults. Output branch metadata is evidence only, not a complete output contract or behavioral acceptance.
- Reference MIT license and attribution captured in THIRD-PARTY-NOTICES.md.
- TOML parser 0.10.0 selected to retain the product's declared Node 18 compatibility; actual platform matrix execution remains pending.

## Prerequisites observed on 2026-09-19

- GitHub CLI authenticated as `jl-codes` with repository/workflow scopes.
- Local npm authentication returned 401. Existing release workflow may support OIDC; verify trusted-publisher configuration before concluding npm deployment is blocked.
- PlatformIO MCP read-only discovery: Core 6.1.16 on Windows, no connected devices returned.
- Node 24.15.0; npm 11.12.1; Python 3.14.4.
- Registry metadata is not proof of publishing authority. No distribution published yet; no PR created yet.

## Next work

1. Finish launch help and invalid-policy recovery cleanup. Policy source unit tests are implemented. Add project enrollment and scoped single-use approval grants; consolidate enforcement across entrypoints.
2. Codex installer preservation and CODEX_HOME selection are implemented and fixture-tested; actual isolated-host acceptance remains pending. Host config remains host-enforced; do not reinterpret host approval/sandbox settings as hardware permission grants.
3. Execute remaining S0-S7 items in the reviewed plan: shared action catalog, all 40 parity contracts/handlers, artifact identity, cross-install locks, bounded serial matching, debug/session lifecycle, Python runtime packaging and release channels.
4. Preserve all existing tool/CLI/dashboard behavior and run required host/platform/hardware acceptance. Record unavailable prerequisites explicitly; do not substitute mocked tests for physical acceptance.
5. Create the implementation PR, publish only project-controlled functional distributions through verified authorized workflows, and verify installed artifacts. Do not merge the PR without authorization.

Namespace coverage is finite. Python package-name normalization makes the competitor's `platformio.mcp` equivalent to `platformio-mcp`; do not attempt to publish that occupied Python identity. Follow the checked-in namespace inventory and authenticate candidate ownership before publishing.



## Approval integrity milestone

- Bound grants to exact argument and policy identities; normal policy-generated records no longer persist raw argument secrets.
- Atomic cross-process lifecycle mutations, approved-request expiry, terminal denial/expiry/consumption and exclusive one-use claims are implemented. Malformed storage fails closed instead of resetting silently.
- Removed inline approval booleans from engine authorization. Existing CLI operator confirmation now approves and consumes a scoped request.
- Isolated all Vitest workers from real operator policy/approval/audit data.
- Full unit suite: 41 files / 203 tests passed (`approval-unit.log`). New tests cover parameter and policy changes, expiry, denied/consumed resurrection, persistence failure, malformed storage and four-process consumption races.
- Remaining: trusted operator-channel separation, canonical alias normalization, policy revalidation immediately before queued effects, device/artifact resolution before grant identity, composite scopes, project enrollment, shared dispatcher and all subsequent parity/packaging/acceptance stages. CLI --approve remains an explicit operator CLI surface; it is not proof of human identity against an agent with unrestricted local process execution.

## Shared authorization milestone

- Moved existing 42-tool safety metadata and risk identities into a shared action catalog; CLI aliases now resolve the same permission identity as MCP.
- MCP and CLI use shared operation authorization; dashboard command execution now passes the same boundary before command-ledger writes and callbacks. Pending dashboard grants return HTTP 409; denied operations return HTTP 403.
- Bound approval digests to concrete operation identity so a simple-upload grant cannot authorize the composite flash/monitor workflow.
- Moved MCP activity/command registration after policy authorization. Real Windows stdio tests verify the existing 42-tool inventory and no execution ledger for a denied build.
- Added explicit dashboard confirmation and exact-payload one-time retry for mutation controls, including reset and PIO Home. A second challenge is returned rather than automatically approved.
- Verification: 42 backend files / 211 tests passed (`dispatcher-unit.log`); two additional real stdio tests passed (`mcp-authorization.log`); dashboard 4 files / 13 tests passed; web production build passed (bundle-size warning remains).
- This is authorization consolidation, not completed S1 dispatch: handler/schema/result adapters are not yet consolidated, queued effects need revalidation, and administrative routes outside executeDashboardCommand still require the full enforcement review. Trusted-channel isolation, project enrollment, real artifact/device binding, all 40 parity implementations, distribution and acceptance remain open.

## Firmware analysis foundation

- Added bounded crash-address extraction for Xtensa/ESP32, RISC-V and Cortex-M, including wrapped backtraces, reset/cause evidence and corrupted traces.
- Added GNU addr2line parsing with inline frames, unknown symbols, Windows/Unicode source paths and lossless 64-bit address normalization.
- Corrected a reference behavior: RISC-V RA is not rewritten as an Xtensa windowed return address; A0 remains register data when RISC-V crash registers are present.
- Added ELF content hashing and header/architecture validation through one bounded file descriptor, with explicit expected-hash mismatch errors. This establishes file identity, not proof that a device contains that artifact.
- Focused validation: 13 tests across crash parser and ELF identity passed; TypeScript validation passed. ELF tests use synthetic headers and are not real toolchain or physical acceptance evidence.
- Reference toolchain.py pinned-source SHA-256: `cc7ad3a96fdb7227563d873728e18631ce321c77f7b5955873d1cf6728103ac3`.
- These helpers are not advertised as completed tools. Next analysis work: trusted toolchain resolution, bounded subprocess execution, retained build/upload artifact manifests, real ELF fixtures, size/symbol accounting, canonical/compatibility adapters and physical crash acceptance.

## Size-analysis parsing milestone

- Added bounded GNU SysV section, Berkeley total and demangled nm symbol parsing, with source-file grouping and explicit static flash/RAM estimates.
- Preserved code sections mapped at address zero instead of treating every zero-address section as debug data. Debug-named sections are excluded from the estimate.
- Rejected inconsistent/multiple-image totals and unsafe numeric sizes. Source grouping respects path boundaries and does not misattribute sibling directories.
- Validation: 18 analysis tests passed across size, crash and ELF identity modules; TypeScript and focused lint passed.
- Remaining analysis acceptance is unchanged: these fixtures do not establish ELF load-segment accounting, partition capacity, real toolchain execution or physical firmware identity. The public size-report/decoder tools are not yet registered.

## Analysis execution and toolchain selection milestone

- Added bounded native analysis execution with no shell, literal argument arrays, finite timeout/output limits, cancellation, deterministic locale and typed failures. Failed/truncated output cannot be mistaken for a successful report.
- Added compiler-companion resolution restricted to explicit trusted installation roots, real-path containment and exact matching GNU utility prefixes. Missing tools are reported rather than replaced by a heuristic selection from another installation.
- Verification: 28 tests passed across five analysis modules. Process tests execute Node fixtures only; resolver fixtures are never executed. TypeScript validation passed.
- Next: connect these components to immutable artifact snapshots and report engines; integrate selected-environment metadata, artifact manifests, canonical/compatibility interfaces and real toolchain fixtures. Trusted roots must be supplied by host/package discovery, never accepted directly from tool-call arguments.

## Firmware report engines

- Connected crash and size parsers to trusted compiler-companion selection and bounded utility execution.
- Added private, hash-verified ELF snapshots so rebuilds cannot change the file analyzed between utility calls. Temporary copies are removed on success and failure.
- Crash reports preserve unresolved frames and explicitly distinguish current-ELF identity from a supplied expected hash; neither is represented as proof of flashed-device contents.
- Size reports retain static-estimate labeling and separate symbol attribution from section accounting. Reports share a 30-second utility-execution deadline and crash addresses are passed in bounded batches for Windows command-line limits.
- Verification: 33 tests passed across six analysis files. Report-engine utilities are mocked; real toolchain fixture and physical acceptance remain outstanding.
- Still required before public registration: host/package-derived environment/toolchain context, retained build/upload manifests, regex filtering, PlatformIO/partition accounting, canonical and compatibility result adapters, CLI/MCP integration, and real acceptance evidence.

## Real Xtensa toolchain acceptance

- Built repository-owned ESP32-S3 debug firmware through MCP build_project, exact task `a9162b01-4e62-4051-aa84-a9b3842d6473`, environment `analysis-esp32s3`, Espressif32 7.0.1. Task completed successfully; no device upload occurred.
- Added an explicit, non-skipping real-toolchain verifier and reproduction instructions. Windows x64 GNU nm/size/addr2line checks passed against the 6,975,824-byte ELF; evidence is in `analysis-xtensa-windows-evidence.json`.
- Verified source function/line, retained unresolved address, expected identity and mismatch rejection, size symbol counts/ranking and source attribution. GNU nm --size-sort omits unsized symbols, so the verifier compares identical invocation modes.
- Real evidence confirms generic GNU size estimates differ from PlatformIO board accounting; recorded both in fixture documentation. Do not equate these estimates with device allocation or partition capacity.
- Remaining: Cortex-M and other-host fixture acceptance, selected-environment discovery, real board/partition accounting, retained build/upload manifests, tool adapters, and all physical acceptance/distribution work already tracked above.

## Compile-only test enforcement

- Added optional compileOnly to existing MCP/schema/dashboard test adapters without removing legacy parameters.
- The shared runner rereads policy at execution and forces both --without-uploading and --without-testing under build_only, even when compileOnly is explicitly false. Malformed mode values and invalid policy fail before dispatch.
- Verification: TypeScript passed; 10 tests across test-execution-mode and policy-profile passed, including exact process arguments, full-test regression, and no process on invalid configuration. These are mocked process-boundary checks, not physical acceptance.
- Remaining: native/embedded target classification, hardware-test approval and device binding, queued-effect revalidation throughout other operations, and the broader plan's pending implementation/acceptance/publication stages.

## Project policy enrollment

- Added versioned enrollment bound to the real project path and normalized contents of both project policy sources. Records live outside the project in operator policy storage; path aliases into project storage are rejected.
- Unenrolled project sources may restrict the built-in/operator baseline but cannot expand grants, remove required approvals, or disable mandatory safety switches. Explicitly enrolled lab_admin and lab_runner profiles retain their capabilities subject to operator ceilings.
- Added local policy-enroll/policy-revoke CLI commands and policy-status enrollment provenance. Neither operation is exposed through MCP/dashboard. Same-user unrestricted process execution remains outside this API security boundary.
- Validation: nine enrollment tests include real CLI subprocesses, content invalidation, revocation, normalized formatting, project copies, directory aliases, restrictive profiles, corrupt records and operator denies. Full backend rerun passed 51 files / 262 tests; the first run exposed two old fixture assumptions and an intermittent worker exit. Updated fixtures explicitly enroll intended lab privileges and distinguish security audit logs from execution ledgers. TypeScript passed.
- Outstanding permission work still includes trusted dashboard approval capability separation, queued-stage policy revalidation, exact physical-device/artifact binding, administrative-route review and invalid-policy bounded cleanup. All remaining parity, packaging, PR and distribution work remains open.

## Policy authority diagnostics

- Policy status now exposes serverPolicy enforcement/validity/digest separately from hostPolicy, whose resolved permissions are explicitly external and unknown. No config.toml snapshot is treated as a runtime grant.
- Dashboard policy overview displays contributing sources, invalid-configuration diagnostics and project enrollment. Removed profile-name-only claims that lab_runner is preauthorized or that all other profiles necessarily require interactive approval.
- Verification: TypeScript and 18 focused policy tests passed; dashboard production build passed with the existing bundle-size warning. Dashboard regression now checks unenrolled lab_runner wording and external host authority.
- Doctor/compatibility migration, trusted approval-channel separation and the rest of the reviewed plan remain outstanding.

## Dashboard approval capability separation

- Approve and deny API routes now require an independent operator capability captured from PIO_MCP_APPROVAL_TOKEN at server startup, in addition to existing dashboard authentication. Missing/wrong authority returns 403 without mutating approval records.
- MCP/dashboard launch output, launch-session cookies and ordinary portal bearer tokens never carry this capability. Added an end-to-end API regression through getDashboardStatus, launch-ticket exchange, cookie authentication and both approval mutation routes, plus successful separately authorized approve/deny coverage.
- Dashboard confirmation and the safety panel request the capability for each approval; it is added only to the approval request, never stored in browser persistence or carried into the execution retry. Local operator CLI approval remains supported. Same-user unrestricted process authority is explicitly outside this boundary.
- Backend TypeScript and 18 API tests passed. UI build and focused capability/retry regression checks are recorded with this milestone. Remaining: queued-stage revalidation, exact device/artifact binding, administrative route review, full parity and distribution work.

## Approval API lifecycle errors

- Authorized dashboard attempts to revive terminal approvals return HTTP 409 / APPROVAL_TRANSITION_INVALID rather than a generic server failure. A record disappearing between lookup and mutation returns 404 without a success audit entry.
- Verification: TypeScript passed; 26 API and approval-integrity tests passed, including the authorized denied-to-approved rejection path. Goal scope and remaining implementation/publication work are unchanged.

## Selected build metadata

- Added bounded PlatformIO metadata parsing and context construction for the report engines. Multiple environments require explicit selection; unknown selections, malformed/oversized JSON and missing/relative/control-character paths are rejected. No newest-file or first-environment heuristic is used.
- Context construction verifies the compiler companions against caller-supplied host installation roots before producing analysis context. These roots must remain host-derived, never accepted in public tool arguments; metadata generation remains a build-authorized operation because it can execute project scripts.
- Verification: TypeScript and 23 metadata/report/resolver tests passed. These parser fixtures do not establish live PlatformIO metadata discovery. Pending integration: authorized metadata execution, package-root discovery, retained build/upload manifests, public tool adapters and remaining real-platform/physical acceptance.

## Bounded serial regex execution

- Added literal-by-default matching and explicit regex execution in a terminable worker, with input/pattern/line/memory/deadline and concurrent-worker bounds. Existing query_logs case-insensitive regex now uses this boundary; legacy assertion substring behavior is unchanged.
- Added optional Python named-group/reference translation and explicit rejection of incompatible escape semantics. Documented the ECMAScript subset and typed failure behavior in serial-patterns.md.
- Adversarial backtracking tests verify timeout, main-event-loop responsiveness, termination/recovery and concurrency limits. Session/capture compatibility adapter integration and physical serial acceptance remain outstanding.

## Firmware symbol filtering

- Size report engine now supports optional case-insensitive regex filtering of symbol names or source paths, independently preserving anchors. Matching occurs before top-symbol/file selection; whole-image sections and totals are unchanged.
- Filters use bounded workers, batched input and the shared report deadline. Invalid expressions fail explicitly, including empty symbol tables. Existing unfiltered callers remain supported.
- Verification: TypeScript and 15 report/matcher tests passed. The real Windows Xtensa verifier also passed with a single known fixture function selected from 1,864 symbols and unchanged whole-image totals; updated evidence records filteredSymbols.
- Public adapters, authorized metadata/package discovery, board/partition memory accounting, retained build/upload identity and the broader implementation/distribution stages remain pending.

## PlatformIO memory accounting integration

- Added bounded parsing of PlatformIO RAM/Flash usage, retaining the reported program allocation limits instead of substituting physical chip capacity. Incomplete output stays unknown; duplicate environment reports, unsafe integers and inconsistent percentages are rejected.
- Size report engine accepts host-supplied successful size-check evidence bound to the same environment and ELF SHA-256. It keeps GNU totals separate, labels PlatformIO accounting distinctly, rejects stale/mismatched evidence and exposes an explicit fallback reason for missing/failed/unsupported output.
- Verification: TypeScript and 12 parser/report tests passed, including observed ESP32-S3 figures, failed-command fallback and hash mismatch. This does not yet capture evidence from an authorized live checkprogsize operation or prove partition-table/upload identity; those adapters and acceptance remain required.

## Authorized build-context collection

- Added fresh selected-environment metadata collection and checkprogsize collection through the shared build authorization boundary, with explicit purpose-bound arguments and finite process timeouts. Read-only policy denies before process execution; metadata is not cached globally.
- Size collection hashes the selected ELF before and after the command and rejects a changed artifact, rather than associating a rebuild's usage with stale analysis. Failure status remains explicit in collected evidence.
- Validation covers denied execution, exact environment/arguments, failed metadata, flag-like environment input, successful evidence binding and ELF mutation during the command. Public analysis adapters, host package discovery, interprocess build locks/retained manifests and real collection acceptance still remain outstanding.

## Full regression and pinned legacy input contracts

- Full backend regression at b0fe691 passed 55 files / 302 tests (`.platformio-mcp/parity-regression-current.log`). This covers implemented behavior, not unimplemented parity or physical acceptance.
- Captured all 42 original MCP input contracts from pinned upstream 40e12ccb8e85fcaf33b46c50b6d832665728e773 into platformio-product-contracts.json. Capture uses static TypeScript literal/constant parsing, never evaluation of upstream server code; source SHA-256 and revision are recorded. The --check mode verifies reproducibility.
- Real stdio MCP tests now compare every original input schema, allowing new optional fields while rejecting removed inputs, newly required fields and common narrowing constraints. All three stdio checks passed. Description-only edits are not treated as input compatibility breaks.
- S0 still needs output/behavior contracts and full CLI/dashboard inventories; these checks do not prove full functional parity or retained physical behavior. The remaining implementation, PR, publication and installed-artifact acceptance requirements are unchanged.

## Host toolchain package discovery

- Added selection of the compiler's registered toolchain package using the host system-info Core directory and bounded package.json/.piopm records with matching name/version. Resolved package roots cannot escape the installation or overlap the selected project.
- Explicit operator PIO_MCP_TOOLCHAIN_ROOTS JSON configuration supports custom/native installations without accepting trust roots from public tool arguments. Invalid/empty/broad/project-owned roots fail closed; no arbitrary PATH fallback occurs.
- Verification: TypeScript and 15 discovery/resolver tests passed. Current MCP system_info reported Core 6.1.16 at the installed host directory; real discovery plus companion resolution succeeded for ESP32-S3 GNU 8.4.0+2021r2-patch5. Package registration is not publisher-signature verification.
- Analysis adapters still need to join host system-info collection, authorized metadata, toolchain discovery and report execution. Retained artifact/lock integration, compatibility/public registration and all remaining plan stages are open.

## Integrated analysis handlers

- Added strict decodeBacktrace and firmwareSizeReport handlers joining explicit environment validation, build-authorized fresh metadata, host system-info authorization, registered toolchain discovery, expected ELF hashing, board-memory collection and report engines.
- Public handler inputs exclude compiler paths, toolchain roots and raw memory evidence. Unknown fields fail before processes run. Read-only policy blocks metadata scripts; mismatched expected artifacts block analysis utilities.
- Verification: TypeScript and five handler integration tests passed with real policy/package/ELF validation and mocked external processes. Existing real GNU engine evidence remains separate from live collector acceptance.
- These handlers are not yet publicly registered. Remaining analysis work includes composite authorization across collection stages, shared build/retained-artifact locks and manifests, canonical/compatibility MCP/CLI/result adapters, and actual end-to-end metadata/size-check acceptance. The rest of the 40-tool, physical acceptance and distribution scope remains open.

## Analysis stage policy revision checks

- Added a reusable policy revision guard that detects effective policy/source/enrollment changes without acting as a permission grant or consuming approvals again.
- Integrated the guard between analysis metadata/system-info stages, before size collection and GNU utility execution, and before returning final decoded/size results. Each process-producing collector still performs its own authorization.
- Verification: TypeScript and 14 handler/report tests passed, including a policy change during metadata generation and a change during a decoder utility call. Later effects/output are rejected with POLICY_CHANGED.
- This is analysis-stage coverage only. Full queued-operation/composite grant revalidation across existing build/upload/serial/debug flows, public analysis registration and the rest of the plan remain outstanding.

## Composite analysis build approval

- Analysis handlers now authorize the whole normalized report request once, binding purpose/project/environment and a digest of all report arguments. Raw crash text is not persisted in grant metadata; changing text/filter/hash/options changes the request digest.
- Metadata and program-size stages share a process-local, scope-bound capability issued only after authorization. Each allowed stage is one-use, policy revisions are checked, and the capability is invalidated when the callback finishes. Caller-shaped objects cannot forge this authority.
- Standalone collectors retain their own authorization. System-info inspection retains its independent policy check; this change does not bypass separate operator restrictions on inspection.
- Verification: TypeScript and 17 handler/collector tests passed. A build-approval-required policy allows one approved exact size request to finish both stages; changed filter and consumed-grant replay do not execute processes. Forged and expired internal capabilities are rejected.
- Public MCP/CLI registration, alias contracts, retained-artifact/build locks and live end-to-end collector acceptance remain pending, as do the remaining parity and release stages.

## Public canonical analysis tools and live MCP acceptance

- Registered decode_backtrace and size_report with strict schemas and build-capable annotations; all 42 original MCP input contracts remain preserved in the 44-tool registry. Handler-owned composite authorization occurs before activity/command registration; crash text is omitted from analysis ledger/activity arguments. Approval challenges retain structured policy decisions.
- Added firmware-analysis.md and a reproducible MCP stdio acceptance script. On Windows x64, the new tools collected live ESP32-S3 metadata, discovered the registered GNU toolchain, ran checkprogsize and decoded fixture_add to source line 6 using the same ELF hash. Evidence: analysis-mcp-windows-evidence.json. RAM 18,040/327,680 and flash 233,161/3,342,336 are reported independently of GNU estimates. No device was flashed.
- Updated plugin tool coverage and rebuilt the bundled server/dashboard. Four focused runtime/authorization/contract files passed 20 tests; three plugin files passed 14 tests, including cache-like bundled launch listing 44 tools. TypeScript passed. Full backend regression passed 57 files / 325 tests (`.platformio-mcp/public-analysis-regression.log`).
- These are canonical tools only. Reference aliases and full result compatibility, serial-session crash inputs, optional reference environment resolution, CLI adapters, retained artifact/build lock integration and all other unimplemented 40-tool requirements remain outstanding. This does not satisfy physical acceptance or release publication.

## Canonical analysis CLI

- Added decode-backtrace and size-report commands using the same strict handlers and normalized request approvals as MCP. Inputs include explicit project/environment, expected ELF hash, top/filter and bounded crash text/file input; missing/ambiguous crash input is rejected.
- Preserved operator CLI approval semantics: JSON mode does not prompt without explicit --approve, --approval-id can supply a scoped grant, and retry happens once against the unchanged request. File reads cannot exceed 1 MiB even if the file grows after opening.
- Verification: TypeScript and 18 CLI/handler/dispatcher tests passed. Real CLI subprocess tests cover read-only denial without project execution, file bounds and invalid options; successful real analysis remains established over MCP, not a new live CLI process run.
- Remaining: reference aliases/default resolution/session inputs, retained build/upload locks/manifests, the rest of the 40-tool surface, full host/physical acceptance, PR and distribution releases.

## Modern package management: canonical MCP, CLI and real command acceptance

- Added six canonical package tools and CLI commands: pkg_search/install/uninstall/list/outdated/update. The MCP registry now has 50 tools; the original 42 input contracts remain preserved. Library, platform and tool specifications are passed without a shell. Project directory is explicit, environment selection is preserved, and empty registry queries can list a package kind.
- All adapters use the same strict handler and scoped approval boundary. Package mutations retain the existing respective library-management policy categories. Project list/outdated require build permission because installed Core 6.1.16 loads platform code. Per-project package locking, policy revision checks, bounded parsing, retained redacted output and explicit non-success states are implemented.
- PlatformIO dependency saving drops comments. Added a bounded merge that applies only authorized dependency-option changes to the original INI text, keeping unrelated values, comments, line endings and other environments. Unexpected semantic changes or concurrent-file mismatches fail with PACKAGE_CONFIG_CONFLICT. The subprocess may already have mutated state when a post-execution conflict is reported; this is not transactional rollback or protection against arbitrary same-user writes.
- Real MCP acceptance installed local library, platform and tool fixtures in an isolated PlatformIO core, listed them, ran outdated/update, uninstalled a library and verified its dependency removal, and searched the public registry. This exposed and fixed Windows cp1252 failures in Unicode package-tree output by setting package subprocess I/O to UTF-8. Evidence: package-mcp-windows-evidence.json; reproduction: scripts/verify-package-mcp.ts. No build or hardware operation ran.
- TypeScript passed. Full backend regression passed 59 files / 348 tests (`.platformio-mcp/package-parity-regression.log`). A final empty-query compatibility fix then passed 35 focused package/MCP/plugin tests, with a rebuilt plugin successfully listing 50 tools. Earlier package CLI/plugin checks also passed, including scope-changing flag rejection. Package documentation is in package-management.md.
- PAR-24 through PAR-29 are explicitly partial: reference aliases/exact output shapes/default directory resolution, dashboard integration, modern global-package scope, common locks with legacy/build operations and cross-platform/release acceptance remain open. This does not complete the other parity requirements, PR creation, hardware acceptance, or publication. No PR or release has been created.

## Concrete-operation policy restrictions

- Fixed mapped authorization so a concrete tool's deny or approval requirement is not lost when the tool shares a broader policy category. Category restrictions still apply; an exact-operation allow does not grant the category or sibling tools. Operator ceilings now preserve restrictive project requirements on mapped operations without needing enrollment.
- Composite crash/size analysis grants now identify the public decode_backtrace/size_report operation rather than generic build_project, enforcing report-specific restrictions before metadata execution. Existing grants bound to the old operation identity are not promoted.
- Tests cover exact denies, category-deny precedence, narrow grants, unenrolled restrictive approvals, one-use consumption, and the actual analysis handler boundary. Documentation includes an exact report grant plus its independently required system_info permission.

## Resolved project configuration, metadata and target discovery

- Added project_envs, project_metadata and list_targets canonical MCP tools and matching CLI commands, bringing the registry and bundled plugin to 53 tools. All 42 pinned original MCP input contracts remain available. The new tools share validation, request-bound approvals and revision guards.
- Project configuration uses PlatformIO's computed JSON, preserving nested/multiple inheritance, common settings, extra INI files and defaults. Metadata/targets require build permission because generating them can execute scripts/install packages. Target discovery reads the same structured metadata source as Core's CLI listing; it does not execute any discovered target.
- Added bounded JSON/structure/schema validation, explicit environment-identity checks, bounded include-path reporting, known-secret redaction, and distinct missing-vs-empty target metadata. Legacy project and target-resolution outputs remain unchanged. New inspection documentation: project-inspection.md.
- Live MCP acceptance verified nested/multiple inheritance, common settings, extra configs and a non-first default under read-only policy, metadata denial under that profile, and actual ESP32-S3 metadata/target discovery. Observed 21 definitions, 200 build include paths and buildfs/size/upload/uploadfs/uploadfsota/erase target descriptors. Evidence: project-inspection-mcp-windows-evidence.json; reproducible script: scripts/verify-project-inspection-mcp.ts. No hardware operation was executed.
- TypeScript passed. Full backend regression passed 60 files / 369 tests (`.platformio-mcp/project-inspection-regression.log`), including bundled plugin launch at 53 tools. The worktree remains separate from the user's original checkout.
- PAR-15, PAR-32 and PAR-34 remain partial pending reference aliases/results/default-directory behavior, dashboard integration and cross-platform acceptance. Named target execution/effect classification, shared artifact/build/device locks, retained manifests, serial/debug/OTA/core-dump/power/dependency/telemetry parity, packaging, required physical acceptance, PR creation and publication remain open. No PR or release has been created.

## Bounded serial session storage

- Added an internal transport-independent SerialSessionBuffer with incremental UTF-8 framing, CRLF/bare terminators, bounded ring/partial storage, whole-code-point truncation, monotonic completed-line cursors and explicit loss counters. Partial previews never advance a completed-line cursor, and page limits defer rather than skip them.
- Reads support independent cancellation, bounded waits, terminal-state retention and the existing literal/default or explicit worker-isolated regex matcher. Revision checks account for data arriving during asynchronous matching; a full page returns for pagination even without a pattern match. Regex execution has its own one-second deadline rather than pretending to be covered by the read timer.
- Verification: TypeScript passed; 29 tests across serial-session-buffer and bounded-pattern passed. Coverage includes split UTF-8, ring eviction, byte/line limits, stale/future cursors, partial previews, disconnect/error/stop, cancellation, reader limits, maximum matcher pages and arrivals during regex evaluation. No hardware was accessed.
- This is a storage foundation only: no new public tool or serial transport is registered. Shared physical-device locks, authorized session lifecycle/writes, direct transport, compatibility adapters and hardware acceptance remain open. The canonical registry remains 53 tools. The full parity, PR and publication goal remains active; no PR or release has been created.

## Physical-resource lease foundation

- Inspection found that the legacy semaphore overwrites claims and follows PIO_MCP_DATA_DIR. Added an independent DeviceLeaseStore using a stable OS-account home, atomic update gates, private atomic lease records, OS process-start identity plus nonce, and process-local release capabilities. Unknown/corrupt ownership fails closed; PID reuse does not inherit the old owner's authority.
- Added Windows process start-time inspection, Linux boot/starttime parsing and macOS C-locale UTC start-time inspection. Only Windows has actual host evidence in this milestone; equal low-resolution timestamps conservatively retain ownership. This code never terminates a process or opens a device.
- Verification: TypeScript and 11 focused tests passed, including actual Windows start metadata and separate Node processes using different working/data directories. The second process was denied while the first lived, then recovered the lease after its exit. Tests also cover forged/replayed release capabilities, PID reuse, unknown/corrupt records, symlink roots and interrupted gates.
- Documentation: device-ownership.md records behavior and limits. An interrupted update gate is not automatically stolen by age; a repair path remains future work. Physical alias resolution, atomic child-process handoff and migration of every legacy/new hardware path remain required before global exclusion is claimed. The existing semaphore is deliberately not partially migrated while detached children remain unbound. The full parity, PR, acceptance and publication goal remains active.

## Atomic lease handoff and orphan-process acceptance

- Added internal transfer/adopt operations to DeviceLeaseStore. Transfer rechecks the target process start identity under the atomic gate, rotates the persisted nonce and invalidates the original handle. Adoption requires the target's current OS identity and consumes the ticket by rotating it again. Failed target validation leaves the original lease intact.
- Public tools do not accept these tickets. A child must wait without touching hardware until it has adopted its lease. Documentation specifies the barrier and delivery-failure semantics; hardware command descendants still need explicit lifecycle handling.
- Verification: TypeScript and 15 device-lease tests passed. Actual Windows IPC tests verify parent handle invalidation, rejection of adoption by the parent, one-use adoption, continued exclusion and child release. A detached holder retained ownership after its coordinator exited; a competing process stayed blocked until the holder released. The holder's final exit was verified. No physical resource was opened.
- Runtime integration remains open: legacy monitor/upload spawning has not yet been migrated, alias/re-enumeration resolution and direct serial transport are pending, and the canonical registry remains 53 tools. This does not complete serial parity, required hardware/platform acceptance, PR creation or distribution deployment.

## Maintained direct serial transport

- Added exactly pinned optional serialport 13.0.0 and a direct transport with explicit open, bounded raw-byte delivery, 64 KiB write limit, copied write buffers, concurrency rejection, OS drain and no automatic write/reopen retries. Direct mode requires Node 20+; the legacy monitor path does not import it and remains usable on the existing Node 18 baseline.
- Logical termination is separate from confirmed physical closure. Late opens after timeout/stop are closed, failed closes retain unconfirmed ownership, and concurrent close calls join one native attempt. Session integration must release leases only after confirmedClosed resolves.
- TypeScript passed. Tests cover the official maintained mock stream with split UTF-8 echo/write/drain, native backend loading on Windows without device access, delayed open, disconnect, bounded writes, stalled drain, error callbacks and cleanup retries. Direct mode does not silently implement or drop PlatformIO filters.
- Documentation: direct-serial-transport.md. This transport is not publicly registered or joined to authorization/session ownership yet. Plugin/wheel native dependency packaging, aliases, shared physical identity integration and actual hardware acceptance remain required. No PR or distribution has been published; the full goal remains active.

- Regression evidence for this milestone: all 63 backend files / 415 tests passed (`.platformio-mcp/direct-serial-regression.log`). A final source-review fix then added explicit underlying opening/closing checks because SerialPort reports isOpen=false during a pending close; TypeScript and all 12 transport tests passed afterward. This prevents premature lease release during that native closing window.

## Owned serial session integration

- Added SerialSessionManager joining the buffer, maintained direct transport and physical lease store. Exact process-local owner objects scope reads/writes/status/cleanup; session IDs and copied owner metadata cannot grant access. A required authorization hook has no permissive default, binds normalized startup settings and write payload digests, and returns a revision guard checked before effects and before read results.
- Startup owns the lease before opening, rejects policy changes after backend loading and cancels stopped pending starts. The transport now exposes logical termination separately from physical closure so pending readers wake promptly without prematurely releasing ownership. Failed close/lease release remains visible and retryable; one-shot capture always attempts cleanup, and disconnect cleanup is owner-scoped.
- Completed buffers are capped at sixteen with a ten-minute lifetime; starting/live/cleanup-pending sessions are capped at eight and never evicted as completed data. Start approval metadata excludes its freshly generated session ID, allowing an exact normalized request to be retried; existing-session writes bind the ID and copied payload hash/length.
- Verification: TypeScript passed and 68 tests across session manager, transport, buffer, device lease and bounded matcher passed. Tests cover maintained mock-stream echo, owner isolation, policy-revision races, payload mutation, retained reads, cancelled async startup, capture error cleanup, unconfirmed native closure, lease release retry and bounded retention. No physical device was opened.
- Documentation: serial-sessions.md. This is internal service integration, not public serial parity: real policy-dispatcher adapters, physical alias/re-enumeration resolution, legacy monitor/upload migration, redaction, public canonical/reference routes, native artifact packaging and hardware acceptance remain open. The MCP registry remains 53 tools; the full PR/publication goal stays active.

## Serial policy dispatcher and scoped approval integration

- Added PolicySerialSessionService, connecting the owned session service to the existing effective-policy resolver, dispatcher, approval store and audit path. Async request context carries only an explicit approval ID and trusted caller scope; canonical project/port/physical identity override unrelated caller-supplied scope. Missing request context fails closed. Revision guards are captured before asynchronous authorization and checked before effects.
- Added three implemented internal action identities separately from the 53 advertised MCP tools. Open/read map to start_monitor/query_logs; writes map to upload_firmware because serial commands can mutate the device. Concrete denies/approval requirements remain enforced alongside category restrictions. Firmware-upload grants do not authorize serial writes.
- Real-policy tests cover read-only/build-only open denial, monitor-only write denial, actor=user not bypassing grants, exact byte/baud binding, one-use grant consumption, retried start approvals with new session IDs, concrete deny separation, canonical workspace scope, actual policy changes and owned cleanup after invalid policy.
- Verification: TypeScript passed; the bundled plugin was rebuilt and the full backend suite passed 65 files / 440 tests (`.platformio-mcp/serial-policy-regression.log`), including bundled launch with 53 tools. Tests use disposable mock ports; no physical device was opened.
- Public serial adapters, physical alias/re-enumeration resolution, legacy hardware-path migration, native distribution packaging and required acceptance remain unfinished, as do the other outstanding parity and release stages. Repository admin access and the unchanged pinned main SHA were verified; a draft PR is the next review artifact, not completion or release authorization.

## Draft PR and first cross-platform CI feedback

- Opened draft PR https://github.com/jl-codes/platformio-mcp/pull/26 from the isolated branch at 014a7d9, with explicit remaining scope and no merge/release action. GitHub main still matched the pinned base 40e12ccb8e85fcaf33b46c50b6d832665728e773 when the PR was created. The draft is an intermediate artifact, not completed parity or acceptance.
- Initial PR CI run 35472897067 passed Ubuntu typecheck/lint/backend/dashboard tests and the production dependency audit. macOS failed three toolchain fixture assertions because canonical /private/var paths differed from /var aliases. Windows failed eight fixture assertions across toolchain/package/inspection tests because native canonical paths differed from RUNNER~1 short-path expectations. Downstream dependent gates were skipped, not passed.
- Corrected expected paths using native/async realpath and added explicit Core/package/compiler alias tests. Production canonicalization and trust-boundary checks are unchanged; assertions still require canonical companion/package identity. Hosted rerun evidence is required before reporting those jobs fixed.

## Endpoint aliases and deterministic plugin refresh

- Added internal serial endpoint normalization and metadata revalidation: Windows COM/local-device aliases, Linux character-device identity and conservative Darwin callout/dial-in coalescing. This does not establish physical USB identity or survive re-enumeration; public and legacy integration remain open. TypeScript and 14 endpoint tests passed without hardware access.
- PR run 35473119153 passed all three OS quality jobs, the production dependency audit, Linux CLI end-to-end tests, Chromium dashboard checks and Linux build/smoke. All three plugin jobs failed. The inspected Ubuntu job failed its checked-in runtime consistency check because the bundled frontend was stale. A complete local plugin build produced the same index-BkkxHhoR.js artifact as Ubuntu CI, replacing index-Dgjuyqit.js; the deterministic gate remains enabled. Subsequent hosted checks must establish the refresh across all three OS jobs.
- The PR remains draft and no distribution was published. Full parity, physical acceptance and release packaging remain outstanding.

## Endpoint-aware serial session startup

- Connected OS alias resolution to an internal `startEndpoint` entry point. The session manager snapshots its trusted endpoint guard and checks it before leasing, after backend loading immediately before open, and after open. Replacement follows the existing confirmed-close lease cleanup path. This does not claim USB identity or remove native-open races.
- Added backend-loading and post-open replacement tests: replacement prevents a pending open or closes an already-open transport, then releases the acquired lease. TypeScript and 40 endpoint/session/policy tests passed. Public routes, legacy resource coordination and physical acceptance remain open.

## Structured serial discovery binding

- Added a bounded internal binding between canonical endpoint identity and optional structured USB descriptors. It rejects conflicting aliases and duplicate USB descriptors across endpoints, labels descriptor absence, and requires selection/authorization again after identity changes or port movement. No automatic reconnect or physical authenticity is claimed.
- TypeScript and 20 endpoint/discovery tests passed. New tests cover case normalization, serial-number changes, duplicate descriptors, conflicting alias metadata, re-enumeration refusal and malformed/oversized input. No device enumeration or port opening was performed.
- Native discovery and dual endpoint/USB lease acquisition still need integration before public serial exposure. The PR remains draft with the full parity and publication goal active.

## Combined serial ownership scopes

- Session startup now accepts bounded trusted additional identity scopes, snapshots them before authorization, binds all scopes to approval arguments and the target digest, and acquires each before transport construction. Contention rolls back prior acquisitions without opening a port. Cleanup retains only failed lease releases for owned retry.
- TypeScript and 29 session/policy tests passed, including simultaneous endpoint/USB exclusion, rollback on a second busy scope and partial release retry without replaying successful release capabilities. These tests use temporary leases and mock serial transports. Native discovery integration, legacy migration and physical acceptance remain open.

## Discovery-aware startup and green hosted regression

- Connected structured discovery binding to session startup through a trusted internal provider. Endpoint and USB scopes are supplied together; refreshed metadata is bounded by the operation deadline. Every awaited metadata check is followed by cancellation and policy revision checks before further effects. Timeout cannot later resume startup, though the provider remains responsible for bounding its own enumeration work.
- Added integration tests for descriptor replacement during backend loading, stalled metadata and policy revocation during asynchronous verification. Native enumeration and public/legacy adapters remain outstanding.
- Hosted run 35473907622 for commit 39be2fa completed successfully: three OS quality jobs, three OS plugin jobs, production dependency audit, Linux CLI end-to-end, Chromium dashboard and Linux build/smoke. This verifies the stale frontend refresh across the tested hosts, not later unpushed changes or physical hardware acceptance.

- Local verification of discovery-aware startup: TypeScript passed; full backend suite passed 67 files / 470 tests, with 2 files / 22 tests skipped. Skipped cases are not acceptance evidence. Output is retained in `.platformio-mcp/discovery-session-regression.log`. No physical device was opened.

## Pending discovery ownership

- Fixed initial discovery escaping owner-wide cleanup: each discovery captures an owner stop generation, checked before creating a session. Pending discovery now reserves bounded session capacity and releases its reservation on timeout/failure or transfers it synchronously to startup. Request fields and provider callbacks are captured before the first wait.
- TypeScript and 34 session/policy tests passed, including cleanup followed by a late discovery result and eight stalled discoveries excluding a ninth startup until timeout. No hardware was opened.

## Native serial discovery provider

- Added lazy optional-backend enumeration with required authorization, revision guards before/after native work, bounded validated identity-only snapshots and explicit errors. One outstanding request per provider remains reserved after caller timeout until native work settles, avoiding accumulation of stalled native calls.
- TypeScript and five injected-provider tests passed: normalized output, authorization denial before loading, policy revocation during loading, timeout/concurrency retention, malformed/oversized results and enumeration failure. No actual device enumeration was performed. Shared policy adapter wiring and native distribution packaging remain required before public exposure.

## Native discovery policy integration

- PolicySerialSessionService now shares one native discovery provider across requests and authorizes enumeration through the existing list_devices dispatcher. The canonical workspace overrides caller workspace metadata; absent trusted request context denies before backend loading. Native discovery retains its revision checks and concurrency bound. Open/write approval IDs are not forwarded to enumeration.
- TypeScript and 18 policy/native-provider tests passed, including actual default inspection permission and explicit list_devices denial before loading. No device was enumerated or opened. Hosted PR run 35474147693 at 37870bc completed successfully across all jobs; later local commits require a fresh run.

## Explicit discovery approval retries

- Added a separate validated discoveryApprovalId to trusted serial request context. list_devices consumes only this grant; session/open/write approval IDs remain separate. This completes standalone native inspection approval retries without relaxing one-use semantics.
- TypeScript and 19 policy/native-provider tests passed, including approval-required discovery, rejection of a grant in the session field, successful explicit inspection grant consumption and replay rejection before another native load. Startup composite authorization for repeated metadata verification remains open.

## Bounded startup inspection workflow

- Added internal serial_startup_discovery mapped to list_devices and connected PolicySerialSessionService.startWithDiscovery to native enumeration, identity binding, combined leases and existing open authorization. Its exact-request approval is consumed once for at most four snapshots within 30 seconds; private request context and revision checks prevent reuse after startup finishes. Session-open grants remain separate.
- TypeScript and 42 session/policy/native-provider tests passed, including approval-required composite startup completing all four snapshots and replay rejection before another enumeration. Rebuilt plugin runtime; plugin validation and 14 plugin tests passed. Public tool exposure, legacy exclusion and physical acceptance remain open.

## Cancellation across composite authorization

- Added an owner startup guard captured before composite policy authorization. Owner cleanup during that asynchronous boundary now prevents discovery and transport construction, closing the gap before the manager's discovery reservation exists.
- TypeScript and 39 manager/policy tests passed, including immediate owner cleanup during actual composite dispatch and rejection of standalone list_devices grants for startup discovery. Public adapters, native packaging and the full remaining parity/acceptance/release scope remain open.

## Disconnected serial principals

- Added permanent owner disconnection for adapter lifecycle handling. Disconnected principals cannot create new starts or writes, while owned cleanup remains retryable and retained reads remain policy checked. Disconnect invokes stopAll, preserving cancellation across pending startup authorization/discovery.
- TypeScript and 40 manager/policy tests passed. The new lifecycle test verifies start/write rejection, retained status/read access, cleanup retry and independent operation by a newly issued owner. Actual public transport disconnect wiring remains open.

## Windows process identity deadline

- Hosted run 35474603931 failed one Windows host-identity test after about 3,025 ms: current-process observation was unknown. All other 479 Windows tests passed; Linux/macOS quality jobs passed. Downstream jobs were skipped. The timing is consistent with the three-second PowerShell deadline, though the sanitized observation does not expose the underlying exception.
- Increased only the Windows metadata deadline to ten seconds and the two-observation test budget to 25 seconds. Unknown metadata still never establishes stale ownership; no fallback, cached token or weakened assertion was introduced. This may delay lease operations on an unresponsive Windows metadata backend, but remains bounded. Hosted verification is still required.

## Stateful serial secret filtering

- Added an internal framed-line redactor using shared known-secret patterns plus persistent PEM block state. Partial previews do not mutate stream state; completed lines commit it, and matching closing delimiters end suppression. Input is bounded and unframed multiline input is rejected.
- TypeScript and six redaction tests passed, covering credentials, unterminated multiline blocks, repeated previews, adjacent blocks, mismatched delimiters and input limits. Buffer/public integration remains open, particularly pre-truncation marker tracking and post-redaction response byte accounting. No public redaction guarantee is claimed yet.

## Direct serial buffer redaction integration

- Connected a bounded rolling PEM marker scanner and shared credential patterns to direct-session buffers. Markers are observed before source truncation, block state survives ring eviction, completed storage and partial snapshots are filtered, and matching operates on filtered views. Replacement expansion is clipped without splitting UTF-8 or exceeding budgets; additive metadata identifies filtering/clipping.
- TypeScript and focused buffer/session/policy/redaction tests validate truncation-before-header handling, fragmented delimiters, eviction, filtered partials, replacement expansion and the real owned-session echo path. Direct mode currently filters unconditionally; legacy monitor behavior and public tool exposure are unchanged.

## Separate regex startup and execution deadlines

- Hosted Windows job 105982136299 in run 35474815808 failed a simple case-insensitive regex on PATTERN_TIMEOUT. The previous implementation started its execution timer at worker construction, including startup. Added a ready/start handshake: worker startup is bounded to five seconds, then the existing 1–2,000 ms compilation/execution budget starts before the worker is allowed to run. No untrusted regex executes during startup.
- TypeScript and 33 matcher/lifecycle/buffer tests passed. Simulated slow startup retains the full matching budget; startup expiry ignores late readiness. Real-worker catastrophic-backtracking and capacity recovery tests continue to pass. Rebuilt plugin; validation and 14 plugin tests passed. Hosted confirmation is pending.

## Consolidated serial regression and migration evidence

- Full local backend verification at 2e48a00: TypeScript passed; 70 files / 494 tests passed, 2 files / 22 tests skipped. Output retained in `.platformio-mcp/serial-redaction-regression.log`. Skipped cases do not establish acceptance.
- Hosted run 35475114306 at 5c5928c completed successfully across all quality, dependency, plugin, CLI, browser and smoke jobs. The newer worker handshake still needs hosted confirmation.
- Inspected actual legacy monitor/spooler paths: legacy claims are written by the server while hardware child processes can outlive it. A plain replacement of those claim files with parent-owned leases would not satisfy child ownership. Monitor/uploader spawn barriers and surviving-child custody remain mandatory before shared exclusion/public serial parity can be claimed.
- Inspected installed pinned bindings-cpp 13.0.0 prebuilds: Windows x64, universal macOS x64/arm64 and glibc Linux x64/arm64 binaries are present. This is dependency availability only; the existing plugin builder does not yet package the native dependency closure, and no wheel/native-host acceptance or release is established.

## Self-contained serial backend packaging

- Added deterministic serial runtime bundling, native prebuild copying for the five planned host targets, collected dependency licenses and version metadata. The plugin inventory now covers the backend and native binaries. The main build leaves serialport external and the shared backend loader selects the packaged bundle when present. Ordinary npm/source execution retains its installed dependency path.
- TypeScript and 18 native packaging/transport/discovery tests passed; the packaging test was then strengthened and passed using the actual bundled loader in an isolated directory with no node_modules. It loads exports without enumerating/opening hardware. Plugin validation, 14 plugin tests and npm validation passed; the main package contains 467 files, including the native additions. These are local Windows results, not proof of other-host ABI compatibility or physical acceptance.

## Native payload contract and packed-artifact check

- Shared required-file contracts now make both plugin and npm validators require the serial backend, dependency manifest, primary licenses and binaries for Windows x64, macOS universal and glibc Linux x64/arm64. Plugin validation also requires those files to be present in the checksum inventory. Included the shared validator module in npm files so shipped validation remains executable.
- Recompiled TypeScript, validated plugin and all three npm packages, and passed 14 plugin tests. Created a lifecycle-free development npm archive, extracted it outside the repository using safe tar extraction, and loaded native serial exports on Windows x64 without enumeration/opening. Exact archive SHA-256 is recorded in serial-native-package-windows-evidence.json. This is an unpublished development artifact, not release/physical acceptance.

## Native package failure handling and hosted status

- Native loading now treats the known plugin bundle location or an adjacent native directory as packaged mode. Missing bundled JavaScript, missing native directory or missing host prebuild directory fails explicitly; it never falls through to another installed serialport package. Tests install a sentinel fallback and verify it is not executed.
- Hosted run 35475578886 at 1c9feb1 passed Windows and Ubuntu quality jobs. macOS failed during setup-node with DNS ENOTFOUND for api.github.com and nodejs.org, before tests; dependent plugin/E2E/browser/smoke jobs were skipped. This is unavailable hosted evidence, not a native-load test failure. The next push reruns the suite.

## Reference package argument adapter

- Added strict argument mapping for all six pinned pio_pkg_* names into canonical pkg_* requests. Search retains library/page defaults. Project operations resolve explicit path, trusted launch default, then cwd, with current-user tilde expansion and a required platformio.ini. Nullable env/project fields follow reference defaults. The added approval_id field maps to the canonical scoped grant; approved flags and unknown parameters are rejected.
- TypeScript and three mapping tests passed, covering all six names, nullable defaults, home/cwd resolution, package kind/environment/approval mapping and invalid inputs. No package command ran. Reference source was read from the pinned local AST/source inventory; attribution remains in THIRD-PARTY-NOTICES.md. Response adaptation, launch-mode registration, host tool filtering and real-policy alias execution tests remain open; these aliases are not advertised yet.

## Canonical execution and package result adaptation

- Added executePackageCompatibility, routing mapped requests through executePackageAction with the same authorization, locks, logs and config handling. Results provide reference-style output_tail/output/log_path fields and bounded tails (install success 15/failure 30, uninstall 15, list/update 40, outdated 60). Canonical output defaults remain 40 lines; both modes retain the 32 KiB cap. Canonical failure codes and unrecognized-output states remain explicit, and unknown search totals are null rather than invented zero counts.
- TypeScript and 22 package/compatibility tests passed. Actual policy tests verify alias mutation denial before subprocess execution, unrecognized search remaining non-success and separate 40/60-line tail behavior with a mocked executor. Plugin runtime rebuilt and validated. Literal summary/error-string equivalence, complete parser-row shape mapping, opt-in registry/CLI exposure and host filtering remain unfinished; no reference alias is advertised yet.

## Strict compatibility launch parsing

- Added an internal launch parser for --compat platformio-mcp-python, its equals form and PIO_MCP_COMPAT. Normal mode stays unset; unsupported/empty modes, missing flag values and duplicate selections fail explicitly. Positional arguments following -- remain untouched, as do unrelated policy arguments. The parser does not modify policy or environment state.
- TypeScript and ten launch-parser tests passed. Entry-point/registry integration is still pending; the existence of this parser does not yet enable public aliases.

### Opt-in package MCP integration

- Connected six package aliases to the real MCP registry and canonical executor. Normal mode retains 53 tools; explicit compatibility mode advertises 59. Canonical metadata and permissions are retained.
- Both server and CLI entry points accept the launch flag; environment selection is covered through the CLI entry point. Read-only policy rejects alias installation.
- Added `docs/package-compatibility.md` with the current partial coverage and outstanding reference error-envelope differences.
- Verification: TypeScript compilation; 26 package/adapter/real-stdio tests; 14 plugin tests; plugin validation; npm archive validation for platformio-mcp, pio-agent and pio-mcp. Rebuilt bundled runtime. Prior pushed revision CI run 35476085519 passed.
- No package publication, release tag, merge or hardware operation was performed. Full 40-tool parity and remaining release gates remain open.

### Project inspection compatibility integration

- Added opt-in `pio_project_envs` and `pio_project_metadata` aliases with snake-case argument/result mapping, resolved project defaults shared with package aliases, bounded metadata, and unchanged canonical authorization. Compatibility mode now exposes 61 tools; normal mode remains 53.
- Metadata alias requires the same build permission as canonical metadata because project scripts/dependency installation may execute. Real stdio tests verify read-only denial through both entry points.
- Verification: TypeScript compilation; 22 adapter/project/real-MCP tests; 14 plugin tests; plugin and all three npm archive validations. Bundled runtime rebuilt.
- This covers eight advertised reference aliases, not full 40-tool acceptance. Reference error envelopes and exact result/default equivalence still require broader contract verification. No publication or hardware execution occurred.

### Target discovery compatibility

- Added opt-in `pio_list_targets` through canonical structured metadata discovery. Retains environment identity and reports missing inventory as failure; does not run listed targets. Nine aliases now advertise alongside all 53 canonical tools.
- Compatibility error activity events retain only project/environment metadata rather than full caller arguments.
- Verification: TypeScript compilation; 20 project/adapter/real-stdio tests including target alias read-only denial; 14 plugin tests; plugin and three npm archive validations. Runtime rebuilt. CI run 35476506906 for preceding pushed e84ad9e passed all ten jobs.
- No deployment occurred. Full parity, hardware acceptance and release gates remain outstanding.

### Compact compatibility failures

- All nine implemented aliases now return compact structured exception results with `ok: false`, a reference-style expected-error category and retained canonical code. Approval requests remain blocked with scoped approval identity and selected policy fields.
- The new context-exclusion test caught the legacy formatter including arbitrary exception context; the compatibility boundary now uses only the message and an allowlisted policy projection, with bounded redaction. Canonical envelopes remain unchanged.
- Verification: TypeScript compilation; 10 error/real-MCP tests; 14 plugin tests; plugin and three npm archive validations. Runtime rebuilt.
- Full reference error-class equivalence, remaining tools and release gates remain open. No publication occurred.

### Dependency audit analysis core

- Added bounded pure analysis for observed dependency declarations/manifests: duplicate identities, unconstrained registry entries, missing/leftover heuristics, and iterative cycle detection. Input is bounded to 2048 declarations/libraries and 16384 graph edges.
- Duplicate library names do not establish a winner or an unambiguous cycle edge. Version constraints are not described as exact reproducible pins. Manifest cycles do not claim an observed build recursion failure.
- TypeScript compilation and four tests pass, including a 2000-node chain, self-cycle, duplicate identities and oversized graph rejection.
- Not yet exposed: filesystem inventory, declaration/manifest parsing, optional authorized build/LDF evidence, canonical MCP/CLI registration and compatibility adapter remain required for PAR-07. No hardware or package execution/publication occurred.

### Dependency manifest parsing

- Added bounded declaration parsing and JSON/Arduino manifest extraction. Registry constraints are distinguished from opaque local/VCS/archive sources; malformed evidence is rejected rather than converted into a successful empty manifest.
- Limits: 4096-character declarations, 1 MiB manifests, 512 dependencies per manifest, bounded names/versions. Arduino duplicate relevant fields and malformed constraints fail explicitly.
- TypeScript compilation and ten dependency parser/audit tests pass. Filesystem inventory, canonical authorization/registration, optional build evidence, and compatibility integration remain open.

### Dependency filesystem inventory

- Added one-level inventory collection from caller-authorized roots, preferred JSON/properties parsing, duplicate-root suppression and explicit incomplete-evidence diagnostics. Observed library/manifest links are not silently scanned; opened manifest identity is checked against its prior stat. This is not claimed as a race-proof filesystem sandbox.
- Limits: 64 roots, 4096 entries, 2048 libraries, 1 MiB per manifest and 16 MiB total manifest reads. Malformed preferred JSON does not fall back to properties. Missing manifests retain directory observations but mark evidence incomplete.
- TypeScript compilation and 12 dependency tests pass. CI for pushed f06849c passed (35476792245 and 35476789366).
- Inventory is internal: caller authorization, configuration scope, public MCP/CLI and build graph integration remain required. No publication occurred.

### Resolved dependency configuration

- Canonical environment inspection now additionally retains resolved library extra directories, dependency-finder mode and compatibility mode. Added internal audit input selection honoring explicit/default environments and configured lib_dir/libdeps_dir instead of hard-coded locations. Returned roots require subsequent authorization.
- Invalid environment path components and malformed directory/list settings are rejected. Commas in paths are preserved.
- TypeScript compilation, 18 configuration/project/compatibility tests, plugin validation and three npm archive validations passed. Runtime rebuilt for additive configuration fields. Public dependency execution/authorization and optional build evidence remain open.

### Dependency collection authorization hooks

- Inventory collection now requires an explicit caller authorization assertion and invokes it for requested/canonical roots, library entries, manifest boundaries/read chunks and final return. A revoked authorization propagates even inside recoverable manifest-error handling.
- TypeScript compilation and 16 dependency tests passed, including denial before root access and revocation after manifest open. The hook is not itself a policy grant: the forthcoming canonical service must supply the evaluated scope/revision checks. Public integration remains incomplete.

### Authorized dependency service

- Connected resolved configuration, scoped inventory and optional build through separate canonical authorization stages with distinct approval IDs. Inventory checks policy revision and resolved root containment; build uses an explicit dependency-build action mapped to build permission.
- Incomplete inventory prevents a successful report. Build evidence includes exit status, duration and bounded redacted tail. LDF graph is explicitly `not_collected`, so full reference parity is not claimed.
- TypeScript compilation and 19 dependency tests pass, including real read-only policy, no implicit build, explicit build denial before subprocess execution and malformed inventory failure.
- Service remains internal pending build graph parsing, public MCP/CLI/compatibility integration and broader acceptance. No actual PlatformIO build or deployment was performed.

### Build dependency graph evidence

- Optional dependency builds now parse bounded ASCII LDF trees, preserving nesting, versions and repeated names. Missing/partial graph evidence is distinct from process status; an isolated heading is unavailable, not a successful empty graph. RecursionError text is reported as an observation.
- TypeScript compilation and six graph/service tests pass. Actual build-output acceptance, broader formatting variants, public tool integration and release gates remain open.

### Canonical dependency MCP tool

- Registered `deps_check` as the 54th canonical tool. Its request-level concrete policy check runs before configuration execution, with separate scoped configuration/inventory/build approvals preserved. Canonical MCP results use the existing envelope/activity path.
- Updated plugin skill/coverage and runtime. Compatibility mode now has 63 tools (54 canonical plus nine aliases); the dependency alias and CLI remain pending.
- TypeScript compilation passed. Initial registry suite found its explicit fixture missing the new name; corrected it. Focused MCP/service checks passed (7 tests), five other registry/plugin/authorization files passed (32 tests), and the final registry/service/serial-policy run passed 23 tests. Plugin and all three npm archive validations passed.
- Full parity, dependency CLI/reference adapter and actual build-output acceptance remain incomplete. No release was published.

### Dependency CLI integration

- Added `deps-check` through the canonical service with strict options and separate request/configuration/inventory/build approval identifiers. It does not reuse the generic one-stage `--approve` retry for this composite operation.
- Added dependency workflow documentation. TypeScript compilation, nine CLI acceptance tests, plugin validation and three npm archive validations passed; runtime rebuilt.
- Reference dependency alias, actual build-output acceptance and remaining parity/release work remain open.

### Dependency compatibility alias

- Added `pio_deps_check` in opt-in mode using the canonical dependency service, reference argument names and explicit stage approval extensions. Ten aliases now coexist with 54 canonical tools. Result adapters preserve incomplete inventory and graph status rather than claiming unobserved success.
- TypeScript compilation, eight MCP/service tests, 14 plugin tests, plugin validation and three npm archive validations passed. Prior pushed 4c2416f CI runs 35477201072/35477198874 succeeded. Runtime rebuilt.
- Exact reference row-field equivalence, actual build-output evidence, pre/post-build inventory semantics and remaining parity/release gates remain open. No publication occurred.

### Dependency build outcome and inventory timing

- Results explicitly label inventory as pre-build, matching the reference scan-before-build ordering. Summary reports build success/failure independently; newly installed libraries need a subsequent inspection.
- Added successful/failed mocked-build tests with graph evidence, mutation of installed inventory during build, secret redaction and policy revocation during build. TypeScript compilation and ten service/graph tests passed; plugin and three npm archive validations passed after rebuild.
- These are policy/integration tests with mocked subprocesses, not actual PlatformIO build evidence. Full parity/release acceptance remains open.

### Real Windows dependency MCP acceptance

- Added repeatable MCP-only verification script using the existing pinned ESP32-S3 fixture and isolated build-only operator policy. Canonical optional build and compatibility inspection succeeded without hardware access. Evidence: `dependency-mcp-windows-evidence.json`.
- Real output exposed Core's `Scanning dependencies...` / `No dependencies` form without a graph heading. Added parsing and regression coverage, then reran MCP acceptance successfully with complete empty-graph evidence.
- TypeScript compilation, 11 graph/service tests, real MCP build/alias checks, plugin validation and three npm archive validations passed. Runtime rebuilt.
- This proves Windows empty-graph fixture behavior only. Populated graph, other hosts, exact result equivalence and remaining full-plan acceptance/release work remain open. No release publication occurred.

### Populated dependency MCP acceptance

- Added repository-owned ESP32-S3 build-only fixture with AuditParent/AuditChild manifests and headers. Real MCP canonical build and compatibility inspection succeeded on Windows. Evidence: `dependency-populated-mcp-windows-evidence.json`.
- Observed printed graph contains AuditParent 1.2.3 as a root. Normal Core output did not expose its transitive child; documentation explicitly limits graph completeness to parsing the printed tree. No hardware was accessed.
- Prior pushed 78098466 CI runs 35477876325/35477873538 succeeded. Remaining cross-platform/hardware and full reference acceptance/release gates remain open.

### Memory telemetry statistics foundation

- Added bounded byte-valued statistics with sample-order trends, explicit insufficient-sample status, actual timestamp regression for per-second rates, and paired fragmentation hints. No session-uptime-derived rate or confirmed leak claim is produced.
- TypeScript compilation and four tests pass, including irregular timing, missing/duplicate timestamps, thresholds, limits and inconsistent fragmentation observations.
- This is an internal analysis foundation. Reference telemetry formats, explicit stack word/byte conversion, bounded custom patterns, serial ownership/capture and public MCP/CLI/reference integration remain required.

### Memory telemetry parser foundation

- Added bounded parsing for Arduino-style free/min/largest heap lines and named task stack high-water marks. Stack units remain unknown unless explicitly supplied; word counts require a specified word size before conversion to bytes.
- TypeScript compilation and seven parser/statistics tests passed, covering paired heap fields, unit uncertainty/overrides, unknown logs and input/value bounds.
- ESP-IDF blocks, FreeRTOS task tables, additional print variants, custom bounded patterns, serial collection and public integrations remain open. This is not full memory-watch parity.

### ESP-IDF and FreeRTOS telemetry formats

- Inspected pinned reference parsers.py via GitHub contents API without executing it. Added ESP-IDF aggregate heap blocks and FreeRTOS header-gated task rows, retaining explicit stack units. Heap state expires after 128 lines and skips per-region metrics. Decimal/scientific numeric prefixes are not truncated into integers.
- TypeScript compilation and ten telemetry tests passed. Remaining print variants, bounded custom patterns, report aggregation and serial/public integration remain open.

### Memory report aggregation

- Added report aggregation for parsed metrics/tasks with line-matched timestamps, 200 displayed samples, explicit truncation and unknown-unit counts. Stack thresholds apply only to byte-valued observations; fragmentation requires free/largest values from the same line. Task inventory is bounded to 256.
- TypeScript compilation and 14 telemetry/report tests passed. Public serial capture, custom patterns and remaining format/compatibility acceptance remain open. No hardware execution or release publication occurred.

### Bounded custom telemetry capture foundation

- Extended the existing worker boundary to extract named value/name groups, preserving four-worker capacity, startup/execution deadlines and termination-before-resolution. Limits: 10000 captures and 128 characters per selected group. Missing value groups and oversized output fail explicitly. Literal/regex line matching retains its existing public contract.
- TypeScript compilation and 14 matching/lifecycle/capture tests passed, including supported Python group translation and pathological expression timeout. Plugin and three npm archive validations passed after rebuilding shared-worker runtime.
- Custom captures are not yet connected to memory reports; report merge/units and serial/public integration remain open.

### Custom memory pattern report integration

- Connected bounded named value/name captures to report aggregation for explicit integer-byte custom metrics. Built-in observations with the same metric on the same line are replaced to avoid duplicate counts; metric cardinality is bounded to 256. Invalid/fractional/unsafe integers fail rather than being rounded.
- TypeScript compilation and 16 capture/parser/report tests passed. Custom unit captures and exact span-overlap semantics remain incomplete, as do public serial/MCP/CLI integrations.

### Custom telemetry units

- Worker captures now retain an optional bounded unit group (16 characters). Report conversion supports reference byte/KiB/KB/MB factors and explicit word-size conversion; unknown units or words without size fail with MEMORY_UNIT_REQUIRED. No unit defaults to byte-valued custom telemetry as in the reference.
- TypeScript compilation and 22 report/worker/lifecycle tests passed. Plugin and three npm archive validations passed after rebuilding the shared worker. Remaining format/overlap, serial and public integration work remains open.

### Owned-session memory collection

- Added internal memory collection through owner-scoped serial reads, bounded to 300 seconds, 10000 lines and 1 MiB. Completed lines are analyzed; partial-line omission, data loss/truncation, cancellation, errors and limits are explicit. Backlog read timing is not treated as telemetry sampling time.
- Final authorized read occurs after analysis to prevent disclosure following policy revocation. Buffer tests exposed minimum page-size requirements; fixed collector pages and retained cursor accounting for byte-budget exclusions.
- TypeScript compilation and 25 capture/buffer tests passed. Real manager/physical acceptance, one-shot port handling, public session lifecycle and MCP/CLI/reference wiring remain open.

### Owned memory capture integration correction

Validated capture through the real session manager and byte-at-a-time mock transport, including rejection of another owner and retained reads after stopping. This exposed partial-line read starvation; collection now yields briefly when no completed lines arrive. Disconnected/error sessions, cancellation, and redaction truncation no longer claim complete collection; redaction flags accumulate across pages. No physical hardware was exercised. TypeScript checking and the 29 memory-capture/session-manager tests pass. Public memory tools and legacy ownership migration remain outstanding.

### Reference heap-label coverage

Adapted the pinned reference heap-label and trailer patterns, retaining the MIT attribution. Built-in parsing now covers minimum/free/allocated heap, largest allocation, PSRAM, ESP helper labels, and binary-scaled KiB/KB/MB. Overlapping labels are counted once and observations retain source order. Word-valued measurements remain unknown unless an explicit word size is supplied. TypeScript checking and 19 parser/report/capture tests pass. Stack variants, generic memory labels, exact custom-span precedence, and public tool wiring remain incomplete.

### Stack and generic telemetry coverage

Adapted reference stack HWM/headroom/remaining, function-call, task free-space and generic memory-label patterns with bounded task names and numeric validation. Explicit units scale correctly; anonymous and unitless stack headroom remain unknown rather than assumed bytes. Task tables now tolerate separator rows. Total observations are capped at 10,000 even when each line contains multiple measurements. Attribution updated. TypeScript checking and 22 parser/report/capture tests pass. Public memory tool integration, exact custom-match overlap precedence, and full reference output compatibility remain outstanding.

### Custom memory match precedence

The bounded worker now retains match offsets. Memory parsing excludes only overlapping built-in matches, preserving disjoint measurements on the same line even when metric names coincide. ANSI color removal uses consistent coordinates for custom and built-in matches. TypeScript compilation and 32 worker/parser/report tests pass; rebuilt plugin validates and npm package validation passes (556 canonical package files). This remains internal functionality; public memory tools and complete reference output acceptance are not yet delivered.

### One-shot memory collection lifecycle

Added an internal transient memory collector using policy-backed discovery/start and owned session reads. Shared capture-schema validation and already-aborted requests reject before startup. Both successful collection and parser failure stop the owned session; cleanup-pending state prevents a successful/completed claim. Tests exercise real session management and native mock streams, verifying both physical mock closure and rejected startup. TypeScript checking and 31 memory/session tests pass. Public MCP/CLI wiring, composite approval semantics, legacy shared ownership migration and hardware acceptance remain incomplete.

### Bounded memory-read approval scope

Policy-backed memory capture binds validated capture parameters to the first read approval, then retains that revision guard only for the matching session within the fixed collector call. Every page and final disclosure checks scope lifetime and policy revision; the scope closes in finally. A later capture needs a fresh approval, and changed limits cannot consume the original grant. Transient capture now uses this path. TypeScript checking and 46 real policy/session tests pass, including mid-capture policy revocation. Separate startup/discovery/read grants and public adapter orchestration remain to be completed.

### Separate serial read approval identity

Trusted serial request contexts now accept a separate readApprovalId; opening and writing retain approvalId and enumeration retains discoveryApprovalId. Existing single-operation callers keep their prior approvalId fallback. A real policy test verifies that an opening grant placed in the read field cannot open the port, that an explicit read grant works despite an already-consumed opening grant, and that the read grant cannot be reused. TypeScript checking and 20 policy tests pass. Both CI workflows for pushed revision 1748c67e completed successfully. One-shot approval challenges still require preflight orchestration before opening: a read grant bound to a transient session cannot be retried against a newly created session. This is explicitly unresolved and blocks advertising the one-shot adapter as complete.

### Discovered startup preflight boundary

Added a trusted, deadline-bounded preflight hook after endpoint/USB identity resolution and before transport construction or device-lease acquisition. The prepared request and identity metadata are frozen; ownership stop generation is checked again after preflight. Existing startup still revalidates physical identity before opening. TypeScript checking and 49 session/policy tests pass, including a preflight approval challenge with no transport and owner cancellation during preflight. Composite non-consuming approval planning and transient capture wiring remain incomplete; this hook alone does not fix one-shot approval retries.

### Non-consuming permission planning

Added planAction/planPolicy as explicit internal planning entrypoints. They use the same concrete-operation policy and approval scope but return ready rather than allow, inspect matching unexpired grants without consuming them, and skip scheduled write reservations and execution audit events. Missing grants create normal pending challenges. Execution remains dispatchAuthorizedAction/evaluatePolicy and consumes grants/reservations normally; no caller argument enables planning mode. TypeScript compilation and 82 policy, approval, dispatcher, automation and serial-policy tests pass. Rebuilt plugin and npm package validation pass (560 canonical package files). Composite transient capture orchestration is still pending.

### Stable one-shot open/read approval planning

PolicySerialSessionService.captureMemoryOnce now plans opening and reading together before transport construction, with one-shot purpose, capture parameters and resolved endpoint/USB identity in both scopes. Transient read grants omit the ephemeral session ID only inside the private fixed collector scope and verify the prepared device binding. Missing read approval leaves an approved open grant unconsumed; matching grants work across retries and are consumed once. Opening policy revision remains enforced through read authorization, and cleanup follows revocation. TypeScript checking and 63 dispatcher/session tests passed before the additional transition-revocation test; all 22 serial-policy tests then pass. Discovery retains its separate grant: an approved discovery operation may be consumed while discovering that open/read grants are missing, requiring a fresh discovery grant on retry. Public adapter exposure, legacy ownership migration and hardware acceptance remain incomplete.

### Shared lease status for legacy migration

Added an advisory DeviceLeaseStore.status query serialized with lease mutations. It reports unclaimed/owned/stale/unknown with PID and acquisition time, never release nonces or process-start tokens. Inspection does not recover stale records or confer acquisition rights; malformed records still fail closed. TypeScript checking and all 16 device-lease tests pass, including real process contention/handoff tests and a new status/capability test. Legacy semaphore paths are still unmigrated: their raw files can overwrite claims, and upload/monitor child custody must be preserved while replacing them before public direct-serial tools are enabled.

### Spooler timeout custody correction

Replaced PID-only delayed termination with completion tracking on the original ChildProcess handle. Timeout requests termination, escalates within a bounded grace period, and reports whether process exit was actually observed. Background spooling retains its port claim and PID tracking when termination remains uncertain instead of freeing hardware immediately after requesting termination. TypeScript checking and eight spooler/process/wait tests pass; a subsequent real Node-child timeout test also passes (four waiter tests total). No hardware was used. Shared legacy lease migration, child handoff, monitor-stop identity checks, and late-exit recovery remain incomplete.

### Spooler failure cleanup verification

Foreground process failures now record task failure and close local log descriptors/watchers in finally. Port claims and PID tracking are released only when exit is confirmed; uncertain children retain custody. New isolated tests cover foreground/background and confirmed/uncertain termination without invoking PlatformIO. Eight custody/wait tests and TypeScript compilation pass. Rebuilt plugin and npm validation pass (564 canonical package files). Legacy shared leases and surviving-child custody are still outstanding; these cleanup fixes do not establish full hardware lifecycle parity.

### Legacy monitor termination identity

New monitor registrations retain OS process-start identity beside the compatible numeric PID registry. Termination holds the registry lock, rejects unverified/reused identities without signalling, and confirms stale/absent process identity before removing tracking. Signal failure preserves records. stopMonitor releases a port claim only after tracked termination succeeds, and retains daemon state on termination errors. Updated the API process fixture to real EventEmitter lifecycle semantics. TypeScript compilation, 27 monitor/process/API tests, rebuilt plugin validation and npm validation pass. Legacy monitor records without identity fail closed while live; operator recovery/migration remains necessary. This does not yet establish atomic shared lease release, descendant custody, or full legacy lock migration.

### Runtime floor and CI fixture correction

Canonical and both npm alias engine declarations now require Node >=20, matching the native serial runtime, with the root lockfile and README aligned. The remaining build child-process fixture now uses EventEmitter lifecycle events and exit metadata. Both failed CI runs at ee1490d9 contained only the API/build proc.once fixture failures; those cases now pass locally. TypeScript checking, 28 targeted build/API/custody tests, and all npm package validations pass. Full new-head CI remains to be observed; no release has been published.

### Durable child-handoff uncertainty

Device leases now support a persisted pending-handoff marker before a child launch. Marked leases report unknown custody, reject normal release, and cannot be automatically reclaimed even after the coordinator is proven stale. Verified transfer clears the marker while recording child identity; cancellation requires the original trusted release capability and proof by the launcher that no child remains. TypeScript checking and 19 lease tests pass, including a real separate coordinator that writes the marker and exits. Launcher integration and explicit unresolved-handoff recovery remain outstanding; no hardware was exercised.

### Verified transferred-child cleanup

Transfers now retain a process-local receipt capability. finishTransfer removes only the original unadopted lease with the same persisted owner and nonce, after OS identity proves that child stale; it never signals a process. Copied/reused receipts, live/unknown owners, and reacquired resources reject cleanup. TypeScript checking and all 21 lease tests pass. This is an internal custody primitive; legacy launcher integration and recovery of interrupted handoffs remain outstanding.

### Distribution readiness priority (user steering)

Prioritized namespace release readiness without narrowing full goal completion. Added distribution/namespaces.json covering existing npm identities, scoped candidate, Python canonical/alias candidates, excluded normalized third-party name, MCP Registry, plugin, GitHub and explicitly unsupported channels. A fresh bounded read-only audit verifies npm 3.0.0 project links and records raw response hashes; public missing lookups remain unclaimed, not promised available. GitHub admin permission was verified; local npm authentication returned 401. Added exact-version npm alias pins, artifact-integrity publication preflight and post-publish verification, and five namespace/identity tests wired into CI/release. All three npm package validations pass. docs/DISTRIBUTION_READINESS.md records the channel-by-channel evidence and remaining gates. Python wheels, MCP manifest, publisher authority, new release version, installed-artifact/provenance acceptance, and full parity remain incomplete. Nothing was published.

### Official MCP Registry preparation and CI repair

Added server.json for io.github.jl-codes/platformio-mcp and npm mcpName, pinned official schema/source/hash/license, and a release validator rejecting namespace, source, version, runtime and configuration substitution. Release artifacts now include the manifest and the release gate validates it. Seven Node-runner distribution tests pass. Fixed current CI regressions: Vitest no longer collects the separately executed Node-runner suites, functional alias tests require exact canonical versions, and unused destructuring bindings were removed without changing lease or serial authorization behavior. Fifty affected lease, serial-policy and launcher tests pass; TypeScript, lint without errors, rebuilt plugin validation and all three npm package validations pass. Full CI for this revision remains pending. Manifest preparation does not establish publication authority, and no new version has been published. Python wheels, publisher setup, installed-artifact/provenance acceptance and full parity remain outstanding.

### Preserve reviewed release identity during publication

The npm publication step now requires the previously generated/uploaded preflight manifest, compares its source commit and ordered package identities against a fresh registry/artifact check, and leaves the recorded manifest unchanged. Tests reject source, package, version, path, hash and package-set substitution and disappearance of a previously verified release. Eight distribution tests pass. Removed GitHub release --clobber so reruns cannot silently replace existing assets; identical GitHub asset reuse is still outstanding. The preceding goal turn made concrete progress through committed MCP metadata and CI repairs. Current CI runs were observed queued/pending, not treated as passed. No publication was performed.

### Python launcher implementation started

Added a Python launcher for a local bundled Node/CLI payload, with explicit five-host selection, path containment, duplicate detection, required entry points, byte sizes and SHA-256 verification before execution. The launcher preserves cwd/arguments/environment and inherits stdio; POSIX uses exec replacement, while Windows retains the parent until child exit and forwards SIGTERM. Five Python unit tests pass for routing, host mismatch, tampering, unsafe/duplicate paths and missing entry point. This is not yet an installable wheel: pinned Node binaries/licenses, a CLI bundle (the current plugin bundle is MCP-only), wheel construction, OS/glibc minimum checks, real signal/stdio acceptance and all five installed-host tests remain required. No Python distribution has been published.

### Python shared CLI staging bundle

Added build-python-runtime.mjs to stage the existing TypeScript CLI as a self-contained bundle alongside the plugin runtime, dashboard, native serial files, installers, plugin validation assets and license notices. It requires a new destination and preserves the dynamic installer/validator paths. An isolated temporary-directory test passes version, help and full plugin runtime validation and rejects accidental reuse of a staging directory. The test is wired after plugin build/validation in CI and release gates. This evidence uses the host Node executable; it does not prove bundled Node or installed-wheel support. Node pinning/licenses, complete bundled dependency attribution, wheel assembly and host/signal/stdio acceptance are still outstanding. No publication occurred.

### Pin redistributable Node archives for Python wheels

Retrieved official Node 24.15.0 SHASUMS256 and platform requirements, pinned five archive identities and planned wheel tags, and implemented bounded build-time download plus checksum verification before selective executable/license extraction. Windows x64 official archive verification/extraction and the resulting Node --version passed; full bundled Node LICENSE retained (159872 bytes). Three negative tests cover invalid checksum with no output, existing destination preservation and unsupported host; all eight Python launcher/archive tests pass. Four other host launches, OS/libc runtime checks, wheel construction, complete runtime attribution and real installed signal/stdio tests remain incomplete. No publication occurred.

### First installed Windows wheel

Implemented pyproject metadata, functional command entry points, pinned packaging backend, optional PlatformIO 6.1.16 extra, binary wheel tagging and a wheel assembly script using the shared CLI plus verified Node archive. Corrected binary installation layout after the initial build hit Windows path length limits; short staging paths remain recommended. Built pio_agent_platformio-3.0.0-py3-none-win_amd64.whl, installed offline with no dependencies into a fresh Python 3.14 venv, removed global Node from PATH, and passed version/plugin-validation/help through the three installed executable names. Artifact hash and limits are recorded in python-wheel-windows-evidence.json; the build used uncommitted builder changes atop 28cc70cb, so it is development evidence, not source-commit release provenance. Other hosts, OS minimum checks, installed MCP and signals, full license inventory, aliases and publication remain incomplete. Nothing was published.

### Correct runtime version identity

Removed the hardcoded MCP 1.0.0 version and unified CLI, MCP handshake and startup diagnostics around package/plugin metadata using URL-safe paths. Rebuilt the plugin and development Windows wheel. The already-running installed check completed successfully with version 3.0.0, 54 normal tools and 64 compatibility tools, JSON-only stdout and clean EOF exit. TypeScript and targeted lint passed. User explicitly requested stopping repeated smoke-test work; continue implementation directly and avoid redundant validation runs. Full parity and publication remain incomplete.

### Functional Python alias wheels

Implemented pio-agent and pio-mcp alias distributions with exact canonical version dependencies, delegated PlatformIO extra and useful Python module entry points. The canonical package alone owns console scripts, avoiding overlapping installed command files. Both platform-independent alias wheels build successfully; direct artifact metadata inspection confirmed exact 3.0.0 dependency pins, module delegates and no conflicting entry-point files. No repeated runtime smoke tests were run. Publisher control, uvx installation and uninstall behavior remain acceptance requirements; nothing was published.

### Release workflow assembles complete Python distribution set

Added a release build job that assembles all five pinned platform wheels and both functional aliases, validates package versions/source commit/runtime hashes/alias pins and inventory coverage, and retains the artifacts. Existing release job now depends on that job and downloads its exact-run artifact set before upload/attachment. A Python release identity manifest records wheel SHA-256 hashes. YAML parsing and dependency inspection pass; the complete workflow has not been run and no host execution acceptance is inferred from cross-assembly. PyPI publication remains unwired pending verified authority and release acceptance. No runtime smoke tests or publication were performed this turn.

### Enforce Python wheel operating-system floors

The launcher now requires the pinned platform contract and rejects older Windows/macOS/Linux kernels, older glibc and musl before executing bundled Node. The wheel builder embeds those requirements, and release validation checks them against the support manifest. Syntax compilation passed; no repeated smoke tests were run. Linux libstdc++ symbol-version acceptance remains an explicit target-host requirement, not proven by these checks. No publication occurred.

### Include bundled JavaScript dependency licenses

Python runtime assembly now uses esbuild input metadata to identify and copy license/notice files from each bundled dependency instance, with package names/versions/input paths and notice hashes in a shipped inventory. A real staging build collected 116 dependency records; missing license files stop assembly. Separate nested versions/copies are preserved, and short collision-checked paths avoid excessive Windows wheel paths. Release validation now requires the inventory. Native dependency and Node licenses remain separately included. This does not establish complete dashboard asset attribution or legal review; those still need accounting. Corrected the existing payload-test Windows version mock for non-Windows runners without running more smoke tests.

### Distinguish clean release wheels from development builds

Canonical and alias wheel builders now reject modified tracked source and untracked build inputs by default, record source identity, and recheck source state after assembly. Explicit --allow-dirty supports unpublished development artifacts with sourceDirty metadata; release validation rejects those artifacts. Alias wheels also ship source.json bound to the release commit. Python syntax compilation and diff checks passed; no runtime smoke tests were performed. The source-status digest describes checkout state, not a cryptographic attestation or a filesystem snapshot; artifact hashes and release provenance remain separate requirements.

### Bounded cached namespace observations

The namespace audit now enforces its actual per-run lookup budget, rejects malformed limits, reuses six-hour public metadata observations, and respects bounded Retry-After backoff for rate limiting. Failed lookups retain an hour of backoff; no retry loop sleeps or repeats requests. Public authority remains unverified even for cached entries. Change reporting compares status/version/source/maintainers/integrity while ignoring observation timestamps and raw-response formatting. Five focused mocked-registry unit checks pass; no network audit or runtime smoke run was started. Existing CI run 35482677676 remained in progress; this change is committed locally before pushing so that run can finish without another cancellation.

### Maintainer-enabled weekly namespace workflow

Added manual/weekly audit workflow guarded by the explicit repository enable variable for scheduled runs. Cache restoration and saving retain prior observations; evidence is uploaded before changed ownership/source/integrity signals or newly blocked/unknown lookups affect workflow status. Same-version integrity changes are distinguished from routine version updates. Release artifacts now include namespace observations. YAML and JavaScript syntax parsing pass; no live schedule, network audit or runtime smoke test was started. Existing CI run 35482677676 is still live, so these commits remain local until it finishes.

### Preserve Python runtime in host installer configuration

Wheel-launched installers now receive the absolute Python interpreter from the launcher and write an interpreter/module command for fresh host configuration, keeping the bundled Node path usable without global npm. JSON host installers share this behavior; Codex new/updated npm-style entries use the same command while retaining runtime flags, and existing custom launchers remain preserved. Interpreter paths must be absolute existing files. Syntax and diff checks pass; no runtime smoke run was started. Both existing CI workflows for 7a2a20dd completed successfully (35482677676 and 35482679272); that result does not cover these newer local edits.

### Board reference tools wired into compatibility mode

Added opt-in pio_list_boards and pio_board_info through the canonical list_boards/get_board_info permission dispatcher and existing catalog services. Supports vendor/query/platform/framework filtering, exact-id/shorter-id ordering, reference limit slicing, compact CPU/memory values and board debug/connectivity hints. Board schema retains catalog debug/connectivity fields. Source attribution is recorded. TypeScript and targeted lint pass; four fixture-based adapter checks pass, including no execution after denial. Rebuilt plugin payload. Canonical tools remain 54; compatibility now adds 12 aliases (66 tools). Actual catalog acceptance, exact error-envelope parity and the remaining reference tools are still incomplete; no hardware or broad runtime smoke test was run.

### Reference device presentation

Implemented reference device rows, likely-board/noise hints, stable likely-first ordering and summary fields. Private claim records and inferred board IDs are excluded from the projection. TypeScript and two fixture-only checks pass; no devices were enumerated or opened. The full pio_list_devices alias is intentionally not advertised yet: its open_monitor_sessions field must come from caller-owned session listing, not a fabricated empty list or a global session dump. Public tool counts remain 54/66. This is a partial implementation step toward the complete alias, not completed device parity.

### Authorized owned session listing

Added internal serial_session_list mapped to get_monitor_status permission and PolicySerialSessionService.listSessions. It validates the owner capability before consuming approvals, requires trusted request context, resolves one canonical project, checks policy revision around disclosure and filters snapshots by both owner and project. Only metadata is returned. TypeScript passes; the two new targeted policy/isolation checks pass using mock transports (22 unrelated cases were not rerun). Rebuilt the plugin payload for the action catalog change. Public caller/session lifecycle wiring and complete pio_list_devices/monitor aliases remain outstanding; no physical hardware or broad smoke run occurred.

### Per-connection serial ownership wired to MCP lifecycle

Added SerialClientContext with a manager-issued owner capability, request-local policy context, rejection of requests/results after disconnect, coalesced cleanup and retryable unconfirmed closure. The MCP stdio server now creates one context per connection and invokes owned cleanup on close without discarding pending device ownership. TypeScript/targeted lint and two mocked lifecycle checks pass; the plugin payload was rebuilt. Public monitor operations are still not advertised pending shared legacy custody and adapter completion. No native hardware or broad smoke test ran.

### Device compatibility alias integrated with owned sessions

Advertised pio_list_devices only in compatibility mode, combining canonical discovery with caller/project-owned session listing under separate list_devices and serial_session_list authorization. Session snapshots now expose bounded counters without serial text. Reference response includes likely ports and actual owned session metadata; cleanup uncertainty remains explicit. The complete composite runs inside the connection context so disconnect suppresses result delivery. TypeScript/targeted lint pass and plugin payload rebuilt; no hardware discovery or broad smoke run was performed. Canonical count remains 54, compatibility count is now 67. Reference global cross-project session behavior is deliberately constrained to the launch-owned project/caller for permissions; exact error text/approval retry parity and remaining monitor tools still require work.


## Public memory-watch adapter

`pio_memory_watch` now routes existing-session collection through owner-scoped `captureMemory` and temporary collection through preauthorized `captureMemoryOnce` with shared project/port defaults. It projects reference field names while retaining explicit collection loss/limits, cleanup state and unknown-unit counts. Safety divergences are deliberate: fewer than three observations remain `insufficient_samples`, time rates remain null without actual observation timestamps, fragmentation uses paired observations, and unknown stack words are not assumed to be bytes. `duration_s` describes the actual collection window rather than the lifetime of an older session. Collection stops at bounded line/byte limits and reports incomplete status; this does not establish all reference behavioral fixtures or physical acceptance. A focused actual-buffer collection/projection check and TypeScript passed. Full final-revision acceptance remains pending.

### Port diagnostics and explicit alias coverage

Added opt-in `pio_port_diagnose` (75 compatibility-visible tools; 54 canonical unchanged). It resolves project defaults through existing authorization, separately authorizes device discovery and owned-session metadata, and checks the policy revision before returning diagnostics. OS inspection uses fixed executable paths, bounded output/time, and no serial open/close or process termination. Discovery failure is unknown; no observed holder does not prove exclusive access. Windows holder inspection remains unavailable. Linux/macOS command execution and full adapter acceptance remain unverified.

Validation: TypeScript no-emit check passed; four focused port-diagnostics checks passed on Windows (holder parsing, output bound, invalid endpoint, Windows endpoint forms). No broad runtime smoke test was repeated.

`distribution/README.md` now records all four user-requested aliases across each suitable channel and requires explicit published/equivalent/blocked accounting. This is release scope, not evidence of publication or ownership.

### Container archive publication identity

The release job now downloads both same-run native container archives, verifies archive hashes and same-commit context metadata, loads each archive, and inspects the declared immutable image ID. The verifier requires Linux amd64/arm64, exact source/version/revision/license labels, the non-root runtime contract, and all four requested GHCR targets. It records a release identity for the later publisher; it does not publish or claim anonymous availability. Four focused metadata rejection checks passed locally. Docker load and the complete release job remain unexecuted locally because the Docker daemon is unavailable. GHCR publishing and public-access verification remain pending.

### Seven explicit names and gated GHCR publisher

Expanded requested aliases to `platformio-mcp`, `pio-mcp`, `platformio.mcp`, `pio-agent`, `platformiomcp`, `pioagent`, and `flashagent`. The GHCR publisher requires all seven targets and exact matching two-architecture image indexes. The protected workflow option remains disabled by default and requires complete same-commit acceptance, verified namespace inventory flags and a publisher configuration marker. It checks existing version and architecture identities before writes, retains partial publication accounting, and verifies anonymous index/child reads. It does not claim registry-pulled execution or hardware acceptance. No GHCR publish occurred.

Added a functional `flashagent` npm candidate pinned to the canonical release, with no lifecycle scripts. It packed successfully without installation. Existing npm collision entries already cover `platformiomcp` and `pioagent`; the corresponding PyPI names are distinct candidates. Read-only registry lookups returned 404 for npm `flashagent` and PyPI `platformiomcp`, `pioagent`, `flashagent` in this work session. This is absence evidence only, not registrability or authority. Additional Python alias packaging remains pending.

Validation: five focused publisher conflict checks, four native image identity checks and four npm release identity checks passed. Release YAML parsed. Live Docker/registry publication remains unexecuted. Added explicit native container acceptance to the requirements catalog; the evidence template remains blocked rather than claiming completion.

### Additional functional Python aliases

Implemented `platformiomcp`, `pioagent`, and `flashagent` as exact-version dependencies on the canonical bundled engine, with independently owned console commands. Existing aliases continue to avoid overwriting canonical commands. Build, release validation, native-host acceptance and PyPI staging now derive alias identities from a shared inventory resolver; new candidates remain excluded from publication until explicitly verified and promoted. Native acceptance checks installation and removal of every built alias.

All five alias wheels built with pinned tooling in an isolated local environment. ZIP metadata inspection confirmed exact canonical dependencies and dedicated command ownership; no runtime installation or launch was performed. These are dirty-source development wheels, intentionally ineligible for release. Python scripts compiled and release YAML parsed. The expanded ten-wheel release set and native-host execution remain to be validated on the eventual clean release commit.

### Alias version maintenance and CI process isolation

Added `aliases:sync` and `aliases:check` for all seven functional npm alias packages (including scoped candidates). The synchronizer validates the full edit set, updates only version/exact canonical dependency pins, and never promotes candidates or changes authority flags. The release gate checks alignment; current version 3.0.0 passed without edits. Python versions already derive from the canonical manifest.

CI run 35486482416 exited 137 on macOS immediately after process-manager cleanup logged emergency termination of fixture PID 20000. Inspection found that cleanup restored real `process.kill` before calling termination and did not mock `tree-kill`. Corrected test isolation to mock tree termination and retain the process mock through cleanup. All three focused process-manager checks passed locally. This addresses the observed termination path; a subsequent completed CI run is still needed to establish host-wide success.

### Coordinated serial and dashboard shutdown

Replaced independent dashboard signal exit with shared shutdown coordination. SIGINT/SIGTERM now await both dashboard closure and owned serial-session cleanup, coalesce repeated signals, report failure when serial closure remains unconfirmed, and bound an unresponsive shutdown at 15 seconds with failure status. Unconfirmed device leases are not released by this coordinator. Three focused coordinator checks passed and TypeScript passed; the plugin bundle was rebuilt. Native signal delivery and real transport shutdown acceptance remain pending.

Read-only deployment access check: local `npm whoami` returned HTTP 401; GitHub reported no repository environments and no repository variables. Thus local npm authority and protected PyPI/MCP/GHCR publisher configuration are not established. No publication was attempted. These external prerequisites do not prevent continuing implementation.

### Backtrace compatibility adapter

Added opt-in `pio_decode_backtrace` (76 compatibility-visible tools; 54 canonical unchanged). It accepts explicit text or an owned session, resolves configured/default analysis environments, and delegates to the existing authorized metadata collection, toolchain discovery and immutable ELF snapshot decoder. Serial-read, configuration and analysis grants remain separate. The response retains unresolved frames, corrupted-backtrace state, ELF SHA-256 and an explicit unverified flashed-firmware flag; bounded session capture reports dropped/truncated evidence. No-address input returns without executing analysis tools. The trusted addr2line path is now included in the canonical analysis result for compatibility projection.

Three focused adapter checks passed (configuration denial, owned-session denial, separate grants/identity projection); TypeScript passed and the plugin bundle rebuilt. Real ELF/board and native transport acceptance remain separate. Size-report compatibility and offline artifact selection are still pending.

### Size-report compatibility

Added opt-in `pio_size_report` (77 tools with compatibility enabled, 54 canonical unchanged). It resolves the selected/default environment, independently authorizes board metadata and build analysis, and projects sections, symbols, files, board capacities and memory accounting from the canonical verified-ELF engine. PlatformIO percentages take priority over generic size estimates. Filters use the existing bounded regex workers; explicit limits remain top 1–1000 and 40 returned sections. `memory_log_path` is null because the current canonical size collector does not retain a separate log file; persistent size-check log evidence remains a contract gap.

TypeScript passed and the plugin rebuilt before interruption. Two focused adapter checks passed afterward, covering separate approval arguments/partition-aware percentages and rejection before build execution. No broad smoke test was repeated; native ELF/hardware acceptance remains pending.

### Expanded alias families

Added functional `@forkbomb/flashagent` npm and `flash-agent` Python candidates; tracked flash-agent/flash.agent/flash_agent npm collision candidates and scoped platformiomcp/pioagent variants. Extended the GHCR inventory to ten names and generalized container target resolution to retain all seven explicit targets while including additional validated names under the same owner. All candidates remain publication-disabled until authority/eligibility evidence exists. npm version alignment and four release-identity checks passed; Python publisher selection still excludes new unverified candidates. No alias was published.

### Expanded registry observations

Refreshed the cached public namespace report for the expanded inventory. npm `flash-agent` exists at 1.0.38 with maintainer `chenpingaodian` and no repository link in the returned metadata. Marked that name excluded from project publication; recorded the punctuation-family collision against unscoped `flashagent`, `flash.agent` and `flash_agent`. Missing exact-name lookups cannot establish registrability. The scoped flashagent candidate remains subject to independent scope-control verification. PyPI `flash-agent` returned 404, separately from npm; no claim of availability or ownership follows. No package was installed or published.

### Ordered project-init options

Extended the shared project initializer to accept a bounded ordered `projectOptions` list in addition to the existing `platformOptions` map. Repeated keys retain their original order and are passed as separate argv values. Option syntax/size checks happen before directory creation. Existing callers and their 120-second timeout are unchanged. TypeScript passed. The public reference project-init adapter, response/log projection and its acceptance checks remain unfinished.

### Public initialization compatibility

Added `pio_project_init` (78 compatibility-visible tools, 54 canonical). The adapter binds ordered options to canonical initialization authorization and separately authorizes configuration disclosure before invoking the initializer. It supports explicit/home-relative paths, bounded INI output with existing secret redaction, and a bounded visible layout. TypeScript and two permission-denial checks passed; plugin rebuilt. No actual PlatformIO operation was executed locally. Remaining exact-contract gaps include retained initialization logs, reference timeout/failure output semantics, and native project-init acceptance.

### Initialization timeout and logs

The compatibility initializer now requests the reference's 600-second timeout through a trusted execution option; canonical callers retain 120 seconds. Completed command output is written to a uniquely named, bounded, redacted initialization log with restrictive creation permissions. Nonzero command results project `init_failed`, exit-specific summary, bounded redacted output and log path. Missing-executable/timeout exceptions remain explicit errors through the shared wrapper. TypeScript and focused initializer/permission checks passed, including the timeout/output callback. Native execution and persisted-log acceptance remain unverified locally.

### Retained size-check logs

Unified initialization and size-check output retention in a bounded, redacted command-log writer with unique filenames and restrictive file creation permissions. Authorized `checkprogsize` results now retain stdout/stderr for both success and nonzero exit status, and size reports expose that actual log path. ELF/environment identity checks remain in place before report construction. TypeScript and the existing focused build-context checks passed; plugin rebuilt. Native command execution and full final-revision acceptance remain separate.

### Canonical Python publisher inventory enforcement

The Python publisher resolver now requires one exact canonical PyPI identity with an enabled boolean publication flag and canonical role. Missing, disabled, duplicate normalized, misspelled and excluded identities fail before publisher selection. Two focused regression checks passed, covering six invalid inventory cases; the current selected publishers remain pio-agent-platformio, pio-agent and pio-mcp. All six functional Python alias sources remain buildable candidates; this change does not enable or claim publication. PR accounting was refreshed to 78 compatibility-visible tools, eight npm aliases, six Python aliases and ten GHCR names.


### Shared clean target options

The shared clean executor now supports validated environment selection and an explicit fullclean target while retaining the existing canonical clean target, timeout, background behavior and return shape. Invalid options fail before cache invalidation or command dispatch; valid cleanup still invalidates build cache and uses the existing spooler. TypeScript and three focused mocked checks passed. Plugin runtime rebuilt. The public pio_clean adapter and reference result/timeout projection remain pending; no native cleanup or hardware operation was performed.


### Public cleanup compatibility adapter

Added opt-in pio_clean, increasing the compatibility surface to 79 tools while preserving 54 canonical tools. Environment/fullclean parameters bind to canonical clean_project authorization; execution retains the shared implicit hardware lock and checks policy revisions around effects and disclosure. The adapter uses the reference two-minute clean timeout, collects completed logs with a 16 MiB limit, retains redacted output, reports nonzero exits, compiler diagnostics/counts, environment markers, memory lines and a 40-line tail. Existing canonical callers retain their timeout and return shape. TypeScript and seven focused mocked cleanup checks passed; bundled plugin rebuilt. Native cleanup, exact diagnostic ordering/summary/port-error parity, timeout response projection and full final-revision acceptance remain pending. No publication performed.


### Cleanup result projection fidelity

Completed cleanup diagnostic category ordering and overlapping compiler/linker/SCons matches, with per-category deduplication and uncapped counts. Summary now includes first-error location, warning count and memory percentages. Tail output removes ANSI, CR progress delimiters, obsolete-core banners, reference boilerplate and trailing blank lines. Port errors follow reference precedence. TypeScript and six focused mocked adapter/parser checks passed; plugin rebuilt. Native execution and timeout response projection remain pending, so full clean acceptance is not claimed.


### Cleanup timeout and uncertain process custody

Foreground spooler failures now carry their log path and explicit cleanup state. Clean preserves typed execution errors. Confirmed timeout termination permits bounded redacted output collection, reference timeout marker/status/exit -1 and retry guidance. Unconfirmed termination remains an error, is not read as completed output, and retains the shared implicit hardware lock until recovery instead of releasing it in finally. TypeScript and 21 focused mocked cleanup/spooler/lock checks passed; plugin rebuilt. Native host/process-tree/hardware acceptance remains required; this does not prove termination of arbitrary descendants or complete the overall parity goal.


### Public build compatibility adapter

Added opt-in pio_build via canonical build_project authorization and shared implicit locking. Jobs/verbosity bind to the authorized request. Trusted executor options support jobs, timeout and completed-output observation; compatibility invokes a fresh foreground build with the reference twenty-minute timeout while canonical callers retain caching/background/default timeout behavior. Build and cleanup share bounded redacted output collection, diagnostics, memory, port errors and confirmed-timeout projection. Job counts are restricted to integers 1..1024 as an explicit resource bound. Compatibility surface is now 80 tools (54 canonical, 26 aliases). TypeScript and 22 focused build/clean/cache checks passed after correcting a mock export; plugin rebuilt. Native builds, complete artifact identity/upload integration and final-revision acceptance remain unfinished. No distributions published.


### Canonical access to new build and cleanup options

Added optional jobs and forceExecution fields to build_project, and optional environment/full fields to clean_project, preserving existing required fields and omitted-option behavior. Shared build core forwards options under existing explicit/implicit locking. CLI build accepts --jobs and --force-execution; dashboard command API forwards build/cleanup options to shared executors. Runtime option validation rejects malformed booleans/counts before execution. These capabilities no longer require compatibility mode. TypeScript and six focused schema/core/executor checks passed; plugin rebuilt. No native command execution or distribution publication occurred.


### Dashboard build and cleanup controls

The launcher now exposes bounded parallel build jobs, environment selection for cleanup, and a labeled fullclean switch explaining dependency redownloads. The fullclean value resets when its control unmounts; outgoing job/full/port/verbose/monitor fields are restricted to applicable actions. Dashboard builds already execute in the background and bypass cached-result replay, so no redundant force control is shown. Frontend TypeScript and production build passed; plugin rebuilt with updated dashboard assets. Browser interaction/native execution acceptance remains separate. No smoke suite or publication was run.


### Structured checker execution and report parsing

Extended the shared checker with optional JSON output, severity threshold, source pattern, package skipping, analysis tool, trusted timeout and result observer. Existing calls retain defaults. Added a bounded validated report parser retaining tool success/duration, defects, CWE, source location, severity totals and reference severity ordering. Project-relative paths require actual ancestry, avoiding sibling-prefix truncation. Missing or malformed reports fail explicitly rather than becoming empty success; unusual severity keys cannot mutate prototypes. TypeScript and eight focused parser/executor checks passed after fixing cross-platform path normalization. Public pio_check wiring, native tool reports and canonical structured presentation remain pending. Plugin rebuilt; no publication performed.


### Public static analysis compatibility

Added pio_check with reference severity/pattern/skip_packages/tool defaults, bound to canonical check_project permission. Execution shares the existing checker, hardware lock, twenty-minute timeout, revision guard and bounded redacted log collection. Returns structured defects, CWE/source locations, severity totals and tool status; missing/malformed reports, failed tools, and incomplete timeout output are explicit failures. A nonzero exit with an empty report is rejected as a documented safety correction. Compatibility surface now has 81 tools (54 canonical, 27 aliases). TypeScript and 15 focused mocked adapter/parser checks passed; plugin rebuilt. Native cppcheck/clangtidy/PVS reports and canonical structured-report interface remain pending; no publication performed.


### Canonical structured checker access

Added optional static-analysis filters and structuredReport to canonical check_project. Foreground structured calls attach validated analysisReport while retaining legacy fields; omitted options retain old behavior. Dashboard API forwards analysis filters. Extracted completed-log reading into a descriptor-based 16 MiB bounded helper shared by compatibility and canonical reporting, rejecting growth or truncation during collection. TypeScript and 21 focused mocked adapter/executor/parser checks passed; plugin rebuilt. Background structured report retrieval, dashboard filter controls, native analyzer acceptance and broader parity remain pending. No distribution publication occurred.


### Dashboard static-analysis filters

The launcher exposes minimum severity, source pattern, configured analyzer and dependency-source exclusion. Optional fields preserve defaults when left empty, and filter fields are sent only for the checker action. Frontend TypeScript and production build passed; plugin rebuilt with current assets. Browser interaction, background structured-report retrieval and native analyzer acceptance remain separate. No publication occurred.


### Shared reference test execution options

The existing test runner now accepts trusted inclusion/exclusion globs, separate upload/build switches, upload port, verbose output, report destination, timeout and completed-result callback. Compile-only/build-only still force both --without-uploading and --without-testing and omit upload-port selection; contradictory skip-building requests fail before execution. Outside build-only, without-uploading does not incorrectly imply that hardware is untouched. Existing defaults remain unchanged, and typed process custody errors survive the wrapper. TypeScript and ten focused mocked execution-mode checks passed; plugin rebuilt. Public pio_test routing, owned report lifecycle/per-case parsing, explicit device selection/lease coordination and native/hardware acceptance remain pending. No publication occurred.


### Per-case test report parser

Added a bounded parser for PlatformIO JSON test reports, retaining suite/environment/status/duration and case name/status/message-or-exception/source location. It rejects malformed/incomplete reports, unfinished case statuses and aggregate counters inconsistent with case evidence rather than declaring a false pass. Explicit zero-case reports retain zero cases. TypeScript and three focused parser checks passed. The stricter completeness rules require confirmation against native real reports before acceptance; report lifecycle and public adapter wiring remain pending. Parser is not yet reachable from the shipped runtime, so no unnecessary plugin rebuild was performed. No publication occurred.


### Owned test reports and canonical foreground access

Added private unique foreground test-report files, bounded redacted parsing and nonrecursive cleanup of the owned file/empty directory after completion. Unconfirmed process termination retains the destination and propagates cleanupPending with retainedReportPath. Missing/invalid report data cannot override command success into a passing result. Canonical run_tests accepts structuredReport for foreground calls under its existing authorization/lock; existing defaults are preserved, and background+structuredReport is explicitly rejected pending lifecycle support. TypeScript and six focused mocked report/parser checks passed; plugin rebuilt. Public pio_test, target/lease integration and real native/hardware report acceptance remain pending. No publication performed.


Canonical report integration initially failed TypeScript because the entry point lacked the error-class import. Added the import; TypeScript then passed and the plugin was rebuilt with the correction.


### Test report source-format verification

Read PlatformIO Core 6.1.16 test result and JSON serializer source, recording immutable commit/blob identities in platformio-test-report-source.json. Found and corrected valid WARNED cases previously rejected by the parser; warned cases remain distinct and an additional warned count prevents downstream consumers from assuming every nonfailed/nonskipped case passed. Aggregate totals include these cases in upstream source. TypeScript and seven focused report/lifecycle checks passed; plugin rebuilt. Source inspection is not native execution evidence, and public test adapter/lease integration remains unfinished.


### Public test result adapter

Added opt-in pio_test using canonical high-risk run_tests authorization with request-bound filters/stage/port selections, global locking, build-only enforcement, private foreground reports and redacted retained output. Reports include per-case failures/source locations, missing-report errors and distinct WARNED counts rather than counting warnings as passes. Compatibility surface is 82 tools (54 canonical, 28 aliases). TypeScript and 16 focused mocked test/report/execution-mode checks passed; plugin rebuilt. This implementation is not full test acceptance: physical-device target/lease integration, per-connection serial conflicts, exact timeout/no-report diagnostics and native/hardware evidence remain pending. No publication occurred.


### Public test timeout diagnostics

Confirmed test timeouts now retain bounded redacted output and return an explicit test_timeout error with exit -1 and build diagnostics, without inventing report totals. Unconfirmed termination errors propagate with custody metadata, preserving lock/report retention. TypeScript and five focused mocked adapter checks passed; plugin rebuilt. Physical-device lease integration, real test execution and final release acceptance remain pending. No publication occurred.


### Canonical test selections and dashboard access

Added optional suite filters, upload/build stage switches, explicit upload port and verbosity to canonical run_tests and its dashboard command API. Both ordinary and structured foreground calls pass options to the same test runner; existing omitted-option behavior is preserved. Dashboard launcher exposes include/exclude patterns and compile-only mode. TypeScript, eleven focused mocked execution/schema checks and frontend production build passed; plugin rebuilt. Per-device lease coordination and native/background report acceptance remain pending; no publication occurred.


### CLI build-family coverage

Added clean/check/test command registration, help, canonical operation mapping and validated option forwarding through shared locks/executors. Structured foreground reports and compile-only safeguards are available from CLI without enabling compatibility names. Failures reported by completed commands set exit code 1. Initial targeted checks exposed missing known-command registration; corrected it before final verification. TypeScript and three specifically selected CLI permission-denial checks passed (other cases intentionally not run); plugin rebuilt. No native PlatformIO or hardware commands were executed. Device custody and final-release acceptance remain pending.


### Schema compatibility comparison correction

The contract comparator now treats properties and definition dictionaries as name-to-schema maps, allowing new optional inputs named after schema keywords (such as pattern). Existing property schemas and required fields remain protected. Three focused checks passed: all 42 pinned input contracts, additive keyword-named properties, and rejection of new restrictions. Five unrelated cases were skipped. CI run 35490494177 was confirmed completed with failure before this correction; no final-revision green CI or complete parity is claimed.


### Shared execution startup custody

Completion tracking is attached immediately after child creation, before asynchronous PID/command registration. Pre-spawn failure closes the output descriptor. PID-registration failure cancels through the same bounded waiter; confirmed exit releases custody, while uncertain termination preserves it and reports the child PID and log path. Focused ownership/spooler checks: 13 passed; TypeScript passed. Plugin runtime rebuilt. This closes a startup failure gap but does not establish process-tree containment, shared physical device leases, or hardware acceptance.


### Named-target execution prerequisites

The existing buildTarget engine now accepts explicit uploadPort, bounded timeoutMs and completed-log observation without changing existing call defaults or result behavior. Invalid target/control inputs fail before execution. PlatformIOError codes and cleanupPending context survive target failure, allowing callers to retain uncertain hardware custody. TypeScript and nine mocked target-execution checks passed; plugin runtime rebuilt. PAR-35 remains incomplete: public canonical/compatibility routing, effect-based authorization, owned-session handling and shared physical-device leases must be integrated before exposure. No hardware target was executed.


### Named-target effect authorization

Added the planned target-effects service: exact known targets map to build, cleanup, firmware upload, filesystem upload or erase permissions; unknown/composed names require privileged host-code permission. The shared dispatcher binds the actual target into request arguments and respects concrete/category denials. Restricted read_only/build_only/monitor_only profiles now explicitly deny erase_flash and run_shell_command instead of permitting an approval escalation. TypeScript and 35 focused target/profile/engine checks passed; plugin runtime rebuilt. This authorization service is internal; PAR-35 public routing and physical custody/artifact/session integration remain incomplete.


### Upload destination and custody correction

Both firmware and filesystem uploads previously selected a port for locks/reporting but omitted --upload-port from the actual command. They now pass that same selected destination explicitly, including the existing device-resolution path. Typed PlatformIO errors now survive both wrappers, preserving cleanupPending and retained log evidence. TypeScript and nine focused mocked upload checks passed; plugin runtime rebuilt. Shared device leases, owned monitor handling, immutable artifact binding and physical upload evidence remain incomplete.


### Upload spooler joins shared endpoint custody

Spooling operations with an active serial port now acquire the same canonical endpoint lease as direct serial sessions before spawning. Pending-child custody is persisted before launch and is not automatically recovered after coordinator death. Confirmed cleanup releases the lease; uncertain cleanup retains it. Local log descriptors/watchers now close even if persistent cleanup fails, and background cleanup errors are recorded instead of becoming unhandled rejections. TypeScript and 14 focused isolated lease/spooler checks passed; no device was opened. Plugin runtime rebuilt. This covers endpoint aliases during upload execution, not stable USB identity across re-enumeration, descendant containment, legacy monitor handoff or hardware acceptance. Those remain required.


### Post-upload monitor identity correction

Removed both first-device fallbacks after firmware/filesystem upload. Reconnect now requires exact VID:PID and nonempty SER tokens, rejects duplicate descriptors, and ignores transient location changes. This intentionally stops auto-monitoring devices lacking usable identity rather than silently attaching another board; explicit monitor selection remains available. TypeScript and 19 focused mocked discovery/upload checks passed. Plugin rebuilt. Full re-enumeration lease handoff and real device acceptance remain unproven.


### Retained ELF provenance and current CI

Analysis snapshots now publish a hash-verified content-addressed ELF copy and expose its archivePath in report identity. Concurrent publication reuses only a verified object; corrupted existing objects are never overwritten. Two new cases exercise rebuild retention, concurrent reuse and corruption rejection; 15 focused ELF/report checks passed and TypeScript passed. Complete CI run 35491602875 passed at source 3d70d44058c54a84a78ac4e87bb387000158e3e4, before this archive change. The connected MCP device inventory returned no serial devices; hardware-availability.json records this as availability evidence, not PR-runtime acceptance. Full upload-image/offset manifests and physical acceptance remain incomplete.


### Archived ELF selection

Canonical decode_backtrace and its CLI now accept archivedElfSha256/--archived-elf-sha256. Retained history is indexed by the canonical original ELF source path; lookup verifies hash and regular-file identity and cannot retrieve another source's archive by hash alone. The request-bound analysis grant includes this selection. A handler regression changes the current firmware and confirms the decoder receives the earlier retained bytes and keeps the same archivePath. TypeScript and 26 focused handler/ELF/report checks passed. Current metadata/toolchain discovery is still required; historical toolchain manifests, source-path deletion/movement recovery, read-only explicit-ELF operation, and flashed-image identity remain incomplete.


### Compatibility archive selection

The pio_decode_backtrace adapter now accepts archived_elf_sha256, maps it into the canonical request-bound analysis call, and returns elf_archive_path. Malformed hashes fail before configuration inspection or owned-session reads. TypeScript and four focused adapter checks passed. This is an additive extension; all pinned decoder parameters remain supported.

### Debugger protocol foundation

Added the bounded GDB/MI parser/framer required by PAR-06 through PAR-09, using the official GDB/MI output grammar. It preserves exact decimal command tokens, ordered duplicate fields, nested tuples/lists, console/target/log streams and asynchronous state notifications. UTF-8 pipe fragmentation and CR/LF boundaries are handled without treating prompts or async events as command completion. Per-record, nesting, node and chunk limits reject malformed or unbounded input. TypeScript and 14 focused protocol cases passed; no debugger/probe ran. Session command correlation, classified debugger commands, controlled initialization, probe custody, canonical/compatibility adapters and physical acceptance remain incomplete. Source: https://sourceware.org/gdb/current/onlinedocs/gdb.html/GDB_002fMI-Output-Syntax.html


### Debugger command lifecycle

Added token-correlated MI command tracking over the bounded parser. Only the matching result completes a command; execution requests can wait for a stop event, and timeouts free the request slot without declaring target/process termination or releasing a probe. Late responses cannot complete the next request. Console capture is byte-bounded without splitting UTF-8 characters. Pipe/protocol faults poison the transport and retain cleanup uncertainty until confirmed exit. TypeScript and 14 focused transport cases passed. This internal transport does not authorize commands or start GDB; command-effect policy, safe startup, probe ownership, public adapters and native debugger acceptance remain outstanding.

### Archive path CI repair and debugger command permissions

CI 35492644888 and 35492643651 failed on Windows/macOS because lookup returned an unresolved archive ancestor while retention returned its canonical real path. Lookup now resolves that same directory before returning the validated ELF. A directory-alias regression reproduces this independently of runner temporary-directory spelling. Debugger commands now have a bounded explicit vocabulary mapped to inspection, target mutation or privileged host-code authorization; unknown expressions, function calls and unclassified raw MI fail before transport. Real read_only profile tests reject target/host commands and honor concrete inspection denial. These are internal prerequisites: debugger startup, probe custody and public tool integration remain incomplete.

### Controlled debugger initialization

Added fixed GDB startup arguments (-nx, MI2 and pre-file auto-load/function-call restrictions) plus acknowledged MI setup before loading the selected ELF. One total deadline bounds setup; unsupported settings, exit or timeout invalidate the transport and retain cleanup uncertainty. Initialization cannot be retried on that process. Twenty-two focused initialization/transport checks and TypeScript passed. These checks use the real MI transport with synthetic replies, not a native GDB/probe: startup owner integration and malicious-file/native acceptance remain pending. CI 35493085137 at 04c5f6e9 has passed macOS/Linux unit gates and dependency audit; Windows and downstream gates were still running when observed. Official startup semantics: https://sourceware.org/gdb/current/onlinedocs/gdb.html/Initialization-Files.html and https://sourceware.org/gdb/current/onlinedocs/gdb.html/Auto_002dloading.html

### Owned debugger process integration

DebugProcess now connects fixed startup arguments, acknowledged initialization, MI pipes, per-command effect authorization and bounded process-only cleanup. Stderr is bounded separately from MI. Kill requests never release custody: direct close plus a trusted bounded descendant/probe-release confirmation are both required; uncertain cleanup remains retryable. Startup and pipe failures initiate cleanup. Six focused synthetic-process regressions and TypeScript passed, including denied commands, startup rejection, descendant uncertainty and unconfirmed kill escalation. This is an internal owner: trusted PlatformIO/probe discovery, actual descendant containment, public sessions/adapters and real native/hardware acceptance remain outstanding. CI 35493085137 completed successfully for 04c5f6e938e8c542ffbf0ea6c18397e109d09772 across all ten jobs, before the subsequent debugger initialization/owner commits.

### Exact debugger discovery and launch trust

Pinned PlatformIO Core v6.1.16 debug/config/base.py selects client_executable_path from gdb_path, including separate debugger packages. Added selected-environment debugger metadata parsing without compiler-adjacent/PATH fallback, and realpath-based validation against trusted host installation roots. DebugProcess now launches the validated executable and releases unused custody on pre-spawn validation failure. Project/ancestor roots, directory aliases escaping into the project and non-GDB executables are rejected. Four discovery and seven owner regressions passed; TypeScript passed. Automatic trusted package-root discovery, PlatformIO debug-server configuration, probe identity/containment and public adapter integration remain incomplete. Source: https://github.com/platformio/platformio-core/blob/v6.1.16/platformio/debug/config/base.py

### Registered debugger package discovery and release authentication

Debugger startup now discovers the selected GDB's registered toolchain or standalone tool-*-gdb package under the host-reported Core packages directory. Package type/name/version must match bounded package.json and .piopm records, followed by canonical executable/root validation. Custom installation roots use the trusted launch environment PIO_MCP_DEBUGGER_ROOTS; malformed explicit configuration never falls back. Seven discovery checks passed. Public debugger/probe integration remains incomplete. A fresh npm whoami returned E401 and GitHub release-environment listing was empty; the user identified forkbomb in Chrome. Chrome is unavailable to the current browser connector, so an official npm CLI browser login was started and handed to the user; authentication/publication success is not yet established.

### npm publisher authenticated; Windows debugger fixture correction

Official npm browser login completed successfully. Fresh npm whoami returned forkbomb and npm access list packages forkbomb returned read-write for platformio-mcp, pio-mcp and pio-agent. No package was published. CI 35493595856 failed two Windows debugger fixtures because Node's synchronous realpath returned an 8.3 spelling while the production asynchronous realpath returned the long spelling. Fixtures now compare using the same asynchronous filesystem identity operation, preserving exact path/trust assertions. New package-root fixtures use the same correction.

### Named-target workflow integration

Added executeNamedTarget with strict inputs, exact effect authorization, revision checks, shared execution lock, caller-owned monitor refusal/optional cleanup, completed-log reports and timeout/custody preservation. Explicit serial destinations join shared endpoint custody through buildTarget/spooler. The new devicePort custody option does not remove a legacy semaphore it did not claim. Six workflow, nine target-execution and eleven spooler-custody checks passed; TypeScript passed. This service is not yet public: implicit/configured device selection, network/probe targets, immutable upload artifacts, port-diagnosis results, canonical/compatibility registration and hardware acceptance remain outstanding. An omitted physical destination currently returns TARGET_PORT_REQUIRED after authorization, so full reference parity is not claimed.

### Named-target serial selection

The target service now preflights effect policy, resolves omitted serial destinations through separately authorized project configuration/device discovery, and binds the selected environment/port to final execution authorization. It uses the configured upload port or one likely board and rejects ambiguous/missing candidates rather than selecting the first device. Nine focused workflow/selection checks and TypeScript passed. Network/glob/probe destinations, immutable artifact binding, public registration and complete reference error presentation remain unfinished; PAR-35 is not complete.

### Scoped target cleanup acceptance

Extended workflow regression coverage through the real policy/approval service with isolated operator storage outside each test project. An approved filesystem target refuses a held monitor by default; stop_open_sessions closes only the supplied owner capability's session; cleanupPending prevents buildTarget; confirmed closure forwards the same selected port into argv and endpoint custody. Twelve focused workflow checks passed. This is synthetic transport acceptance, not physical-device or public-MCP parity.

### Public named-target routes

Registered run_target and optional pio_run_target using the same executor. Canonical inputs map to the reference spelling without a second implementation. Target effect policy chains now honor public-name denials as well as effect/category denials. Thirty-six workflow/effect checks and one focused real-stdio named-target denial check passed; no PlatformIO operation executed. Canonical inventory is 55 tools, with 29 optional aliases (84 total). The attempted alias test-name filter matched no cases, so it supplies no additional validation evidence. Public exposure does not close PAR-35: network/probe targets, artifact binding, diagnostic presentation and native/hardware acceptance remain required.

### Named-target CLI and compatibility launch verification

Added CLI run-target with strict flags and canonical executor mapping, without a second execution path or broad preauthorization. The focused real CLI denial check passed and TypeScript passed. All four compatibility launch cases passed, establishing 55 canonical tools / 84 enabled tools and opt-in pio_run_target registration. Complete CI 35494348961 passed for the preceding pushed revision, before public route/CLI additions. Full target/hardware parity remains incomplete.

### Target port-failure reporting

Failed device targets now expose the classified port error and an actionable diagnosis while preserving exit code, log path and output. Host port observations require separate list_devices permission; denied/unavailable diagnosis leaves the original execution failure intact and unknown presence remains null. Fifteen focused workflow checks plus the new full-executor failed-upload/diagnostic-failure regression passed; TypeScript passed. No hardware ran. Full network/probe/artifact and physical parity remains unfinished.

### Firmware upload compatibility and registry inventories

Registered pio_upload as a strict fixed-upload adapter over the shared target executor, preserving the existing canonical upload_firmware tool. Two focused cases verified target injection rejection and upload-policy denial before session effects; TypeScript passed. Canonical inventory remains 55; compatibility inventory becomes 85 (30 optional aliases). CI 35494668456 exposed stale 54-tool fixtures, an omitted run_target registry fixture and missing plugin skill coverage; those inventories now include the new canonical tool. Network/probe destinations, complete artifact binding and physical acceptance remain outstanding.

### System information compatibility

Added pio_system_info through canonical system, policy and owned-session permissions. Missing Core and absent metadata are explicit. Focused permission/report regressions and TypeScript validation passed. Corrected the named-target denial fixture to use the supported overrides schema. The prior pushed revision passed CI. npm publisher forkbomb is authenticated with read-write access to platformio-mcp, pio-mcp and pio-agent; no packages were published. Full parity and release acceptance remain incomplete.

### Offline ESP partition parsing

Added bounded CSV/binary partition parsing with an explicitly supplied table offset, typed numeric records, MD5 verification, erased terminators, overlap/overflow/alignment checks, OTA metadata constraints and writable core-dump enforcement. Format cross-checked against https://raw.githubusercontent.com/espressif/esp-idf/v5.3.2/components/partition_table/gen_esp32part.py. Twenty-six focused parser cases and TypeScript validation passed without executing PlatformIO or hardware. This internal module is not yet registered as a public capability: effective project/framework layout resolution, comparison/reporting, permission-controlled device reads and physical acceptance remain outstanding. This is implementation progress, not PAR completion.

### Offline partition reports and artifact identities

Added deterministic layout comparison including flag changes, capacity/OTA/NVS/core-dump findings, per-application firmware fit and explicit unknown sizes. Offline artifact inspection uses bounded regular-file reads inside the granted workspace, detects observed replacement/mutation, validates UTF-8 and records SHA-256 identities for table, firmware and comparison bytes. Comparison copies are labelled offline rather than live device evidence. Thirteen report and four artifact regressions passed, plus TypeScript validation. These internal building blocks still require canonical/CLI/compatibility dispatch, effective project layout resolution and authorized device reads; no full partition acceptance is claimed.

### Public offline partition inspection

Connected bounded artifact inspection to canonical partition_table and partition-table CLI with strict arguments, shared get_project_config authorization, concrete action denials and policy revision checks. Supplied comparison mismatches make the public result unsuccessful. Updated tool inventories and plugin coverage. Nineteen focused registry/manifest checks, three permission cases and TypeScript validation passed. The source now exposes 56 canonical tools and 31 optional aliases; pio_partition_table is deliberately not advertised until its project resolution and device-read contract exists. Full PAR acceptance remains incomplete.

### Partition location evidence

Computed environment reports now preserve board_build.partitions, board_upload.partition_table_offset, board_upload.flash_size and board_build.mcu. Added bounded sdkconfig offset extraction, exact normalized flash-image path matching and generation/upload conflict rejection. Verified the upload override and SDK setting against the official PlatformIO platform-espressif32 v6.9.0 ESP-IDF builder (https://github.com/platformio/platform-espressif32/blob/v6.9.0/builder/frameworks/espidf.py). Nineteen focused location/project-inspection checks and TypeScript passed. The new resolution helpers still need orchestration into automatic project partition inspection; explicit offline inspection remains functional.

### SDK configuration integration

Connected existing sdkconfig offset extraction to canonical partition_table and CLI under the same artifact permission boundary. Explicit offset remains supported, conflicting inputs fail before table access, absent evidence stays unknown, and configuration bytes are identified by SHA-256. Six focused permission/offset cases and TypeScript passed. Automatic environment/framework discovery and device operations remain unfinished.

### Configured project partition workflow

Public partition inspection now resolves configured environment CSV paths, upload offsets and flash sizes through authorized Core configuration inspection. Explicit/default environment selection rejects ambiguity; explicit offline paths retain their existing behavior. Eight focused workflow cases and TypeScript validation passed without PlatformIO execution. Framework package defaults, generated layout evidence, live reads and reference adapter completion remain outstanding.

### Authorized build-derived partition identity

Added opt-in buildMetadata resolution through project_metadata, preserving its build permission before Core execution. Matches selected environment flash-image evidence, rejects ambiguous binaries and combines metadata offsets with configuration/explicit evidence. MCP safety annotations now reflect optional project script execution. Eleven focused metadata/workflow tests and TypeScript passed. CI run 35496158937 for prior commit 52f26758 remained live at inspection; this change is saved locally to avoid cancelling it. Metadata generation does not certify binary freshness; device reads and full reference acceptance remain pending.

### Partition CI and provenance fixes

CI run 35496158937 completed with a stale 55-tool assertion in mcp-authorization.test.ts (current inventory is 56); corrected it without weakening pinned legacy contract validation. Corrected metadata-selected binary provenance to metadata:extra.flash_images and added a complete executor regression. Eighteen focused MCP/partition cases and TypeScript passed. Both prior CI runs are terminal, so the saved metadata change and fixes can now be pushed together.

### Serial partition reads

Implemented bounded readEspFlash using shared spooling/process custody, an explicit serial port/range, separate device and host-package-command permissions, exact output-length validation and completed staging cleanup. Connected readDevice/port and scoped approvals to MCP and CLI; device partitions are decoded, hashed and compared with the inspected layout. Worst-case MCP annotations now reflect hardware effects. Thirteen targeted authorization/executor/workflow cases and TypeScript passed with hardware mocked. Physical reset/read behavior, installed esptool version compatibility and descendant containment remain acceptance gaps. CI runs 35496366805 and 35496364780 were still live; saved locally to preserve those runs.

### Flash-read grant and installation review

CI 35496366805 passed for 49da3211. Reviewed official Core v6.1.16 package/commands/exec.py: --package installs missing packages, so removed that selector to use installed-executable discovery only. Added two-stage readiness checks before grant consumption and kept transport grant IDs outside concrete operation payloads. A real scoped-approval regression proves the first approval survives waiting for the second; fourteen focused cases and TypeScript passed. Serial implementation plus these fixes are now ready to push; no physical execution or publication occurred.

### Structured partition mismatch findings

Device-erased and device-mismatch observations now add structured error issues/counts, and explicit CSV inspection with build metadata automatically compares the selected built binary. Added mocked device-report and full workflow regressions; three device cases and eleven workflow cases passed. CI 35496714588 exposed unused destructured values under ESLint; corrected variable use without changing lint policy. Targeted lint across all new partition/flash modules and TypeScript passed. Physical acceptance remains outstanding.

### Existing ESP-IDF configuration discovery

Added automatic discovery of sdkconfig.<environment> and the configured board_build.esp-idf.sdkconfig_path override, verified against platform-espressif32 v6.9.0 builder/frameworks/espidf.py. Explicit missing paths do not fall back; absent conventional files leave offset evidence unresolved. Twenty-five focused workflow/project cases, targeted lint and TypeScript passed. Framework package CSV selection and physical acceptance remain incomplete.

### Registered framework CSV integration

Added framework candidates from the complete selected build include inventory (independent of display truncation), registered host-package validation, bounded CSV reads and canonical workflow integration. Configured project files take precedence; external framework files require matching package manifest/registration under the host Core packages directory and separate system-info authorization. Framework CSVs automatically compare with the metadata-selected built binary. Five package-boundary cases and twelve project-inspection cases passed; the fourteen-case workflow suite passed after fixing its new comparison-source provenance assertion. Targeted lint and TypeScript passed. CI 35496859998 passed at ce2b2620. Framework default-table inference, physical acceptance and remaining parity remain unfinished.

### Partition compatibility adapter

Registered pio_partition_table over the shared canonical workflow, preserving reference project/env/read_device/port names and default false device access. Adapter metadata discovery retains build permission; offline override and scoped grants are explicit extensions. Omitted serial destinations use authorized config/unique-port selection. Built-only layouts explicitly omit CSV identity instead of fabricating it. Added existing firmware.bin discovery beside selected build partitions. Sixteen focused adapter/workflow cases, targeted lint and TypeScript passed. Compatibility tool inventory is 88 (56 canonical plus 32 aliases); registration is not full reference acceptance. CI 35497188383/35497184861 remained live, so this change is saved locally.
