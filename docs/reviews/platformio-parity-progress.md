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
