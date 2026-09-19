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
