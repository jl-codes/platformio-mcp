# Firmware analysis tools

`decode_backtrace` and `size_report` are canonical MCP tools. Both require an explicit `projectDir` and `environment`. They collect fresh PlatformIO metadata, which can execute project build scripts, so they require build permission and are not annotated read-only. They do not flash a device.

- `decode_backtrace` accepts `text` (up to 1 MiB UTF-8), optional `includeAllHex`, and optional `expectedElfSha256`. It returns resolved and unresolved frames, source locations and the exact ELF identity. `flashedFirmwareVerified` remains false: a current build artifact alone does not establish device contents.
- `size_report` accepts optional `top` (1–1,000, default 25), `filter` (bounded case-insensitive regex), and `expectedElfSha256`. It reports PlatformIO RAM/Flash accounting separately from GNU totals and symbol attribution. Filtering affects symbols/files, not whole-image totals.

Both accept `approvalId` when server policy requires approval. The complete request is bound to one build approval; internal metadata and size-check stages do not consume it twice. Policy changes between stages stop execution. System-info inspection retains its own server-policy check.

Compiler roots are discovered from the host installation or explicit operator launch configuration described in policy-sources.md. Public arguments cannot supply compiler paths, trust roots or memory evidence. Analysis utilities use a hash-verified temporary ELF copy; file changes during size collection are rejected.

## Acceptance and current limits

Windows x64 end-to-end acceptance against the repository-owned ESP32-S3 fixture is recorded in reviews/analysis-mcp-windows-evidence.json. Reproduce after building the fixture through MCP:

```text
node --import tsx scripts/verify-analysis-mcp.ts tests/fixtures/analysis/esp32s3 <output-evidence.json>
```

The verifier uses MCP stdio for project configuration, fresh metadata/size checking and crash decoding. It does not substitute mocks or skip missing prerequisites.

Reference-named Python compatibility aliases, session-based crash input, default-project/environment resolution, retained build/upload manifests and shared artifact locks are still pending. These two tools do not establish completion of the 40-tool compatibility plan or physical-device acceptance.

## CLI

```text
pio-agent decode-backtrace --project-dir <project> --environment <env> --text-file <crash-log> --json
pio-agent size-report --project-dir <project> --environment <env> --top 25 --filter <regex> --json
```

Crash decoding accepts exactly one of `--text` or `--text-file`; file reads are bounded to 1 MiB. `--include-all-hex` enables additional address extraction. Both commands accept `--expected-elf-sha256` and `--approval-id`. JSON mode returns a structured approval error without prompting unless the operator explicitly supplies `--approve`; interactive mode uses the existing CLI confirmation. Approval retry occurs once with the same normalized request. This local operator surface is not a proof of human identity against an unrestricted same-user process.
