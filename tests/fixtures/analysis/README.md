# Real firmware analysis fixture

`esp32s3` is repository-owned source for compiler acceptance, not a physical crash capture. It targets the discovered `esp32-s3-devkitc-1` board with Espressif32 7.0.1 and debug information. No upload, monitor, or device is required.

## Reproduction

1. Install repository dependencies and the pinned PlatformIO platform/toolchain. Select the exact `analysis-esp32s3` environment.
2. Following the repository pio-manager skill, call MCP `get_project_config`, then `build_project` with the absolute fixture directory, `environment: "analysis-esp32s3"`, and `background: true`. Poll the returned task ID to success. Do not substitute a previous build after failure.
3. Run the verification script with an explicit compiler path and its trusted package root:

```text
node --import tsx scripts/verify-analysis-fixture.ts <absolute-fixture-directory> <absolute-xtensa-esp32s3-elf-gcc-path> <absolute-toolchain-package-root> <evidence-json-path>
```

The verifier fails if required inputs or tools are unavailable; it does not skip acceptance. It checks real GNU output, exact source symbol/line resolution, retained unknown frames, ELF hashes, rejection of a wrong hash, symbol counts/ranking, and source attribution. It never flashes hardware. Arguments are supplied by the operator running this acceptance script, not exposed as trusted roots in a public tool schema.

The checked-in Windows evidence records one observed build. ELF hashes can change with absolute debug paths and compiler versions; each run records its own identity. Generated `.pio` files are ignored and the ELF is not redistributed. Framework/toolchain license terms remain applicable to locally built artifacts.

## Limits

The observed PlatformIO build reported static RAM 18,040 bytes and program flash 233,161 bytes. GNU Berkeley totals instead estimated RAM 226,981 and flash 233,417 bytes because generic section accounting is not the board-specific allocation calculation. The report must not present these estimates as PlatformIO usage or partition capacity. Correct board/load-segment/partition accounting remains a separate acceptance requirement.

This fixture establishes Windows x64 / Xtensa GNU interoperability only. Cortex-M, other host systems, retained upload identity, and physical device crash acceptance are still required by the implementation plan.
