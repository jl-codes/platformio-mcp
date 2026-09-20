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

### Board capacity and firmware fit evidence

Added separately authorized optional catalogue fallback for absent flash size/MCU, preserving explicit/project precedence and unknown states on denial/failure. Corrected compatibility flash-size provenance to use the canonical source. Eighteen focused adapter/workflow tests passed, including catalogue denial and existing firmware.bin discovery; targeted lint and TypeScript passed. CI 35497188383 passed at a5dee8ce. The saved compatibility adapter and catalogue change can now be pushed together; full physical/reference acceptance remains incomplete.

### Core-dump input and report foundations

Added bounded raw framing for supported v0.2/v0.3 and v1.0-v1.3 envelopes, CRC32/SHA-256 validation, exact declared-length trimming, input/content identities and strict base64 decoding. Encrypted, erased, unsupported and corrupted inputs produce distinct errors. Definitions checked against https://github.com/espressif/esp-coredump/blob/v1.10.0/esp_coredump/corefile/loader.py. Added bounded current-thread analyzer report projection with common-secret redaction and explicit truncation. Ten focused cases use Python zlib/hashlib-generated checksum fixtures and synthetic reports; lint and TypeScript passed. No analyzer or hardware executed. Legacy v0.1/direct ELF input, analyzer packaging/execution, immutable matching ELF, private retention, public integration and physical acceptance remain unfinished; this is not PAR completion.

### Cross-platform firmware discovery correction

CI 35497560904 and 35497559003 exposed lexical versus canonical path mismatches on Windows and macOS. Firmware discovery now resolves the existing candidate before enforcing workspace containment, handling Windows short paths and symlinked temporary directories while rejecting outside targets. The failing focused regression, targeted lint and TypeScript passed locally. Full CI remains required on the corrected commit; no physical acceptance or publication is claimed.


### Offline core-dump artifact loading

Added bounded workspace-contained raw/base64 input loading, strict UTF-8 decoding, optional exact source-file SHA-256 enforcement and separate source/envelope identities. Four focused cases passed; targeted lint passed and TypeScript passed after correcting a Buffer generic inference mismatch. No analyzer execution, private retention, ELF correspondence or public-tool acceptance is claimed by this internal loader.


### Embedded core-dump firmware identity

Offline ELF-envelope loading now validates ELF32 core headers, chip/machine agreement, bounded program headers and note segments, then extracts the unique ESP_CORE_DUMP_INFO firmware SHA-256 prefix. Matching distinguishes full hash, partial prefix and absent evidence; mismatches fail. Format checked against Espressif esp-coredump v1.10.0 corefile/elf.py and corefile/loader.py. Fifteen focused artifact/identity cases, lint and TypeScript passed. Analyzer execution, complete immutable ELF binding, sensitive-data retention and public integration remain outstanding.


### Stable core-dump analysis inputs

Added workspace-contained ELF selection, chip/ELF target checks, embedded hash correspondence and hash-verified ELF snapshots with permission revalidation around analysis. Dump bytes remain in memory; no raw dump is archived by this helper. Four focused cases passed for rebuild stability, wrong-target rejection, failure cleanup and revoked permission; lint and TypeScript passed. Both CI runs 35497993818 and 35497991890 passed at 48b5ef47. Optional analyzer execution, private staging/retention and public integration remain incomplete.


### Pinned offline core conversion bridge

Added a fixed Python program using esp-coredump==1.10.0 FileLoader only, with file/size checks, staging-confined intermediates and typed redacted errors. The bridge does not start GDB, select hardware or install dependencies. Added the explicit coredump Python extra. Two isolated Python bridge cases passed using a fake converter for version rejection and temporary output cleanup; lint and TypeScript passed. Real optional-package conversion, staging permissions, bounded process ownership, controlled debugger execution and public integration remain outstanding.


### Private sensitive-analysis staging

Added owner-only temporary directories before any sensitive writes: POSIX mode/owner checks and protected Windows ACLs granting only the current SID. Windows verification exposed an inherited PowerShell module-loading failure; the helper now uses .NET ACL APIs directly. The real Windows permissions/failure-cleanup regression, lint and TypeScript passed. Callers must terminate all consumers before returning. Converter integration, host matrix verification and sensitive retention policy remain incomplete.


### Private bounded core conversion integration

Connected the pinned converter program to owner-only staging, isolated Python invocation, a 60-second deadline, 64 KiB output bound, structured known errors and workspace-contained core ELF validation. Raw input hashes are rechecked before staging; files are removed after the consumer returns or fails. Nine focused process/orchestration cases passed; lint and TypeScript passed. Process tests use real Node children and conversion orchestration substitutes the optional converter; actual esp-coredump and debugger acceptance remain outstanding. CI 35498314271 and 35498312360 passed at 3513e535.


### Real pinned converter validation

Ran the actual esp-coredump 1.10.0 file converter on official v1.10.0 ESP32, ESP32-C3 and ESP32-P4 base64/ELF fixtures from tests/ and tests/test_apps/built_apps/. All three converted successfully through private staging on Windows/Python 3.14.4. Exact input, ELF and output hashes are recorded in esp-coredump-conversion-results.json; fixture files are not redistributed. Each fixture embeds a 36-bit ELF hash prefix, accurately reported as partial correspondence. Real validation exposed independently padded base64 lines (now supported with strict per-line decoding) and missing distutils on modern Python (fixed by adding setuptools==84.0.0 to the optional extra). Eight focused decoding regressions passed. This proves file conversion on one host, not physical hardware, debugger reports, all dump formats or public-tool acceptance.


### Real offline GDB crash report

Added trusted-root debugger resolution and a fixed fail-fast command file disabling auto-load, target function calls and automatic shared-library loading before loading the stable ELF and converted core. DEBUGINFOD_URLS is cleared for offline symbol lookup. GDB command-file fail-fast behavior was checked against https://sourceware.org/gdb/current/onlinedocs/gdb.html/Command-Files.html. Real installed RISC-V GDB validation on the official C3 fixture returned five backtrace frames and 32 registers; reason remains null and stderr presence is disclosed. Compatibility fixes handle absent debuginfod commands in older GDB and its core-file filename parsing. Results recorded in esp-coredump-debugger-result.json. Lint and TypeScript passed; physical acceptance, complete reference report projection, public integration and broader debugger versions remain unfinished.


### Core-dump shared authorization handler

Added explicit server-environment Python/GDB selection, rejecting project-owned Python and reusing trusted debugger root validation. Added strict offline requests with separate artifact-read and critical host-execution preflights before grant consumption. Read-only inspection returns identities, never raw dump bytes. Three host-selection and three real policy cases passed after correcting the test enrollment store to sit outside its project; lint and TypeScript passed. The handler remains internal pending MCP/CLI registration; device acquisition and reference adapter remain unfinished.


### Public offline core-dump registration

Registered coredump in MCP and CLI with strict artifact arguments, staged permissions and host-only executable configuration. Added conservative action annotations, plugin coverage and usage instructions; rebuilt the plugin runtime. Canonical inventory is 57 and compatibility-enabled inventory is 89. Twenty-two focused policy/registry/manifest checks passed; TypeScript and targeted lint passed (existing index any warnings remain). Device acquisition and the reference pio_coredump adapter remain unfinished.


### Private bounded core partition acquisition

Added a core-dump partition reader reusing existing flash-read approvals, endpoint ownership and exact-byte checks. Invalid, oversized or encrypted selections fail before device access; erased partitions return an explicit absent-crash result. Shared flash reads now establish owner-only Windows ACL/POSIX staging before writing bytes and retain their existing uncertain-process cleanup behavior. Ten focused selection/flash-policy/private-storage cases passed with mocked hardware; lint and TypeScript passed. Actual hardware and effective-table/public adapter integration remain outstanding.


### Effective-table core acquisition

Connected core reads to the authorized partition workflow, retaining exact table source hash, offset and environment evidence. Invalid/mismatching layouts, missing crash storage, ambiguous selections and unknown flags fail before the core read; explicit partition names disambiguate multiple entries. Three real offline parser/policy cases with mocked device acquisition passed after adding the required application partition to valid fixture layouts; lint and TypeScript passed. No live-device layout identity or physical acquisition acceptance is claimed; public acquisition/reference adapter integration remains outstanding.


### Core-dump public permission inheritance

Corrected coredump_inspect to inherit the public coredump policy identity before get_project_config, preserving explicit denials on all three names. Eighteen focused policy/dispatcher cases passed and TypeScript passed. Refreshed the bundled plugin runtime for current permission and private flash-read behavior. CI on 18cb94a1 remains separately tracked; no publication or hardware acceptance is claimed.



### Captured-byte analysis transport

Unified decoded-file and device-capture envelope/firmware-note validation. Internal captures can now use the same stable ELF and private converter/GDB report path without creating a dump file in the project. Full partition input identity is preserved separately from trimmed dump identity; capture sources have null file paths. Fifteen focused analysis/artifact/acquisition cases passed, including absent workspace dump files and mismatching capture identities; lint and TypeScript passed. Plugin runtime refreshed. Public device adapter and physical acquisition acceptance remain unfinished.


### MCP device core acquisition integration

MCP coredump now selects exactly one offline dump or explicit device/table acquisition. The shared handler validates same-project table scope, preserves nested grant-independent parent request identity, resolves analysis tools before capture, keeps raw bytes internal and returns explicit empty-crash results. Ten focused real policy/partition checks passed; TypeScript and targeted lint passed with existing index warnings. Plugin runtime refreshed. CLI device options, reference adapter, output retention and physical acceptance remain incomplete.


### CLI device core acquisition

Added explicit port/partition/table selection, integer/boolean validation and separate read/table/analysis grants to the coredump CLI. Device-only options without a port are rejected rather than silently ignored; no-crash results set an unsuccessful exit status. TypeScript and lint passed. An actual CLI invocation returned COREDUMP_INPUT_INVALID before hardware access for missing-port input. Reference pio_coredump adapter, retained output and physical acceptance remain outstanding.


### Explicit private dump export foundation

Added bounded exact-byte export into an existing authorized workspace directory, using private same-volume staging and exclusive hard-link publication. Existing destinations are never replaced; outside-workspace paths and alternate-stream names are rejected. Explicit exports have user-managed retention, distinct from temporary analysis data. Four real filesystem/privacy cases passed, including preservation of an existing destination; lint and TypeScript passed. Managed default retention, public export grants and the reference out_path adapter remain unfinished.


### Authorized public dump export

Integrated explicit outPath/exportApprovalId into device MCP/CLI requests. Export permission is preflighted before device access, captures preserve erased bytes internally, and empty results retain their failure status while returning only export metadata. Seventeen focused cases passed across export policy, core policy, effective-table selection and read selection (the export fixture required an explicit read-category allow). Lint and TypeScript passed; plugin runtime refreshed. Default managed retention and reference adapter remain incomplete.


### Export identity ordering

Moved captured-partition expected hash verification ahead of any export, including erased partitions. A mismatch now leaves the destination absent instead of exporting before later analysis detects it. Three focused public export cases, lint and TypeScript passed. Both CI runs 35499752243 and 35499749555 passed at 738779d9. Runtime rebuilt for the corrected export path; the newer acquisition/export commits require CI at their own head.


### Managed dump retention foundation

Added private managed storage with a maximum of 32 objects at 16 MiB each, serialized across processes using the existing lock library. Entries carry a 24-hour expiry, checked during access and by a live-process expiry timer; stopped servers cannot physically delete files until cleanup runs again. Corrupt records fail closed; unrelated store files are not pruned. Three real filesystem cases passed for exact bytes/expiry, quota and unrelated-file preservation; lint and TypeScript passed. Startup/access integration and default reference-adapter retention remain incomplete.


### Public managed retention integration

Added retainDump to MCP and CLI with mutual exclusion against explicit outPath, device-only validation, and the same export preflight as explicit saving. Thirteen existing policy/storage cases passed, then the expanded four-case export-policy suite confirmed both save modes deny before acquisition. TypeScript and lint passed; runtime rebuilt. The reference adapter and startup cleanup wiring remain unfinished; live retention expiry is not claimed while the server is stopped.


### Retention restart lifecycle

MCP startup now sweeps expired managed dumps and runs non-overlapping minute sweeps while active, with a coordinated shutdown hook. Cleanup failures emit bounded diagnostic codes and are retried by subsequent sweeps; absent stores are not created by startup cleanup. Five focused filesystem/lifecycle cases, lint and TypeScript passed; runtime rebuilt. The reference adapter and remaining full-parity acceptance are still unfinished.


### Capture preservation without optional analysis tools

Authorized device captures are now exported before optional analyzer resolution. A saved, validated capture returns analyzed=false and COREDUMP_TOOLS_UNCONFIGURED when host analysis tools are unconfigured; invalid tool trust and other errors still propagate. Unsaved captures do not silently downgrade analysis requests. Seven focused export-policy cases, TypeScript and lint passed; no hardware acceptance or completed reference adapter is claimed.

### Reference core-dump adapter implementation

Added the internal reference workflow with launch/project defaults, authorized environment/port selection (honoring explicit ports), separately authorized ELF metadata, default managed retention, explicit output paths, missing-build-output handling and reference result projection. Metadata denials propagate before acquisition. Three focused adapter cases, TypeScript and lint passed. Public compatibility registration and end-to-end adapter acceptance remain pending; the compatibility count remains 32.

### Public core-dump compatibility registration

Registered pio_coredump in opt-in mode with the reference arguments and explicit grant extensions, routing MCP dispatch to the implemented adapter. Inventory is 57 canonical plus 33 aliases. Seven adapter/real-stdio exposure cases passed; an additional targeted real-stdio invocation verified malformed core-dump arguments reach compatibility validation. TypeScript and lint passed. Physical capture and full result-contract acceptance remain unproven.

Dispatch-check correction: the initial name filter selected no cases. Running the full focused file exposed untyped Zod failures from the new adapter. The adapter now emits COMPAT_ARGUMENT_INVALID before configuration/device work. All seven adapter/MCP cases and TypeScript passed after this fix.

### Debugger connection ownership

Added a bounded per-connection debugger session registry. Pending launches count toward capacity; IDs from another connection cannot dispatch commands. Command approvals bind the owned session ID as well as the process project. Disconnect waits for pending launches, coalesces process cleanup and preserves failed cleanup records for retry. Process-only cleanup does not claim target resume/detach. Eleven focused ownership/process cases, TypeScript and lint passed. Public debugger startup/probe discovery and physical acceptance remain incomplete.

### Debugger target attachment and download

Added typed internal attachment to an explicitly selected numeric TCP endpoint after probe/server custody is established by the startup adapter. Connection and optional image download are preflighted and separately authorized, with a shared deadline and policy revision checks. load=false never sends target-download; failed attachment invalidates transport before downloading. Detach is classified as a target mutation. Thirty-nine focused policy/MI/command cases, TypeScript and lint passed. Public startup, managed debug-server/probe custody and physical acceptance remain unfinished.

### Authorized debugger metadata collection

Added selected-environment debugger metadata collection using the existing build-authorized collection path. It selects gdb_path independently of cc_path, rejects missing debugger metadata and rechecks policy revision before delivering collected metadata. No implicit compiler-adjacent debugger selection or package installation is introduced. Twelve focused metadata/capability cases, TypeScript and lint passed. Public debugger startup and persistent ELF/probe lifecycle integration remain incomplete.

### Persistent debugger ELF ownership

Added workspace-contained, hash-verified ELF retention in owner-private storage for persistent sessions. The retained bytes survive project rebuilds. A process wrapper releases the snapshot only after confirmed process/probe cleanup; cleanup failure preserves the artifact for retry. Three real filesystem/lifecycle cases passed on Windows, including outside-workspace rejection and expected-hash mismatch; TypeScript and lint passed. Startup orchestration and physical debugger acceptance remain unfinished.

### Failed debugger startup custody retention

Initialization failures with unconfirmed probe cleanup now carry an internal, non-serialized process capability. The connection registry retains that process under its preallocated session ID and returns bounded cleanup-pending diagnostics, allowing later stop/disconnect retries. Startup factories receive the ID before launch for subsequent authorization binding. Thirteen focused lifecycle/process cases passed, including failed MI initialization followed by successful later probe cleanup; TypeScript and lint passed. Public startup orchestration remains incomplete.

### Prepared debugger startup orchestration

Joined target-effect preflight, host-command authorization, private ELF retention, host-supplied probe custody, controlled GDB launch and target attachment. Confirmed cleanup releases the ELF; unconfirmed startup/attachment cleanup transfers process and artifact ownership to the connection registry. Eight focused orchestration/MI cases passed with mocked launch/artifact acquisition and real policy; TypeScript and lint passed. This internal prepared-start path does not yet provide public probe discovery, stable approval-retry reservations or physical acceptance.

### Stable debugger startup retry identity

Prepared startup hashes its concrete project/environment, executable roots, ELF selection, destination, load mode and timeout independently of approval IDs. Connection-owned reservations preserve the generated session ID only across approval-required retries, expire after 15 minutes, and are removed after success/other failure/disconnect. Pending reservations are bounded to eight; simultaneous duplicate requests are rejected before a second launch. Eleven focused registry/orchestration cases, TypeScript and lint passed. Complete public approval-ledger replay and probe discovery remain to be integrated.

### Real debugger approval replay and image binding

Verified connect/load/host startup approvals against the real approval store and MI transport: preflights leave earlier grants approved, launch occurs only after all required grants are supplied, and execution consumes each once. Prepared startup now requires a selected ELF hash; target-download authorization includes that identity, and retained-ELF creation enforces it. Ten focused startup/target cases, TypeScript and lint passed. Launch and artifact acquisition were mocked in the approval replay case; no physical debugger acceptance is claimed.

### Resolved debugger backend configuration

Reviewed PlatformIO Core v6.1.18 debug/config/base.py, factory.py and generic.py. DebugConfigBase resolves server cwd/executable/arguments and can install a missing backend package during configuration, so discovery cannot be treated as a read-only operation. Source: https://github.com/platformio/platformio-core/blob/v6.1.18/platformio/debug/config/base.py .

Added a bounded parser for the resolved server object, preserving argument boundaries and package-relative executable resolution; null explicitly represents an external backend. Ambiguous PATH-only commands, shell shims, control characters and oversized arguments fail. Parsing grants no executable/probe trust. Eight focused cases, TypeScript and lint passed. Authorized config collection, process-tree containment and public probe startup remain unfinished.

### Physical USB probe selection

Added unique probe selection from trusted USB inventory using vendor/product/serial identity, independent of backend names. Duplicate interfaces at one physical location share an identity; duplicate serials at different locations and ambiguous candidates fail explicitly. Missing serial metadata does not fabricate a stable identity. Four focused selection cases, TypeScript and lint passed. OS inventory collection, serial-less probe support and integration with backend selection/custody remain incomplete. CI runs 35502231269 and 35502233612 were still live on b17f2acb while this change was prepared.

### Debug probe custody integration

Connected trusted physical-probe discovery to DeviceLeaseStore. Selection acquires a probe lease, startup refreshes inventory before persisting child handoff uncertainty, and only confirmed cleanup releases custody. Process launch callers now await potentially asynchronous identity revalidation. Fifteen focused real lease-store/process cases, TypeScript and lint passed; USB inventory and actual debugger launches were not performed. Backend command binding and OS enumeration remain unfinished. Prior CI runs 35502231269 and 35502233612 remain live; this batch is committed locally pending their completion.

### Linux kernel USB probe inventory

Added bounded physical USB discovery from Linux sysfs vendor/product/serial attributes, excluding interface entries and reporting serial-less devices as unidentified. Disappearing devices are omitted; invalid/oversized identities fail. Four kernel-shaped filesystem cases, TypeScript and lint passed on Windows; real Linux host discovery and connected-probe acceptance remain unverified. Windows/macOS enumerators and public discovery authorization are still required.

CI runs 35502231269 and 35502233612 both completed successfully on b17f2acb, including all three host unit/plugin jobs, dependency audit, dashboard and CLI checks. The subsequent probe selection/custody/Linux discovery batch is pushed separately and requires its own CI result.

### Windows Plug and Play USB inventory

Added a fixed, bounded Windows PnP metadata collector and parser. Only physical USB instance records with CM_DEVCAP_UNIQUEID and location metadata become serial-based identities; generated IDs and missing location data are counted as unidentified. Six parser cases, TypeScript and lint passed. A real metadata-only invocation on this Windows host returned windows_pnp, identified=5 and unidentified=3; this does not mean five debug probes were identified or prove hardware operation.

Unique-ID capability basis: https://devblogs.microsoft.com/windows-music-dev/the-importance-of-including-a-unique-iserialnumber-in-your-usb-midi-devices/ . Public permission-gated discovery, backend-specific probe matching and macOS enumeration remain incomplete.

### macOS USB parsing and authorized discovery dispatch

Added bounded macOS system_profiler JSON parsing and a fixed native collector, then joined Windows/Linux/macOS inventory behind debugger_discover inheriting list_devices permission. Six parser/real-policy cases, TypeScript and lint passed. Native macOS discovery remains unverified.

CI 35502553441 failed because the new probe-custody fixture used macOS's symlinked temporary path, which the lease store correctly rejects. The fixture now resolves the temporary root before constructing the lease store, matching existing lease tests. Its three focused cases pass locally; macOS confirmation awaits CI.

### Scoped discovery refresh approval

Added a bounded operation-owned discovery callback allowing exactly two inventory reads for initial selection and pre-spawn refresh. Authority expires when the operation ends, cannot be reused by later requests, and checks policy revisions around each read. Five focused real-policy/approval-store cases, TypeScript and lint passed. This remains an internal integration primitive; it does not complete public debugger startup.

Current completion gap: 33 reference tools are registered. The seven unregistered reference workflows are pio_debug_start, pio_debug_cmd, pio_debug_list, pio_debug_stop, pio_upload_ota, pio_power_profile and pio_flash_and_verify. Registration is not behavioral acceptance; complete hardware/platform/distribution acceptance and actual publication remain outstanding.


### 2026-09-20 — Fresh boot verification capture and Windows CI correction

Added an owned-session boot capture to the existing serial policy service. It validates bounded regex before opening, scopes paged reads to one approval, preserves the opening policy revision, closes on success/failure/revocation, and downgrades a would-be pass when cleanup is unconfirmed. Boot verdicts retain the existing quiet-window and built-in crash checks. Crash evidence overrides a ready marker; lost/truncated evidence cannot pass. Bounded response retention does not erase reset-loop detection. This is an internal capture stage, not completion or registration of `pio_flash_and_verify`: upload composition, pre-upload approval planning, matching immutable firmware evidence, crash decoding and physical acceptance remain.

Verification: 35 focused tests passed across `verification-capture.test.ts` and `serial-session-policy.test.ts`, including delayed crash, one-use approval replay, policy revocation and confirmed mock-port cleanup. Typecheck and changed-file lint passed; bundled plugin rebuilt. No physical device was opened.

Current remote CI at 06457d5c: run 35502805630 passed completely; duplicate run 35502807217 failed only because four sequential CLI process launches shared one five-second test budget on Windows. Split those independent checks into four tests with unchanged assertions and default per-test budgets. Await CI confirmation; no repeated local smoke suite run. Local scoped probe discovery commit 80db9822 is included in this push. No release published and no parity-completion claim.


### 2026-09-20 — Upload and fresh verification composition

Added `executeFlashVerification` as the resolved-input orchestration boundary using the existing upload executor and serial policy service. It validates expressions and plans startup discovery/open/read permissions before upload, leaves open/read grants unconsumed during planning, stops only the requesting connection's selected monitor after upload authorization, skips capture after failed upload, and checks the policy revision between stages. Actual monitor startup must match the preflight request/device identity; replacement USB descriptors are rejected before transport construction. Endpoint-only discovery remains explicitly weaker. Results explicitly say `identity_unverified`; this does not prove which immutable firmware was flashed.

32 focused orchestration and real serial-policy tests passed, including reuse of exact preflight grants after upload and rejection of device replacement. Typecheck/lint passed and the shared plugin runtime was rebuilt. The public reference adapter/registration, crash decode composition, immutable upload manifest/lease handoff, and physical acceptance remain incomplete; no additional public tool is claimed here.

Both prior-head CI runs (35503371353 and 35503369571 at f7f07d38) succeeded, including Windows after splitting the four independent CLI checks. New-head CI remains pending after push. No publishing occurred.


### 2026-09-20 — Public flash-and-verify adapter

Registered opt-in `pio_flash_and_verify` over the shared upload/preflight/fresh-capture workflow, with reference defaults, project/port resolution, separate decoder grants, and best-effort crash decoding that preserves the boot verdict. The composite workflow now has an explicit policy boundary; concrete alias, legacy verifier and upload-category denials all block before flashing. Existing canonical APIs remain registered. Inventory: 57 canonical plus 34 reference tools = 91 with compatibility enabled. Six unregistered reference tools remain: four debugger tools, OTA upload and power profiling.

Focused adapter/project/MCP tests passed (17 before adding the policy boundary). Following that change, ten adapter/MCP tests and six real-policy orchestration tests passed; the latter initially exposed a missing strict-validator entry for the new alias, which was fixed. Typecheck and changed-file lint passed; plugin rebuilt. Both previous-head CI runs 35503654187 and 35503652425 passed on 60ec0bd1. New-head CI and hardware acceptance remain pending. Firmware/image correspondence is explicitly unverified; full custody, immutable manifests, CLI exposure and PAR-12 acceptance are not claimed. No release published.


### 2026-09-20 — OTA target custody and private uploader input

Added an internal bounded IPv4 OTA resolver that pins one numeric address, rejects ambiguous DNS and non-unicast destinations, and uses the same network lease identity for hostname aliases and firmware/filesystem ports on one host. Network resources now participate in the existing cross-process lease store. The uploader process retains that custody until confirmed process/pipe closure, uses the existing owned-process timeout/cancellation helper, bounds output to 1 MiB, and never puts credentials in argv. A constant isolated Python bridge passes credentials via stdin to the installed framework's espota script and redacts exact/JSON/URL-encoded password echoes from returned output.

The framework uploader remains responsible for its version-specific protocol/authentication; no custom reimplementation or ICMP-as-availability assumption was added. The interface was checked against the installed framework uploader and Espressif's upstream espota source (https://github.com/espressif/arduino-esp32/blob/master/tools/espota.py). Public requests cannot currently reach this internal runner. Host-trusted interpreter/script discovery, immutable image selection/build integration, authorized network operations/result projection, the public pio_upload_ota adapter, and physical ESP32/ESP8266 firmware/filesystem acceptance remain outstanding.

14 focused target/lease/process tests passed with synthetic child handles and no network upload. Typecheck and changed-file lint passed; shared lease code's plugin bundle rebuilt. Both previous-head CI runs 35504028881 and 35504027482 passed on de2d075c. Registration remains 57 canonical plus 34 reference tools; no OTA parity or publication claim.


### 2026-09-20 — Immutable OTA input and authorized transfer composition

Added private OTA image snapshots with bounded workspace reads, expected-hash checks, rebuild isolation, tamper verification and idempotent cleanup. Host tool discovery resolves native Python from authorized Core `python_exe` metadata or the host-only override and requires a matching registered Arduino framework manifest/.piopm record outside the workspace. Uploader script hashes and image hashes are checked again inside the private-input Python bridge before running the installed uploader. The official Core v6.1.18 `platformio/system/commands/info.py` confirms the `python_exe` metadata field.

`executePreparedOtaTransfer` now joins these artifacts to the pinned network destination and uploader. It plans both device and host-execution approvals before consuming either, binds grants to exact image/tool identities without storing the password, keeps filesystem upload permissions separate, and retains custody on uncertain cleanup. Runtime health is explicitly unverified. Network custody release is idempotent for the runner/orchestrator cleanup boundary.

10 focused real-filesystem/tool-discovery/process cases passed, followed by 14 transfer-policy/network-lease cases. Typecheck and changed-file lint passed; shared action-catalog bundle rebuilt. Both prior-head CI runs 35504375290 and 35504373228 passed at f9915868. Build/default configuration selection, protocol report projection, public OTA registration, broader framework-layout support and physical OTA acceptance remain incomplete. No device contacted, no publication, and reference registration remains 34/40.


### 2026-09-20 — OTA configuration/build/transfer workflow

Added `executeOtaUpload` to compose authorized computed project configuration, family/port/auth defaults, buildprog/buildfs without upload, host tool discovery, private firmware/filesystem image capture and the separately authorized OTA transfer. `build=false` uses an existing image without invoking build metadata or compilation. Filesystem selection honors board_build.filesystem and otherwise requires one unambiguous candidate; imagePath is available for an explicit custom artifact. The shared execution lock covers build through snapshot/transfer, while network custody remains cross-process. The retained uploader log receives the runner's redacted output, not credentials.

Protocol reports distinguish authentication rejection, missing invitation/callback, interrupted transfer and device rejection; a zero exit status or 100% progress alone cannot pass. Results identify exact uploaded bytes and explicitly leave runtime health unverified. ICMP is not used to block uploads: reachable remains null with an explicit not-probed diagnostic. Additional configured upload flags currently fail explicitly pending supported option mapping; public OTA registration and physical acceptance remain unfinished.

17 focused configuration/report, firmware/filesystem service and transfer-policy cases passed. Typecheck and changed-file lint passed. Both prior-head CI runs 35504748761 and 35504746223 passed at e548e063. These internal additions are not yet reachable from the public server, so no plugin regeneration was required this turn. Registration remains 34/40; no publishing or physical OTA run occurred.


### 2026-09-20 — Public OTA tool, uploader options and native bridge proof

Registered `pio_upload_ota` with reference parameters and scoped extensions. Added typed host interface/callback port/invitation timeout configuration; target/image override flags are rejected. Configured debug flags do not enable credential-bearing option dumps. INFO completion markers are now enabled explicitly, correcting the installed uploader's default WARNING log level. The bridge accepts TCP callbacks and UDP replies only from the pinned peer/UDP endpoint.

27 focused options/adapter, public MCP, policy/transfer, process and service tests passed; typecheck and changed-file lint passed. A native Python 3.14 Windows loopback fixture proved UDP/TCP wrong-peer rejection, dummy-password redaction, INFO completion output and confirmed cleanup. No physical device was contacted. The checked-in fixture, reproduction script and source-hashed evidence are provided. This does not replace ESP32/ESP8266 hardware acceptance.

Both prior-head CI runs 35505106601 and 35505104039 passed at 5bead67c. Public inventory is now 57 canonical plus 35 reference tools = 92 enabled. Five reference tools remain unregistered: four debugger tools and power profiling. Full physical/platform acceptance, alternate OTA framework layouts/options, shared serial/network board identity, remaining flash-verifier artifact proof and publication remain incomplete. No release has been published.


### Authorized debugger detach lifecycle (2026-09-20)

Added detach-and-stop to the connection-owned debugger registry. Detach is dispatched through the existing target-effect authorization with the owned session ID and its separate grant. Only an acknowledged MI done result proceeds to process cleanup; permission denial, timeout, closure or an error retains recovery ownership. Concurrent commands/stops cannot report a process-only stop as successful target detach. Disconnect waits for an outstanding detach and independently retries process cleanup, without requiring target-effect permission. Fourteen focused registry tests and TypeScript passed. This remains an internal composition step: public debugger startup/backend integration and physical probe acceptance are still incomplete.


### Debugger computed configuration (2026-09-20)

Added bounded, read-authorized Core configuration collection and pinned-reference debugger environment selection: explicit environment, first debug default, first default, with all declared environments used when defaults are absent. Unknown and option-like environments, duplicate configuration sections, malformed tool settings, and failed collection are rejected. No build, debugger script, backend or probe operation is authorized by configuration selection. Seven focused cases, TypeScript and lint passed, including concrete get_project_config denial before Core invocation. Backend launch/configuration integration and public debugger tools remain outstanding.


### Core-resolved debugger backend configuration (2026-09-20)

Added an internal resolver using the installed PlatformIO Python API: ProjectConfig validation, PlatformFactory.from_env and DebugConfigFactory.new. This follows the configuration portion of Core v6.1.18 [debug/cli.py](https://github.com/platformio/platformio-core/blob/v6.1.18/platformio/debug/cli.py), with fields checked against [config/base.py](https://github.com/platformio/platformio-core/blob/v6.1.18/platformio/debug/config/base.py). Resolution requires build_project permission because metadata and package hooks may execute project code or install packages. A host-selected Python outside the workspace runs in isolated mode with bounded time/output; failure logs are not exposed. The result preserves backend argv, remote port, readiness pattern, load mode, init break, and initialization/load/extra commands as inert data for separately authorized startup. No GDB/backend/preload helper is launched by this resolver. Sixteen focused resolution/server-configuration tests, TypeScript and lint passed. These tests mock the resolver process; real installed-Core backend resolution and physical startup are not claimed. Descendant containment, backend readiness, target-specific initialization, public integration and physical acceptance remain open.


### Debug project preparation composition (2026-09-20)

Connected selected computed configuration, an authorized no-interface pio debug build, system metadata, Core-resolved backend settings, registered GDB trust, and exact workspace ELF hashing. This preparation flow does not launch GDB or a backend and does not acquire/open a probe. Build failure, cancellation, policy changes, expired deadline, invalid GDB installation or an out-of-project ELF stop later preparation. Resolver approval scope uses the stable requested timeout while actual execution uses the remaining workflow deadline. The shared build lock covers compilation through artifact identity selection; later startup still rechecks the expected hash while retaining immutable ELF bytes. Fifteen focused preparation/resolution tests, TypeScript and lint passed. Backend containment/readiness and target-specific initialization remain necessary before public debugger registration; hardware acceptance remains outstanding.


### Native Windows backend descendant ownership (2026-09-20)

Added a fixed Python/Win32 backend supervisor using PROC_THREAD_ATTRIBUTE_JOB_LIST for atomic process assignment and JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. Only selected stdin/output handles are inherited; backend output cannot forge the separate supervisor control stream. Explicit stop, owner-pipe EOF and natural backend exit terminate the job, then query its active process count before reporting cleanup confirmation. A native Windows fixture verified the root and grandchild exited for all three paths; no hardware was contacted. Reproduction: scripts/verify-windows-debug-supervisor.mts with an absolute Python path; evidence: windows-debug-supervisor-evidence.json. This is an internal launcher building block, not yet connected to public debugger startup. POSIX process ownership, the Node lifecycle adapter, readiness and probe-binding integration remain unfinished. Windows API references: [job objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) and [process attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).


CI follow-up: Windows checks on 3855b90a exposed fixture comparisons between legacy realpathSync 8.3 names and the canonical long paths used by fs.promises.realpath. Updated debugger test fixture roots to realpathSync.native so exact path assertions match the production path identity. The failure was in test expectations; command and ELF selection assertions remain intact.


### POSIX backend supervision and Node owner (2026-09-20)

Added Linux/macOS process-group supervision with a live guardian retaining the group identity until shutdown. Linux adopts/reaps orphaned descendants; a separate owner pipe requests group termination if the supervisor exits. Added a Node backend owner that bounds diagnostics/control output, retains cleanup authority after uncertain exit, rejects contradictory control records, and requires both explicit cleanup proof and supervisor closure. Five focused lifecycle tests and TypeScript passed. The native parent/grandchild fixture is now portable and wired into the existing three-host CI matrix; POSIX native acceptance is pending that run. Backend readiness/trust/probe selection and public startup integration remain incomplete.


### Backend readiness and OpenOCD selection (2026-09-20)

Added worker-bounded readiness matching over only the owned backend output. Empty-match expressions are rejected; exit/failure, cancellation, deadline and current policy are checked before accepting evidence. Added explicit OpenOCD adapter serial selection with Tcl quoting and loopback GDB endpoint configuration, disabling unused Tcl/Telnet listeners. Explicit competing serial/init commands are rejected; configuration files remain trusted executable Tcl requiring the separate host-code grant. This binding is not yet applied to J-Link/ST-Link standalone backends. Fourteen focused readiness/binding cases passed.

Native lifecycle CI at d984499a passed Windows and Linux; macOS exposed a PermissionError after the backend started. The supervisor now retains ownership and polls through permission-denied group observations until ESRCH, rather than treating that observation as success or immediate terminal failure. Bounded phase/errno diagnostics identify any remaining failure. A new native macOS result is still required; no macOS success is claimed.


### Joint backend and GDB startup ownership (2026-09-20)

Connected optional supervised backends to the existing prepared debugger startup. Backend configuration participates in stable startup/approval identity. Backend host-code and target effects are both planned before consuming either grant, then dispatched before probe handoff. Readiness precedes GDB creation. GDB cleanup now confirms backend descendant cleanup before releasing the shared probe lease. Failed backend startup retains a connection-owned cleanup capability if release is uncertain; a GDB startup failure retains its existing owner, including the backend cleanup callback. Four focused composition cases passed alongside TypeScript/lint; full public debugger registration and target-specific initialization remain pending.


CI confirmation: both 35507080260 and 35507077976 passed on 6444c9c7. The native backend parent/grandchild lifecycle fixture passed Windows, Linux and macOS, including the Node owner path. This confirms the macOS cleanup observation fix for that fixture, not physical debugger/probe acceptance.


### Classified target initialization stages (2026-09-20)

Extended the existing attachment/download pipeline with ordered before-load and after-load commands. Every stage is parsed and permission-planned before the first transport write; inspection, target mutation and privileged host-code commands retain distinct authorization. Commands share one startup deadline, and execution commands require their asynchronous stop event. Added temporary entry breakpoints and explicit monitor init/reset classification. Startup reservation identity includes the initialization command sequence while excluding grant IDs. Fifty focused command/target/startup cases passed, including host-code denial before attachment, command ordering and continue-to-stop behavior. Translating full PlatformIO target-specific init scripts and exposing the public debugger workflow remain incomplete.


### PlatformIO initialization generator integration (2026-09-20)

The resolver now reuses the installed Core GDBClientProcess.generate_init_script method through a data-only owner, without constructing or running a debugger client. This preserves Core's init-command override, extra commands and default reset/restart definitions instead of duplicating target-specific script assembly. load=false is carried from project preparation to Core, clearing load_cmds before generation. Generated scripts remain bounded inert data; execution and binding their artifact paths to the retained ELF are still pending. Seventeen focused configuration/preparation cases, TypeScript and lint passed. Source API verified against Core v6.1.18 platformio/debug/process/gdb.py. The available C:/Python314 interpreter does not have PlatformIO installed, so native installed-Core generation was not claimed or substituted with a mocked runtime result.


### Retained privileged initialization execution (2026-09-20)

Added private bounded initialization artifacts with SHA-256 identity, declared ELF/endpoint/load scope, active process-local capabilities, tamper checks and retryable cleanup. Added a source executor that plans separate host-code and target mutation authority before consuming either approval, verifies the snapshot, sources only its retained path and restores auto-load/function-call restrictions afterward. Script failures invalidate the transport; artifact ownership can be tied to confirmed process cleanup. Seven focused tests, TypeScript and lint passed. The scope describes authorized intent, not proof that arbitrary privileged GDB code obeys it. Generated-script artifact-path binding, public startup integration and real GDB execution remain outstanding. Filename handling follows GDB's source command convention: only the surrounding MI string is quoted.

### Retained initialization template binding (2026-09-20)

Core initialization generation now also preserves reserved placeholders for its program path, program directory and debug endpoint. A bounded binder substitutes retained ELF storage and a numeric endpoint while preserving target-specific command text; it rejects reserved-marker collisions, control-bearing paths and oversized output. The no-load script remains unchanged beyond these substitutions. Twenty-one focused template/configuration/project tests, TypeScript and scoped lint passed. Installed-Core runtime generation and integration with the public session startup still require completion; arbitrary literal paths in privileged custom scripts are not rewritten or claimed to be constrained. All CI checks on the preceding pushed commit b048b135 passed, including Windows, Linux and macOS.

### Stable initialization approvals across retries (2026-09-20)

Template-derived initialization artifacts now carry a frozen semantic authorization identity distinct from their exact generated-byte integrity hash. Approval binds the template hash/size and firmware/endpoint/load selection; private ELF staging paths can change on retry without invalidating an otherwise identical approval. Literal script changes alter authorization, and generated-byte tampering still fails verification. Only the retaining factory can mint active artifacts. Ten focused initialization tests passed, including a real policy approval obtained on one artifact and consumed on a replacement with another private ELF path; TypeScript and scoped lint passed. Startup preflight and public integration remain pending.

### Owned Core initialization startup path (2026-09-20)

Prepared debugger startup now accepts the resolved Core initialization template, includes its stable descriptor in startup identity, and plans both initialization privileges before allocating firmware or acquiring probe custody. After retaining the ELF it binds and retains the exact script, starts the owned process/backend, and executes initialization through that process's actual project identity. The separate attach/download sequence is skipped for this path to avoid duplicate target effects. Script and ELF cleanup remain coupled to confirmed process/probe cleanup, including recoverable startup failures. Twenty-five focused startup/process/initialization tests passed; an additional real-policy startup test then passed with the eight-case startup suite, proving all three grants survive the reservation and are consumed by the intended stages. TypeScript and scoped lint passed. Public adapter selection, installed-Core/native GDB acceptance, backend selection completeness and physical acceptance remain outstanding.

### Native backend installation selection (2026-09-20)

Debugger project preparation now resolves configured native backends against registered Core packages or the separate PIO_MCP_DEBUG_BACKEND_ROOTS operator JSON setting. Shared canonical-path validation rejects project-owned/ancestor roots and unsupported executable names; registered backend manifests must match .piopm name/version/type. OpenOCD, J-Link and ST-Link executable families are recognized, without claiming their probe bindings are all implemented. Existing GDB discovery retains its own roots and package criteria. Twenty discovery/preparation cases passed, followed by two added preparation-branch cases in the nine-case preparation suite; TypeScript and scoped lint passed. Both CI runs on f3747543 completed successfully. Backend selection still needs connection to the public adapter, probe-specific binding and physical acceptance.

### J-Link USB binding and OpenOCD option coverage (2026-09-20)

Added a J-Link binding helper using the documented -USB serial selector (SEGGER V8.24+) with an explicit GDB port and LocalhostOnly state. It preserves target configuration, rejects remote/conflicting selectors and excludes legacy index serials 0..3. Auxiliary port settings remain the resolved backend's responsibility. Source: https://kb.segger.com/J-Link_GDB_Server (-USB and -localhostonly). Older SEGGER selection compatibility, native probe acceptance and public adapter routing remain pending. OpenOCD conflicting-command checks now also recognize attached short -c arguments. Twenty-three focused binding cases, TypeScript and scoped lint passed. These argument checks do not sandbox trusted backend scripts.

### Installed Core generator proof and isolated import fix (2026-09-20)

The installed Windows user-site PlatformIO Core 6.1.16 was available outside the earlier isolated/sandboxed import. A reproducible hardware-free script now executes the repository generation fragment with the real Core generator/reveal implementation and inert configuration fixtures. All four default/custom initialization and load/no-load combinations passed, preserving placeholders, one extra-command occurrence and restart definitions. Evidence is in core-debug-initialization-evidence.json. This proves generator compatibility, not full project resolution or GDB/hardware execution.

The check also exposed a real launch problem: Python -I excludes an otherwise legitimate user-site Core installation. The resolver bootstrap now adds only the host interpreter's conventional user-site directory when Core is absent and that directory is disjoint from the project. It does not process executable .pth files or add the working directory. The exact bootstrap successfully imported installed Core under -I. Ten resolver cases, TypeScript and scoped lint passed.

### Composed local backend selection (2026-09-20)

Added a single inert selector that consumes prepared Core metadata and a discovered probe, revalidates backend installation trust, validates the loopback endpoint/readiness expression, and routes OpenOCD or modern J-Link through the corresponding physical serial binding. It returns the exact supervised command, endpoint and physical resource identity for subsequent startup/custody. The Core resolver retains the actual validated interpreter path for backend supervision. Unsupported standalone ST-Link binding fails explicitly rather than starting without a selector. Twenty-four focused selection/preparation/resolver tests, TypeScript and scoped lint passed. Public connection wiring, GDB descendant containment, additional backend bindings and physical acceptance remain incomplete.

### Discovered probe to owned startup composition (2026-09-20)

Added a host-only composition that joins prepared firmware/template/backend metadata with an authorized inventory capability and connection-owned startup. The selected physical resource and location participate in stable startup/approval identity. Inventory is read once for selection and refreshed once at handoff; custody allocation is deferred until startup preflight succeeds. Probe relocation now rejects handoff, while owned cleanup remains available. The load scope comes from project preparation so it cannot diverge from the generated template. Fourteen focused composition/startup/custody tests passed, followed by twelve composition/preparation cases after binding the load scope; TypeScript and scoped lint passed. The host must still supply real independent release confirmation; no permissive fallback was added. Public connection integration and GDB descendant containment remain pending.

### Interactive Windows process supervision (2026-09-20)

Extended the Windows Job Object supervisor with opt-in bounded stdin/stdout forwarding, keeping child output encoded separately from trusted lifecycle events. Input uses a bounded queue so a blocked child cannot prevent owner-EOF shutdown; output is drained before the terminal cleanup record. Windows pipes use binary mode to preserve bytes. The Node owner provides bounded writes and enforces separate interactive/control output limits. Unsupported interactive POSIX startup currently fails explicitly; existing noninteractive supervision remains intact.

Native Windows fixtures passed stop, owner EOF, natural root exit, Node ownership and interactive echo with a live grandchild. A forged-looking cleanup record printed by the child remained ordinary output, and both process IDs were absent after real Job Object cleanup. Updated windows-debug-supervisor-evidence.json records the result. Five existing owner cases, TypeScript and scoped lint passed. GDB process integration and interactive POSIX support remain pending; no physical hardware was contacted.

### Supervised GDB transport and interactive POSIX implementation (2026-09-20)

Added bounded interactive stdin forwarding to the POSIX guardian using a nonblocking private pipe; stdout travels as encoded data through the guardian control channel, distinct from trusted lifecycle records. The existing native three-host fixture now exercises interactive input/output and descendant cleanup on every host. POSIX native results are pending CI.

Added a supervised child-stream adapter and routed GDB startup through it whenever owned backend startup supplies its validated Python. Cleanup requires the GDB supervisor's descendant proof before independent backend/probe confirmation; direct-process compatibility retains its existing explicit confirmation requirement. A real installed riscv32-esp-elf-gdb loaded the offline ESP32-C3 ELF and cleaned up successfully on Windows. supervised-gdb-evidence.json records this hardware-free proof, using fixture probe callbacks only. Twenty-one focused owner/startup/process cases passed, followed by seven owner cases including interactive control separation and invalid encoding; TypeScript and scoped lint passed. Plugin output remained unchanged after rebuilding. Physical target acceptance and public adapter wiring remain incomplete.

### Connection-owned preparation approval checkpoints (2026-09-20)

Debugger preparation now exposes a host-only checkpoint hook, and a bounded per-connection cache resumes completed configuration/build/system/resolution/image stages across single-use approval retries. Identity includes canonical project, environment, load, timeout and caller scope, excluding grant IDs. Checkpoints expire after fifteen minutes, reject concurrent identical requests, are invalidated on policy revision changes/nonapproval failures, and are discarded on connection close or explicit successful-startup forget. Trust roots are revalidated outside cached stages; retained ELF hash verification still occurs at startup.

Twelve preparation cases passed, including a real three-grant retry chain that builds and reads system information exactly once, consumed-grant status checks, policy invalidation, caller isolation and forgetting completed startup preparation. TypeScript and scoped lint passed. Public adapter integration must use the connection-owned cache and forget it after success; this does not yet register the debugger tools.

### Backend approval preflight ordering (2026-09-20)

Backend host/target authorization is now planned before the outer startup grant is consumed or artifacts/custody are allocated. Preflight and actual backend execution share one scope builder. Prepared startup binds the backend grant to the retained firmware SHA-256 rather than a random private ELF path; direct host callers without an image digest retain their path-based scope. Fourteen focused backend/startup cases passed, including identical pre-/post-retention scopes and approval denial before artifact/probe effects. TypeScript and scoped lint passed. The preparation checkpoint commit remains part of the pending public-adapter integration.

### Reset/run stop semantics (2026-09-20)

Added connection-owned resetRunAndStop, invoking Core's configured pio_reset_run_target hook before confirmed process/backend cleanup. The common command dispatcher requires both privileged host-code and target authority, including when the hook is sent through ordinary command routing; both grants are planned before either is consumed. Hook failure/timeout retains the session for recovery or process-only cleanup. The acknowledgment does not claim independently verified physical running state. Fifty-six focused command/session/reset-run cases, TypeScript and scoped lint passed. CI runs 35509620773 and 35509617819 completed successfully on df061f1c, including native interactive supervision on Windows/Linux/macOS. Public registration remains at 35/40; debugger adapter wiring and power profiling are not complete.


### Public debugger registration and owned release proof (2026-09-20)

Registered all four reference debugger names in opt-in compatibility mode and connected them to one debugger client per stdio connection. Startup composes the preparation cache, authorized inventory, physical selection, retained ELF/template, local backend and GDB owners. Commands preserve inspection/target/host classification; normal stop requires configured reset/run permissions, while explicit process-only recovery remains available. Disconnect/shutdown cancel preparation, close session admission and retain uncertain cleanup. A connection-stable internal task identity keeps preparation checkpoints usable across changing MCP activity IDs.

Release now accepts the native supervisor's empty owned group/job proof for GDB and its backend; external host verification is an optional additional requirement. Direct unsupervised GDB still requires independent verification. A backend root exit or a cleanup call without confirmed group closure is insufficient. The native offline-GDB fixture passed on Windows without an external release verifier; no physical device was contacted. Unidentified unrelated USB peripherals are excluded from candidates rather than blocking a uniquely identified selection.

Twenty-eight focused adapter/process/backend/MCP checks passed, followed by nineteen changed adapter/process/backend checks. TypeScript and scoped lint passed. Prior-head hosted CI 35510464761 and 35510461106 passed on 9ddce8b9. The shipped plugin runtime was rebuilt. New-head hosted CI is not yet claimed.

The inventory is now 57 canonical plus 39 reference tools (96 in compatibility mode). Power profiling remains unregistered. Registration does not complete debugger parity: standalone ST-Link/remote bindings, physical target evidence, endpoint conflict handling, remaining response details, concrete tool-level policy vocabulary, approval-resume ergonomics and CLI/dashboard coverage remain. Broad platform/hardware acceptance and actual publications remain incomplete; the PR stays draft.
### Power analysis and bounded serial parsing (2026-09-20)

Added shared current statistics with reference nearest-index p95 and histogram-based sleep/active threshold selection, bucketed timelines, charge/energy and ideal battery-life estimates. Inputs are bounded and finite; backwards timestamps fail. Duration derives from actual first/last observation timestamps, not the requested collection interval. Reports explicitly label sample-mean energy estimation, sample-count sleep fractions and firmware/external-meter/unspecified provenance. No measurement is advertised from synthetic evidence.

Serial parsing uses the existing terminable regex worker for both the reference default and custom Python-style named groups. Current converts uA/µA/mA/A to mA; voltage converts V/mV to mV; only the first current observation per line is retained. Invalid captures and unknown units fail explicitly. The shared worker now bounds optional voltage/vunit captures as well as existing value/name/unit fields. Nineteen focused numeric/parser/worker checks, TypeScript and scoped lint passed. Collection, triggers, PPK2 measurement/source-mode limits and cleanup are still incomplete; pio_power_profile remains unregistered and no new hardware has been contacted.

### Owned serial power collection (2026-09-20)

Added bounded serial power capture and integrated it with the existing policy-owned session service. One-shot collection validates the custom pattern before device opening, preflights separate opening/read grants against stable device identity, consumes each grant once, retains revision checks across pages/final disclosure, and stops only its owned session on success or failure. Capture reports line/byte loss, redaction truncation, early disconnection, cancellation and incomplete limits. Batch timestamps are labeled host-read observations; buffered readings do not acquire invented per-sample intervals. Recorded collection duration is separate from the first-to-last sample span used for energy estimates.

Forty focused power/memory capture and serial-policy cases passed, including changed-duration grant rejection, one-use grant consumption/replay rejection, invalid regex before opening, final authorization revocation, loss accounting and cleanup. TypeScript, scoped lint and diff checks passed; the shipped plugin was rebuilt. Both CI runs 35510973434 and 35510971696 passed on public-debugger revision 424b53cb. Serial triggers, PPK2 measurement/source mode, power tool public integration and physical acceptance remain incomplete; registration remains 39/40.

### Fresh firmware trigger for power collection (2026-09-20)

Added bounded trigger waiting on an existing caller-owned firmware monitor. The wait snapshots the next completed-line cursor, ignores completed backlog, uses the shared terminable regex worker, rejects lost/truncated evidence, honors cancellation/closure and rechecks policy before returning the matching line. It neither opens the meter nor stops the firmware monitor. Read authority is scoped to the exact trigger pattern, duration and session, consumed once and guarded for the bounded operation lifetime.

Thirty-seven focused trigger/serial-policy checks passed after correcting one test fixture to supply the service's required trusted context. TypeScript and scoped lint passed; plugin runtime rebuilt. Tests cover fresh-vs-buffered evidence, foreign ownership, final revocation, cancellation/loss, changed-pattern approval rejection and leaving the firmware monitor open. The PPK2 backend and public power composition remain incomplete.

PPK2 implementation references checked for the next backend step: Nordic's maximum DUT current table specifies 1 A continuous in ampere mode and 600 mA in source mode (https://docs.nordicsemi.com/r/bundle/ug_ppk2/page/ug/ppk/ppk_max_dut_current.html). IRNAS's API source exposes explicit source/ampere selection and DUT power toggles; its destructor performs only best-effort reset/close (https://github.com/IRNAS/ppk2-api-python/blob/master/src/ppk2_api/ppk2_api.py). The integration must implement explicit output-off cleanup and report uncertainty rather than relying on that destructor. These are documentation/code observations, not hardware acceptance or a pinned dependency selection.

### PPK2 collection bridge (2026-09-20)

Added a fixed isolated Python bridge for the optional ppk2-api backend. Requests explicitly choose ampere or source mode, a calibration/supply voltage and a software-trip current threshold. Limits reject invalid/nonfinite inputs and cap current at the documented 600 mA source / 1000 mA continuous ampere ceilings. Ampere mode supplies calibration voltage without invoking the source-voltage setter or power-on command. Source mode requests OFF before configuration and again in cleanup; OFF, measurement stop and serial close have independent success fields, with no assertion of physically verified output-off.

Collection bounds raw backlog, bytes, sample count and emitted 1000-sample mean windows; partial raw/sample windows and unreported completed windows are explicit. Decoder sample loss and overcurrent fail the operation. Owner EOF/stop requests cancellation. The bridge retains partially initialized meter objects for cleanup and detects short writes after opening. The parent integration must enforce setup/cleanup deadlines, policy, DUT/meter binding, process custody and uncertain-release retention; these are not implemented by the bridge itself. A software current trip is not a programmable hardware current limiter.

The native Python fixture (`node --import tsx scripts/verify-ppk2-bridge.mts <absolute-python>`) passed 14 scenarios on Python 3.14.4 using a fake meter API, including normal source/ampere flow, trip, off/stop/ON/init failures, decoder loss, cancellation and invalid limits. No serial module was imported and no physical device was contacted. The real optional library and physical PPK2 acceptance remain unverified. TypeScript and scoped lint passed. Prior public serial-power revision 8fd8ca40 passed both CI runs 35511422356 and 35511418718.

### PPK2 bridge protocol validation (2026-09-20)

Added a bounded host-side PPK2 stream parser retaining the exact validated mode, voltage, duration and software current-trip limit. It rejects samples before startup, wrong modes/rates, excess output/current, inconsistent raw/window counts, duplicate/post-terminal records, partial EOF and unsupported physical-output claims. Device cleanup is explicitly a reported state; an owning process layer must independently prove group closure before device custody can be released. Missing/off-failed cleanup remains uncertain.

Ten focused protocol cases passed. The native Python bridge fixture now feeds nine real fixture message streams through the TypeScript consumer in addition to its fourteen control-flow scenarios; all passed on Python 3.14.4 without hardware. Corrected sample-limit counting so a rejected extra sample cannot make terminal counters inconsistent. TypeScript and scoped lint passed. Host process ownership, permission/DUT binding and public power integration remain incomplete; pio_power_profile stays unregistered.

### Supervised PPK2 process ownership (2026-09-20)

Added a retained process owner that launches the fixed bridge under the existing native Windows Job Object/POSIX group supervisor. Request delivery is tracked conservatively before writing; startup and collection have bounded waits, cancellation first requests graceful stop, and cleanup coalesces stop requests before forced descendant cleanup. Custody releases only after both a valid device cleanup report and confirmed supervisor/group closure. Uncertain output-off, malformed output and group failures retain the owner; group cleanup can be retried. The owner is host-only and grants no permission or physical binding itself.

Fifteen focused process/protocol checks passed. A native Windows process fixture using an isolated interpreter without ppk2-api reported capability-unavailable, closed the supervised process and released fixture custody exactly once; it checked dependency absence before execution and could not open a meter. Fixed bridge interpreter exit to avoid the daemon stdin reader racing Python finalization. Added the bridge fixture and missing-dependency process fixture to the existing three-platform CI matrix. TypeScript and scoped lint passed. Both previous-head CI runs 35511890340 and 35511888387 passed on 6f1320d8; new-head hosted results are pending.

PPK2 permission/source-envelope enrollment, actual meter/DUT custody composition, dependency setup, public tool/reporting and hardware acceptance remain incomplete. An output-off write is still not represented as independent physical output verification. Registration remains 39/40 and nothing has been published.

### 2026-09-20 — Shared meter/DUT custody

Added `PowerDeviceCustody`, an inert host-only owner implementing the existing process custody contract. It acquires the meter and DUT's existing lease-domain resources together, refreshes both bindings before handoff, and retains every acquired capability across partial acquisition, discovery, handoff, and release failures. Closing during discovery prevents a subsequent handoff; cleanup retries retain only leases not yet released. Meter/DUT resource overlap is rejected. Physical identity resolution, permission/envelope approval, and public PPK2 composition remain outstanding; this class does not grant permission or assert physical output shutdown.

Validation: six focused tests using real isolated lease records passed; TypeScript and scoped lint passed. Previous head `819e8e6594c4e840f8aab3dfbe864215c6f8349b` completed both hosted CI runs successfully (`35512377703`, `35512375637`), including the hardware-free PPK2 fixtures. Registration remains 39/40. No hardware contacted or release published.

### 2026-09-20 — Permission-enforced PPK2 operation

Composed `PowerDeviceCustody` and `Ppk2Process` in the inert, retained `AuthorizedPpk2Operation`. Exact execution scope includes meter/DUT identities, interpreter, port, explicit ampere/source mode, voltage, software current-trip limit, and duration. Host execution and measurement/source permissions are preflighted before either grant is consumed. `power_source` is an independent critical permission, denied absent explicit operator configuration; host/upload/monitor permission alone cannot energize the source. Policy changes abort active collection, and device/process cleanup remains available independently of new permissions. Prior cancellation or owner shutdown does not consume grants.

Validation: 15 focused power authorization cases plus 13 existing dispatcher cases passed (28 total); TypeScript and scoped lint passed. Tests use a process double with the real policy/approval store and do not contact hardware. Rebuilt the checked-in plugin for the shared catalog change. Public registration remains 39/40; trusted meter discovery, dependency setup, public power routing and required physical acceptance are still outstanding. No deployment performed.

### 2026-09-20 — Serial power compatibility adapter

Added the serial branch adapter for the pinned power contract: serial source, 10-second default, 115200 baud, bounded pattern/voltage/bucket/threshold arguments, and the existing one-shot owned serial collector. Fresh firmware triggers use their own scoped read approval and must succeed before meter startup. The trigger monitor remains owned by the connection; only the newly opened meter session is closed. Results preserve reference statistics and add actual collection/observation timing, provenance, loss, redaction and cleanup qualifiers. Pending cleanup retains a recoverable session identifier; missing samples do not become invented zero-current measurements.

Validation: six focused adapter composition/projection checks passed, with real bounded serial parsing for the report fixture; TypeScript and scoped lint passed. No hardware contacted. The adapter is not yet registered: PPK2 host discovery/dependency setup and the combined public dispatcher remain outstanding. Registration stays 39/40 and no distribution is published.

### 2026-09-20 — PPK2 result projection

Added `projectPpk2PowerReport` for terminal-validated meter output. It reports reference current statistics over the bridge's 10 ms window means, integrates charge/energy over the full returned windows at the declared meter sample rate, and separately reports measured wall-clock collection duration and requested duration. It labels the operator calibration/source voltage as not physically measured. Omitted partial windows, unreported data and error outcomes prevent a complete result; absent samples produce null energy/charge rather than invented zero-current measurements. Software output-off acknowledgment remains distinct from physical verification.

Validation: four focused protocol-to-report checks passed, with dimensional charge/energy assertions, incomplete/error cases and terminal-cleanup rejection; TypeScript and scoped lint passed. This is internal reporting, not physical meter acceptance. Public registration remains 39/40; dependency/discovery and public integration remain outstanding. No deployment performed.

### 2026-09-20 — Explicit pinned PPK2 dependency setup

Added an operator-only setup command that exclusively creates a new environment, installs two hash-pinned binary wheels using isolated pip with no dependency resolution, validates isolated package imports/versions/API methods, and emits completion evidence only after success. Included the script in npm, plugin sync, and Python runtime packaging, with optional-dependency notices. Actual Windows Python 3.14.4 installation/import verification succeeded for ppk2-api 0.9.2 and pyserial 3.5 in the ignored `.platformio-mcp/ppk2-api-092-acceptance` directory. No serial enumeration or hardware contact occurred. The host discovery/trust adapter and public integration remain incomplete; registration stays 39/40 and no release was published.

### 2026-09-20 — Host PPK2 environment selection

Added `resolvePpk2Environment` for explicit server-side `PIO_MCP_PPK2_ENV` configuration. It performs bounded virtual-environment configuration inspection, requires disabled system-site packages, rejects project/environment containment and executable directory escapes, and never trusts the executable pathname stored in setup evidence. The returned pathname retains the virtual environment on POSIX instead of following its interpreter symlink to a base Python that would lose the installed dependency. This resolver does not install packages, execute Python, enumerate devices or assert API/hardware availability.

Validation: four focused host-selection checks plus TypeScript passed. Device discovery, runtime dependency-version validation, public routing and physical acceptance remain outstanding. Registration remains 39/40 and no release has been published.

### 2026-09-20 — Runtime PPK2 version enforcement

The bridge now checks installed ppk2-api 0.9.2 and pyserial 3.5 before importing the driver or constructing any meter. Missing dependencies and incompatible versions produce distinct unopened terminal outcomes accepted by the bounded protocol. Added an installed-dependency verifier that imports the actual pinned API, injects version drift for each dependency, and verifies rejection without constructing hardware. Native Windows execution against the explicitly installed environment passed both drift cases; all 11 protocol cases and TypeScript passed. Host device discovery and public power routing remain incomplete; no physical acceptance or publication is claimed.

### 2026-09-20 — Power device discovery binding

Added host serial discovery binding for power operations using the existing canonical endpoint and USB lease keys. Both meter and DUT require host-observed USB metadata; revalidation rejects disappearance, port drift and replacement before startup. A separate list-devices permission scopes initial selection plus two pre-spawn refreshes to three snapshots and expires when the operation ends. It does not infer meter model or physical wiring. Ambiguous multi-interface devices still fail closed and require further explicit interface support before that hardware can be claimed.

Validation: five focused identity/budget/lifetime checks passed (scope tests replace policy dispatch and native enumeration; identity tests exercise the actual binding). TypeScript and scoped lint passed. No hardware enumerated or powered. Public power routing, multi-interface binding and physical acceptance remain outstanding; registration is still 39/40.

### 2026-09-20 — Connection-owned PPK2 composition

Added `PowerMeterClient`, composing project resolution, host environment selection, bounded discovery, meter/DUT identity binding, exact host/power permissions, supervised collection and report conversion. Each connection retains opaque cleanup owners through failure, rejects foreign cleanup IDs, cancels pending work on disconnect, and retries retained cleanup without requiring fresh power permission. Electrical mode, voltage/current limits and DUT port are explicit. This adapter is not yet publicly registered; combined routing, PPK2 trigger/monitor custody coexistence, multi-interface discovery and physical acceptance remain outstanding.

Validation: four focused composition/ownership cases passed with hardware/execution doubles; TypeScript and scoped lint passed. Existing policy/protocol/process/discovery evidence remains separately scoped. No physical device access or deployment occurred.

### 2026-09-20 — Public power registration (40/40 names; acceptance incomplete)

Registered the functional serial/PPK2 `pio_power_profile` route only in compatibility mode, with connection shutdown hooks and retained meter list/cleanup operations. The public operation has its own policy name under start_monitor; both explicit and inherited denies execute before either collector. Existing 57 canonical tools remain unchanged; opt-in mode exposes 97 total, covering all 40 pinned reference names. PPK2 trigger coexistence, ambiguous multi-interface discovery, response/default details, physical evidence and release gates remain unfinished. Registration is not full parity.

Validation: all four real-stdio entrypoint/mode cases passed, including opt-in counts, empty owned power listing, invalid meter arguments and foreign cleanup-ID rejection. Two real-policy cases verified public/parent denies stop both collectors. TypeScript and scoped lint passed; bundled plugin rebuilt. Corrected the stdio test fixture to place policy enrollment storage outside its project, as required by existing policy rules. No hardware contacted and no release published.

### 2026-09-20 — Immutable GitHub release retries

Implemented verified identical-asset reuse for existing GitHub releases. The uploader checks all local names against remote uploaded-state, size and SHA-256 identity before mutation, downloads/hashes legacy assets lacking a digest, uploads missing files without clobber, and rechecks the resulting set. Conflicting names fail rather than overwriting published bytes. Release workflow now passes the tag through its environment value rather than interpolating it into shell source. Added three focused identity/name tests to the existing namespace CI command; those tests passed. No live release was created or modified.

Both CI runs for 864ad2b3 completed successfully (35514230904 and 35514228152), and public power registration commit 22b8c485 was pushed to PR #26. Current-head CI, physical acceptance and deployment remain separate unfinished gates.

### 2026-09-20 — Release retry orchestration evidence

Added controlled GitHub-command injection for the release-asset helper and exercised its full sequence against real temporary artifacts. The fixture verified legacy asset download/hash comparison, uploading only missing names without clobber, post-upload inspection, and whole-set rejection before any upload when a later artifact conflicts. All five release-asset checks passed; these are simulated remote responses, not live publication evidence. Physical hardware inventory and the operator-approved PPK2 source envelope were requested while implementation/release work continues.

### 2026-09-20 — Alias-complete release instructions

Confirmed that Python release building and native acceptance derive every alias from `distribution/namespaces.json`: the native installer requires one host wheel plus all configured alias wheels, checks each alias module/owned command, and verifies canonical survival after all aliases are uninstalled. Corrected stale two-alias/seven-wheel wording and hard-coded seven-container workflow labels; npm publication input now accurately describes all authorized packages. These are instruction/label fixes, not new publication or native acceptance evidence. No additional smoke tests were run.

### 2026-09-20 — Preserve debugger inspection results and initial stop state

Fixed a concrete response gap: mapped GDB/MI inspection commands could succeed with empty console output while the adapter discarded their structured result fields. Replies now retain bounded ordered `result_fields`, preserving repeated names and keeping debugger-controlled names as data. Startup also returns the latest owned stop frame and running/closed observations instead of requiring an extra list call. Unknown state remains null; initialization success is not interpreted as target halt.

Validation: 13 focused debugger response/connection cases passed, covering variable values, backtrace frames, register values, repeated/prototype-like field names and initial stop reporting. TypeScript passed and the plugin was rebuilt. Full reference response parity and physical debugger acceptance remain incomplete; no deployment occurred.


### Native wheel packaging correction

Release validation run 35515111803 built all five native wheels and all six Python aliases. Linux x64 and arm64 installed and exercised the complete alias set successfully. Windows failed exact alias-source comparison because checkout converted launcher newlines; alias Python sources now require LF through Git attributes, preserving exact byte validation. Both macOS hosts rejected the nonstandard 13_5 wheel tags. Wheels now conservatively target macOS 14.0; the bundled Node runtime minimum remains 13.5, but these wheels require macOS 14 or later. No publisher ran. Native acceptance must be repeated for the corrected artifacts; this is not physical or final-release acceptance.


### Debugger session metadata parity

Start/list/stop responses now expose the host-resolved debug tool and monotonic session age, including age through successful shutdown. Metadata is copied at launch admission and preserved for retained failed-start/cleanup owners. Four focused debugger suites passed (31 cases), including ownership, failure recovery and immutable metadata timing; TypeScript passed. Physical debugger acceptance remains outstanding.


### Five-host installed Python evidence

Run 35515440936 passed installation, every functional alias, MCP stdio/EOF and alias-removal preservation on Windows x64, macOS arm64/x64 and Linux arm64/x64. Exact source 0dd30afd8358a7d0b7ff8d8b1f0e018f7708c421 and per-wheel hashes are retained in native-python-installation-evidence.json. This validates the packaging fixes, not the later debugger metadata commit or a published/final release. The container jobs continue in the same run.


### Container dependency build correction

Both native container jobs in run 35515440936 failed because PlatformIO 6.1.16 has only a source distribution and the image required wheels for every dependency. The image now installs hash-pinned setuptools 84.0.0, wheel 0.48.0 and packaging 26.3, then permits only PlatformIO to build from its existing hash-pinned source with build isolation disabled. Other dependencies still require wheels and hashes. Official PyPI metadata supplied the build-tool wheel hashes. A fresh no-cache local source build succeeded and the full locked dependency set resolved; this is not native Linux container acceptance. The minimal context and Docker allowlist include the new build-tool lock.


### Canonical power profiling in normal mode

Added power_profile to the default MCP surface using the same serial/PPK2 implementation as pio_power_profile. Compatibility mode retains the reference alias. The alias inherits canonical deny and approval rules through power_profile -> start_monitor, while lower meter host/source permissions remain independent. Owned cleanup remains available without a new measurement grant. Real stdio checks cover listing/calling the canonical tool with compatibility disabled and enabled. The registry now advertises 58 tools normally and 98 with all 40 reference names enabled. This closes the MCP exposure gap for power profiling; CLI/dashboard and remaining PPK2 behavior/physical acceptance are still outstanding.


### Completed non-publishing distribution validation

Run 35515777379 succeeded on ef52feb65e89cc1dab063ebfa79f57b1e9acdc28: complete wheel set, five native installation jobs, native amd64/arm64 containers and aggregate release artifact assembly passed. Job results and artifact identities are retained in distribution-build-evidence.json. All publisher inputs were false; tag/final-publication gates were not exercised. This evidence does not cover subsequent canonical power or isolation-parser changes.

### Unambiguous PPK2 environment isolation

Virtual-environment validation now rejects duplicate include-system-site-packages entries instead of accepting any false line even when Python could read another true entry. Seven focused environment cases and TypeScript passed. This does not replace actual PPK2 physical acceptance.


### Canonical debugger availability and alias policy inheritance

Added the planned debug_start/debug_cmd/debug_stop/debug_list names to normal mode, retaining reference aliases in compatibility mode. Both name sets share connection-owned sessions. A public-name boundary now enforces canonical and alias deny/approval rules before calling the debugger implementation, with request_approval_id distinct from lower-level grants. All command-capable public operations retain run_shell_command classification; listing uses query_logs. Process-only owned cleanup bypasses new target authorization. Session scope comes from ownership, and validation retains COMPAT_ARGUMENT_INVALID. Normal/compatibility tool totals are 62/102. Prior CI failures on 25398f54 were two stale live-tool count assertions (57 versus the newly added power tool); those now reflect the complete canonical set while pinned legacy schema checks remain intact. Full debugger backend/physical/CLI/dashboard acceptance remains incomplete.


### Shared debugger endpoint custody

Added an inert endpoint/probe custody owner retained before lease allocation. Startup takes the global per-user loopback-port lease before the probe, checks for an existing listener twice, and persists handoff uncertainty before backend launch. Cleanup releases the probe and then endpoint only under the existing supervisor closure proof; partial acquisition and failed releases remain retryable. Fifteen focused endpoint/local-startup/backend cases passed, including real occupied TCP binding, cross-probe contention, failed probe acquisition/release and preparation races. TypeScript and scoped lint passed. Arbitrary external-process bind races and endpoint peer authentication remain unresolved; no physical acceptance is claimed.


### Preserve configured legacy J-Link selection

Configured -select USB commands now retain -select USB=<discovered serial> instead of introducing the V8.24-only -USB option. Explicit -USB configurations retain the modern selector. Both paths preserve -LocalhostOnly 1, reject remote/conflicting selectors and keep target settings. SEGGER UM08001 v6.30 sections 3.3.5.8/3.3.5.23 and current SEGGER GDB Server documentation were inspected; links are in the parity guide. Twenty binding/backend-selection cases and TypeScript passed. Physical and installed legacy-binary acceptance remain outstanding. CI runs 35516577339 and 35516579513 passed on 0b36b9bb before this and the pending endpoint-custody changes.


### PPK2 trigger and owned-monitor coexistence

Added a single-borrower internal monitor hold with exact resource snapshots, persistent handoff state and cancellation on stop/disconnect. Monitor closure retains endpoint/USB leases until the power owner confirms cleanup. PPK2 now accepts paired trigger/session fields, waits for fresh authorized output, verifies same-project/exact-DUT resources, and adopts the hold into supervised meter custody. Partial failures before ownership return unused holds; failed device cleanup retains the power recovery owner. Outer profile policy revision is carried through the trigger and execution path. Sixty-four focused serial/power ownership and policy cases plus twelve trigger/public-policy/real-stdio cases passed. Physical acceptance, ambiguous multi-interface support and full reference result/default parity remain incomplete.


### Explicit multi-interface power-device binding

Power discovery now accepts an explicitly selected endpoint when multiple host-observed serial interfaces share its USB descriptor. It retains the existing whole-device USB exclusion key alongside the selected endpoint key; selecting another interface cannot evade physical-device custody. Revalidation pins the complete normalized interface set and rejects interface removal, addition, identity replacement or endpoint drift. Enumeration order and equivalent endpoint aliases do not change that set. Other serial callers retain the conservative default rejection of shared descriptors. This does not authenticate USB descriptors, infer the correct PPK2 protocol interface, auto-select a meter, or establish physical wiring.

Validation: 18 focused discovery and power-custody cases passed, including shared-interface identity, stable enumeration reorder and changed topology. TypeScript and scoped lint passed; the shipped plugin was rebuilt. Physical multi-interface hardware acceptance and reference auto-discovery behavior remain outstanding.


### Debugger launch and initialization response metadata

Debugger startup and owned-session listings now expose `command` from the resolved executable and actual fixed GDB argument vector, plus `init_script` from the retained initialization artifact. Script ownership wrappers preserve this path until confirmed cleanup, and command arrays are fresh snapshots rather than mutable internal state. Alternate host-owned implementations without this metadata return null in startup responses. This reports the actual directly supervised GDB launch, not a reconstructed PlatformIO CLI invocation. Version-banner reporting remains outstanding.

Validation: 38 focused process, initialization, compatibility and connection-ownership cases passed; TypeScript and scoped lint passed. The plugin was rebuilt. No debugger hardware was accessed.


### Observed debugger version reporting

Controlled initialization now requests `-gdb-version` from the same supervised MI transport, within its existing total initialization deadline, after safeguards and symbol loading. A bounded, nontruncated GNU GDB banner is retained in process state and exposed through startup, owned listings and stop responses. Missing or unsupported version information remains null; timeout or process closure retains normal initialization-failure cleanup. No additional executable or target command is introduced. The command is specified by the [official GDB MI documentation](https://www.sourceware.org/gdb/current/onlinedocs/gdb.html/GDB_002fMI-Miscellaneous-Commands.html).

Validation: 33 focused initialization/process/compatibility cases passed, including banner, absent output and unsupported-query behavior; TypeScript and scoped lint passed. The plugin was rebuilt. Physical debugger/backend acceptance remains outstanding.


### Persistent OTA upload-image evidence

After both OTA upload grants are authorized, the exact private image snapshot is archived by source scope and SHA-256 before network custody or transfer. Archive publication is atomic and never overwrites an existing object; existing bytes are revalidated. Public reports include `firmware_archive_path` while explicitly reporting `elf_correspondence: identity_unverified`. Private working-copy cleanup no longer discards the historical image. An archive does not assert that transfer succeeded, that the device booted it, or that an unrelated ELF corresponds to it. Serial uploader manifests and verified image-to-ELF mappings remain outstanding.

Validation: eleven focused artifact and real-policy/synthetic-transfer cases passed, including retention after rebuild and cleanup, existing-object tampering, no archival before grants and no transfer after archive failure. TypeScript and scoped lint passed; plugin rebuilt. No hardware or network transfer was performed.


### Embedded ESP application ELF identity metadata

OTA image retention now reads the ESP-IDF app descriptor from recognized ESP32 images, validating segment bounds, image checksum and any appended SHA-256 digest before returning `embedded_elf_sha256`. Unrecognized formats and unset descriptor hashes remain null; the report still marks ELF correspondence unverified until an actual ELF is compared. Layout references are the pinned [ESP-IDF v5.5 descriptor](https://github.com/espressif/esp-idf/blob/v5.5/components/esp_app_format/include/esp_app_desc.h) and [esptool v4.8.1 image format implementation](https://github.com/espressif/esptool/blob/v4.8.1/esptool/bin_image.py). No source code was copied. This field is metadata, not a signature or evidence of physical execution.

Validation: fifteen focused parser/artifact/transfer cases passed; TypeScript and scoped lint passed, plugin rebuilt. CI 35518445259 passed on the preceding debugger revision. Its duplicate run 35518442409 failed only because the existing Python converter test's 5-second harness limit was shorter than its 10-second subprocess bound; both converter cases now allow a 15-second harness deadline while retaining the subprocess limit and all assertions.


### Explicit OTA image-to-ELF hash matching

The OTA adapter now accepts optional `elf_path` (canonical service `elfPath`) under the same scoped image-inspection grant, with that path included in authorization scope. It captures bounded workspace bytes, rejects a missing or mismatched embedded image hash, validates an ESP32-target ELF, and archives the exact matched bytes. Both upload grants include the selected ELF path/hash alongside the image identity. The public result reports the retained ELF and `embedded_hash_match`; this deliberately does not claim signed provenance, physical execution, or generic serial-uploader correspondence. Unsupported images without an explicit ELF retain existing unverified behavior. Matching failure releases the private image before transfer.

Validation: 26 focused ELF retention, OTA service, transfer-policy and compatibility cases passed. Coverage includes decoding-artifact retention across rebuild, mismatch before transfer, absent identity, outside-workspace paths and incompatible ELF target. TypeScript and scoped lint passed; plugin rebuilt. Physical acceptance and complete serial uploader manifest/handoff remain outstanding.


### Recover archived ELF after source cleanup; establish CI Python prerequisite

Archived ELF lookup no longer requires the original file or build directory to survive. It canonicalizes through the nearest existing ancestor and retains the exact source-path hash scope; it does not search globally by content hash or follow unrelated histories. Tests now resolve the archived file after deletion and after entire build-directory removal, while rejecting a different missing source path.

CI run 35518807967 exposed a Python subprocess startup timeout at the retained 10-second process bound (rather than the previously fixed harness deadline). Inspection found setup-python after the unit tests that invoke Python. CI now installs the existing selected Python 3.12 runtime before those tests, using the release workflow's pinned setup-python action. Converter assertions now report subprocess errors directly; neither the process bound nor behavior checks were relaxed. Hosted verification remains pending.

Validation: seventeen focused archive, OTA ELF and converter tests passed; TypeScript and scoped lint passed, plugin rebuilt.


### Real ESP OTA image/ELF correspondence evidence

Using the existing official ESP core-dump ELF fixtures and installed esptool 5.4.0, generated ESP32, ESP32-C3 and ESP32-P4 application images offline with an embedded ELF SHA-256 at offset 176. The actual image parser and ELF-retention path matched all three full hashes and preserved their archived bytes. Each case rejected a different real ELF and an image with corrupted descriptor bytes. Exact source revision, implementation hashes, image hashes and ELF hashes are recorded in `ota-elf-windows-evidence.json`. This validates offline Xtensa/RISC-V format handling on Windows; it does not claim a physical upload or board boot.


### Power trigger defaults, response fields and policy continuity

Both serial and PPK2 trigger waits now default to the requested collection `seconds`, matching the pinned reference, while preserving an explicit `trigger_seconds` override. Empty serial/otherwise-complete empty PPK2 collections return reference `no_samples`; PPK2 reports include `unparsed_lines: 0`. Other partial/current-trip diagnostics remain distinct. Serial orchestration carries the outer profile revision guard across trigger completion, discovery, capture admission and result return. The public description now reflects implemented explicit multi-interface selection.

Validation: sixteen focused serial/projection/trigger checks passed, followed by nine updated PPK2-trigger/public-policy cases; TypeScript and scoped lint passed. Plugin rebuilt. Both preceding CI runs (35519193064 and 35519190348) passed on 3cdb3174, including the corrected Python setup order. No physical power measurement was performed.


### Authenticated npm package and personal-scope authority

The current npm session returned `forkbomb`; npm access metadata confirmed read-write permissions for platformio-mcp, pio-mcp and pio-agent. npm's documented personal-scope assignment establishes control of @forkbomb, so the five prepared scoped candidates now record publicationControlVerified. Evidence and limitations are in npm-publisher-authority.json. Candidate publishIntent remains false pending name-specific eligibility and release configuration; no package was published, reserved or overwritten. This removes the stale scope-authority blocker without asserting CI identity or successful registration.


### Namespace coverage preserves verified authority

The generated seven-name coverage matrix now includes personal-scope authority and naming eligibility for scoped alternatives. Existing npm packages with directly verified write access are recorded as authority-verified, while observed registry versions remain separate from final-release deployment. Candidate packages still do not count as published or secured. Six namespace audit/coverage cases passed, including metadata-only observations remaining authority-unproven and verified scoped candidates remaining unpublished. Regenerated platformio-namespace-coverage.json from the current inventory without new registry lookups.


### Public upload-to-monitor custody integration (2026-09-20)

The compatibility flash verifier now reserves the monitor endpoint and discovered USB scope before uploading. A same-port uploader borrows these exact leases, marks child uncertainty before spawn, and returns custody only after confirmed closure. The serial transport opens under the retained leases. A separate upload port retains its existing process custody while the monitor reservation remains held. Upload authorization surrounds a single-use execution continuation; monitor open/read authorization and five-snapshot startup discovery remain separate. Failed upload does not open a monitor. Disconnect cancels same-port uploads, and unconfirmed cleanup keeps the owning session pending.

Validation: 71 focused workflow/policy/compatibility/target tests passed, including three public-workflow integration cases with real permission/session/lease code and simulated upload/serial hardware. TypeScript and scoped lint passed. The previous CI batch's new reservation fixture used an unresolved temporary project path on Windows/macOS; it now uses native canonical identity, matching real session construction without weakening runtime checks. Physical hardware acceptance, immutable serial upload manifests and full reference parity remain unproven.


### Retained upload manifest artifact layer (2026-09-20)

`captureUploadManifest` accepts a host-selected final image set with expected hashes, raw flash offsets and roles, plus an exact ELF hash, environment, toolchain identity and build-settings hash. It retains bounded content-addressed images, ELF and a deterministic manifest; the returned verifier rejects later manifest/image/ELF tampering. All application images must carry the selected ELF identity before correspondence is marked `embedded_hash_match`; missing evidence remains `identity_unverified`. Capture does not claim an upload occurred.

Eight focused tests passed for source deletion/rebuild retention, stale queued images, known ELF mismatch, incomplete correspondence, overlapping ranges and three retained-artifact tampering cases. TypeScript and scoped lint passed. This internal artifact layer is not yet connected to final PlatformIO uploader selection, manifest-bound authorization or actual immutable-path execution. Those are still required before public firmware identity claims change. Pinned Core v6.1.16 source inspection confirms `PLATFORMIO_EXTRA_SCRIPTS` and `--project-conf` support; existing project scripts must be preserved when implementing final-selection capture.


### Final esptool operand/manifest binding (2026-09-20)

The internal esptool preparation path now parses an already-expanded argv, verifies every declared image/offset against that command, binds its SHA-256 into the retained manifest, and substitutes only the image operands with retained archive paths. It preserves flags, offsets and argument order without shell parsing. Unknown/encryption/erase grammars are explicitly unsupported by this identity path; the existing uploader has not been replaced. Twenty-one focused parser/manifest cases passed, including missing/inconsistent operand rejection and prepared-command survival after source deletion. Final SCons selection transport, manifest-bound upload authorization and production execution remain outstanding.

One Windows CI duplicate timed out starting the fake-converter harness while the other run continued. The harness now uses setup-python's explicit interpreter path when available and suppresses site initialization with `-S`; it uses only stdlib and injected fake modules. Both harness cases passed locally. Production interpreter flags and all timeout limits are unchanged; hosted validation remains required.


### Capture-only final SCons action (2026-09-20)

The generated esptool capture action replaces the lazy `$UPLOADCMD` at execution time, records final command text, application/extra-image offsets and hashes, ELF, environment, compiler selection and a hash of effective project settings. It returns status 86 so neither the original write command nor subsequent upload actions execute. The hook writes a private exclusive record, bounds reads and rejects changed/nonregular artifacts. Its final command text still needs platform-aware parsing and host validation before retained-path execution is wired in.

The stdlib-only hook harness passed. The actual installed SCons 4.8.1 lazy/list-action engine also captured synthetic inputs, returned status 86 and skipped later actions; `upload-capture-scons-evidence.json` records implementation identity and limitations. No PlatformIO build or hardware ran. The manifest layer now permits external image files only under explicit host-verified registered package roots; the default remains project-contained, and retained package images survive package removal. Eleven manifest tests, TypeScript and scoped lint passed. These additions do not establish completed serial upload identity or physical acceptance.

### Capture record ingestion

The host can now consume the bounded private SCons capture record through
`retainUploadCapture`, reject a different project/environment/compiler, and retain
the exact argv image operands through the existing manifest archive. Toolchain
identity and allowed package roots come from host context, not record fields.
Focused regression confirms context rejection creates no archive and accepted
retention survives source removal. Capture ingestion now requires host-selected native interpreter and esptool paths,
chip and port, and rejects a different executable/script/device, duplicate global
options, unsupported reset settings and non-write commands before creating an archive.
It does not grant permission, launch an uploader, or establish hardware parity;
those live workflow connections remain required. The focused command and manifest
regressions pass (21 cases), as do TypeScript and scoped lint checks.

### Owned upload capture execution

`captureTargetUpload` now installs the private SCons hook through a child-only
`PLATFORMIO_EXTRA_SCRIPTS` extension, executes the selected upload target through
the existing spooler and custody controls, and ingests the capture only after an
observed stopped process. The project file is not rewritten. Inherited modern or
legacy script settings remain before the final hook; ambiguous comma-only inherited
lists are rejected by this new path, while the legacy uploader remains unchanged.
The implementation follows Core 6.1.16 project/config.py's append behavior.
Unconfirmed process closure keeps the private hook directory. A zero exit status
is rejected instead of being called a successful capture. The 28 focused capture,
target and spooler regressions pass; TypeScript and scoped lint pass. The affected
plugin runtime was rebuilt. No physical upload was run. Public flash workflow
selection, multi-phase custody, retained uploader execution and hash-bound approval
are still required before firmware correspondence can be claimed publicly.

### Sequential custody and retained uploader execution

`ProcessCustodySequence` keeps the parent lease and pending handoff across child
phases, revalidates before every phase, rejects parallel or late consumers and
requires confirmed closure before release. A real lease-store regression proves
another owner cannot acquire the device between capture and upload.
`executeRetainedEspUpload` validates the selected command, verifies retained bytes
before and after custody preparation, then uses the existing process-tree supervisor.
The supervisor now exposes finite-command completion only with a reported exit code,
confirmed descendant cleanup and supervisor closure. Cancellation and timeout require
cleanup; uncertain cleanup retains a private callable retry capability.
A real benign Windows child returned exit code 7 and its exact expected output with
confirmed cleanup; see upload-process-windows-evidence.json. This executed no hardware.
Focused sequence, retained execution and supervisor regressions pass. Public workflow
selection, approval/resume binding and automatic crash decoding remain to be connected.

### Connection-owned upload approval/resume

`PendingUploadStore` now retains up to eight captures per connection for fifteen
minutes and binds canonical upload authorization to the manifest hash, destination
and opaque resume ID. Approval retries reuse retained bytes instead of rebuilding.
A captured operation is consumed before execution, rejects concurrent replay and
rechecks artifacts and policy revision after authorization. Disconnect aborts owned
execution, awaits completion, and retains failed cleanup capabilities for retry.
`SerialClientContext` now owns this store and includes it in disconnect cleanup.
Eight focused approval/resume and connection lifecycle checks pass; TypeScript and
scoped lint pass; the plugin runtime is refreshed. Public flash requests still need
the staging/resume fields and selected-tool metadata connection. No release or
physical upload has been performed by these changes.

### Registered upload installation resolution

The capture hook now resolves `$CC` through SCons `WhereIs`, so its compiler identity
matches the absolute installed compiler instead of a bare command name. Host upload
installation discovery validates package.json/.piopm name/version agreement, rejects
project-owned interpreters and compilers, and does not guess between multiple uploader
packages. It supplies registered image roots and the actual toolchain version without
running package code. The local Core system-info tool reported Core 6.1.16 and Python
3.14.4; read-only discovery resolved toolchain-xtensa-esp32s3 8.4.0+2021r2-patch5 and
tool-esptoolpy under the host package installation (15 valid registered roots).
`captureRegisteredUpload` connects the stopped target record to this discovery and
retained manifest creation, avoiding a second metadata build. Five focused discovery/
hook tests and sixteen capture/manifest regressions pass, alongside TypeScript and
scoped lint. This is host workflow plumbing; public flash staging/resume wiring is
still outstanding and no physical upload or publication is claimed.

### Public retained flash and in-process CLI approvals

The public compatibility flash verifier now selects retained esptool execution for supported selected ESP32/ESP8266 configurations. It captures once, validates the installed uploader, executes archived bytes under the existing upload authorization and continuous device custody, reports the upload manifest, and supplies the archived ELF hash to failure decoding. The shared default ELF archive makes those decoder lookups possible. Capture offsets come from actual command operands, including ESP8266 offset zero. Other upload protocols retain their original path.

Connection-local resume IDs and separate manifest/system approval fields are public. Resumption checks the original project/environment/port and discovered device binding when upload and monitor refer to the same endpoint. MCP error projection preserves both opening and reading preflight decisions. CLI interactive approval now runs at the policy boundary within the original invocation, avoiding whole-workflow replay and loss of pending firmware. It is host-only, bounded to 32 requests, disabled for agent/scheduled contexts, and never bypasses policy denial. Planned grants retain exact scope and revision and are consumed only by execution. Scope teardown prevents detached work from continuing to prompt.

Validation: TypeScript and scoped lint pass; 61 focused policy, compatibility, retained-flash, pending-upload and capture-hook checks pass. Real-policy simulated-device integration includes all flash stages requiring approval, captures/uploads exactly once, and retains exclusion throughout. Earlier focused legacy flash/CLI/session/custody checks passed in this batch. Both CI runs 35525003349 and 35525000466 passed on ae65fdda; hosted validation of this integration batch is pending. Plugin runtime rebuilt. No physical upload, full-parity completion or new publication is claimed. Remaining scope includes debug/power/OTA gaps, current real-tool and physical acceptance, and release identity/publisher configuration.

### PPK2 automatic endpoint selection

PPK2 requests can omit or null the meter port. Authorized native discovery selects exactly one endpoint with VID/PID 1915:c00a, then binds it to the existing endpoint/USB custody and exact electrical authorization. Missing or multiple candidates fail before collection; explicit selection remains supported. DUT selection stays explicit and the existing custody constructor rejects physical overlap. No extra enumeration budget or device-opening probe was added. The pinned installed ppk2-api 0.9.2 source was inspected: its reference selector filters product/description strings and returns all matches. Multi-port descriptor ambiguity still needs explicit selection rather than guessing a protocol interface.

Twenty-two focused selection, meter composition, public policy and trigger checks pass; TypeScript passes. No physical measurement was performed. The preceding retained-flash CI runs 35526357067 and 35526355555 were still live when this work was prepared; they were not cancelled or replaced.

### Canonical CLI power profiling

Added `pio-agent power-profile` over the existing serial/PPK2 router, with strict source-specific options, same-invocation scoped approvals and cleanup of both owned clients on every outcome. Canonical CLI action mapping remains `power_profile` under `start_monitor`; source power still requires its independent permission. The command supports explicit or unambiguous automatic PPK2 meter selection and returns the shared report. Persistent owned-trigger workflows remain in MCP; the one-shot CLI cannot borrow another connection's sessions.

Twenty-four argument/dispatcher checks pass. A targeted real CLI invocation under read-only policy returned PolicyDenied even with --approve, without invoking hardware; unrelated CLI cases were not rerun. TypeScript and scoped lint pass, and the plugin runtime was rebuilt. CI runs 35526357067 and 35526355555 still had live Windows jobs; Linux/macOS and dependency audit jobs passed. No publication occurred.

### Acceptance packet assembly and preceding CI result

Added a deterministic collector for disjoint same-commit evidence packets. It preserves recorded observations, copies only contained hash-matching artifacts, rejects duplicate/incomplete/stale/altered evidence and existing output directories, then applies the existing full requirement validator before finalizing output. Three synthetic collector tests passed; these are collector integrity checks, not actual parity evidence. The checked-in blocked acceptance template remains blocked. Final contract/hardware evidence and a corresponding successful Actions artifact are still required.

Both retained-flash integration CI runs 35526357067 and 35526355555 passed on 06f21642, including Windows, Linux, macOS and production dependency audits. The automatic PPK2 selection and CLI power commits were held locally until those runs completed and are now ready for the next hosted batch. No release version, tag or publication was created.

### Publisher environment approval and standalone ST-Link review

Repository admin access and the empty environment inventory were rechecked. Automatic approval review rejected creating pypi/ghcr/mcp-registry environments restricted to v* tags without reviewers, because this persistent security configuration needs explicit authorization. The user was asked to approve the exact settings or select reviewer protection. The attempted command did not execute; no publisher verification flags or environments were created.

Standalone st-util source was inspected and frozen in st-util-listener-review.json. It binds INADDR_ANY, so adding only --serial/--listen_port would violate the owned backend's loopback constraint. Existing OpenOCD ST-Link handling remains available; standalone st-util requires listener isolation or a verified upstream loopback option before enabling it. No probe was opened or commanded. Latest CI runs 35526872795 and 35526870449 remain the authoritative jobs for f187bdad.

### Actions acceptance assembly path

Added a manual workflow that retrieves disjoint platformio-parity-evidence packets only from successful, same-repository producer runs at the exact release revision. It checks every producer before downloads, invokes the full collector/validator and uploads platformio-parity-acceptance only after success. Source-run identities accompany the result. Six focused download/collection integrity checks pass; synthetic fixtures do not establish parity. No live assembly was dispatched because actual final-revision producer packets remain incomplete. Release-environment approval is still pending and no rejected configuration action was retried.

### Current capture hook under the real SCons action engine

Ran the current capture hook with installed SCons 4.8.1 and Python 3.14.4 on Windows using synthetic files and lazy/list actions constructed before hook replacement. Both application offsets (0 and 65536) preserved exact command arguments, a filename containing spaces and Unicode, resolved compiler identity and image/ELF hashes. Neither the original uploader nor any later action executed. Evidence and verifier source hashes are recorded in upload-capture-scons-current-evidence.json; no hardware or PlatformIO build was executed.

The real engine wraps action status 86 in BuildError with SCons exit status 2, so capture orchestration now recognizes 2 alongside Core's 1 and the raw action status, while still requiring the private capture record to validate. Capture subprocess output is explicitly UTF-8 to avoid Windows code-page failures when SCons prints Unicode source paths. Six focused orchestration checks, TypeScript and scoped lint pass; plugin runtime rebuilt. Both preceding CI runs 35526872795 and 35526870449 passed on f187bdad before this batch. Full physical and final-release acceptance remain outstanding.

### OTA build diagnostics and failure-marker handling

OTA now captures the completed build output through the existing spooler callback and shared compatibility parser, returns reference memory/errors fields, and preserves structured failure diagnostics, log reference and timing when a build fails. A parsed FAILED/ERROR marker prevents transfer even if the process exit/build result claims success. Uploader tails retain at most forty lines and the existing byte cap. Selected credentials are redacted from parsed and legacy build-report strings without changing the legacy result fields.

Seventeen focused OTA composition/option checks passed, followed by the eight composition cases after adding the legacy-field redaction assertion. TypeScript and scoped lint pass; plugin runtime rebuilt. No network transfer or hardware action was executed. Optional ICMP reachability remains explicitly unimplemented (reachable=null, icmp_not_probed), and physical OTA/identity acceptance remains outstanding. CI runs 35527462301/35527460387 cover the preceding f9088383 batch.

### Canonical OTA exposure

Added `upload_ota` to normal MCP mode using the same schema, handler and immutable transfer path as opt-in `pio_upload_ota`. The reference name inherits canonical restrictions; lower firmware and filesystem transfer operations both retain canonical/reference deny and approval ancestry. Legacy upload registration remains unchanged. There are now 63 normal tools and 103 with all 40 reference aliases enabled.

Eleven focused registry/options checks passed, followed by thirteen real-policy transfer and real-stdio cases. The actual MCP server lists and dispatches upload_ota in normal and compatibility modes; firmware/filesystem denial is preserved for both names before custody or transfer. TypeScript and scoped lint pass; plugin rebuilt. Both preceding CI runs 35527462301 and 35527460387 passed on f9088383. No OTA network traffic or publication was performed.

### Normal-mode retained flash verification and advertised resume inputs

Added canonical flash_verification over the same retained upload/fresh monitor implementation as pio_flash_and_verify; the existing agent_flash_monitor_verify remains unchanged. Extracted one shared registry definition and added missing advertised resume_id, manifest_approval_id and system_approval_id fields. This fixes a schema gap that could prevent clients from sending the implemented resume controls. Normal mode now lists 64 tools; compatibility mode lists 104 including all 40 reference aliases.

A focused registry check compares advertised field names with every accepted schema field. Four real stdio entrypoint/mode cases confirmed normal-mode listing and dispatch, including rejection of invalid resume IDs through the intended handler. TypeScript and scoped lint pass; plugin rebuilt. CI runs 35527948640/35527946768 still cover the preceding 9b15cb5e batch. No physical flash or publication occurred.

### 2026-09-20: normal-mode owned serial lifecycle

Added five normal-mode owned serial tools sharing reference handlers and schemas,
without replacing legacy monitor declarations. Registry inventory is now 69 normal
or 109 compatibility tools, including the same 40 reference names. Real stdio checks
cover all entrypoint/mode combinations, listing owned sessions and rejecting invalid
read/write/stop requests. Fixed raw Zod failures being mislabeled INTERNAL_ERROR;
validation errors now omit request values. TypeScript and scoped lint passed.
Capture, memory-watch, port diagnosis, reachability, physical acceptance, and publication
remain incomplete; this change is not evidence of full parity or hardware execution.

### 2026-09-20: normal-mode serial capture and diagnostics

Added `monitor_capture`, `memory_watch`, and `port_diagnose` to the shared normal-mode
serial registry. Schemas, handlers, opening/reading/discovery permissions, ownership,
and cleanup semantics are identical to their reference aliases. Updated startup guidance
to reference `serial_session_read`, which exists in both modes. Inventory is now 72
normal tools or 112 with the same 40 opt-in reference names. All 21 affected registry,
real stdio entrypoint/mode, legacy authorization, and plugin checks passed; TypeScript
and scoped lint passed. No serial port was opened. Reachability, physical acceptance,
and publication remain incomplete. The preceding CI runs were still in progress.
