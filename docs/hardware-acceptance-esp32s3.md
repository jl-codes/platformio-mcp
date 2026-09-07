# ESP32-S3 Physical Usability Acceptance Record

## Record scope

- Record ID: `ESP32S3-FURBY-2026-09-07`
- Recorded: 2026-09-07 (`America/Los_Angeles`)
- Source: the user-designated Codex task `Flash Codex logo on ESP32-S3`
- Purpose: satisfy the initial-release requirement for one real-board usability record without disturbing a working display installation
- Project location: intentionally omitted from public evidence
- Serial port and stable device identity: `[REDACTED]`

This record combines an earlier, user-authorized physical upload from the source task with a current non-hardware-changing check through the self-contained 42-tool plugin runtime. The current check did not rebuild or upload firmware and did not change GPIO, the display, peripherals, firmware source, assets, PlatformIO configuration, monitor ownership, or approval state. Normal plugin-owned audit/history observations and transient registry lock metadata were permitted.

## Target

| Field | Accepted value |
| --- | --- |
| Board class | Lonely Binary ESP32-S3-WROOM-1 N16R8 |
| PlatformIO board | `esp32-s3-devkitc-1` with project-owned 16 MB flash, QIO/OPI, and PSRAM overrides |
| Environment | `lonelybinary_esp32s3` |
| Connection | CH340K UART; port, serial number, physical location, and fingerprint redacted |
| Plugin/package | `platformio-mcp` 2.2.2 |
| PlatformIO Core | 6.1.16 |
| Safety boundary | Preserve the working display and firmware; no new firmware/configuration write, reset, monitor mutation, GPIO change, or peripheral activation |

## Historical physical evidence

The source task contains the following completed physical-board evidence:

- the firmware built successfully at approximately 1.50 MB flash and 43 KB RAM;
- the user explicitly requested the upload after connecting the board;
- PlatformIO MCP uploaded to the exact `lonelybinary_esp32s3` environment through its managed hardware path;
- every written region passed SHA verification;
- esptool identified an ESP32-S3 revision 0.2 with 8 MB embedded PSRAM;
- the USB serial endpoint disappeared during reset and subsequently re-enumerated;
- a bounded serial read captured `Display initialized; Codex splash is active.`; and
- the user later confirmed that the physical screen is working.

The accepted record does not claim that a crash was deliberately injected. No panic, watchdog reset, or boot loop was reported in the preserved run, but destructive fault injection was outside this usability gate.

## Current bundled-plugin check

The repository-built plugin runtime was launched through its packaged launcher and queried only with non-hardware-changing tools. Sensitive values were used for exact matching but were not copied into this record.

| Check | Result |
| --- | --- |
| Public MCP registry | PASS — 42 tools loaded, including policy, exact-target, monitor, task-history, approval, composite flash/verify, and monitoring-health primitives |
| Project and environment | PASS — the designated project and `lonelybinary_esp32s3` environment were recognized |
| Device discovery | PASS — the designated connected endpoint was present |
| Exact target resolution | PASS — `exact` confidence for `esp32-s3-devkitc-1` and `lonelybinary_esp32s3` |
| Write-safety binding | PASS — a short-lived target binding was issued and remained valid for the check; digest and fingerprint omitted |
| Policy | PASS — effective profile was `flash_requires_approval` |
| Task/history visibility | PASS — project-scoped history was readable and no task was running |
| Approval state | PASS — no pending approval remained |
| Cleanup | PASS — no hardware lock or active monitor remained in the checking runtime; transient registry locking completed normally |

The earlier source-task process reported an existing project-owned monitor claim and an empty bounded log query. It was not started, stopped, or altered. The current bundled runtime reported no active monitor record, which is consistent with leaving no monitor owned by this acceptance check.

## Acceptance decision

| Gate | Decision |
| --- | --- |
| Historical build | PASS |
| Historical user-authorized flash | PASS |
| SHA verification | PASS |
| USB re-enumeration | PASS |
| Serial boot assertion | PASS |
| Physical display usability | PASS — user confirmed |
| Current 42-tool plugin startup and discovery | PASS |
| Current exact-target and approval-policy integration | PASS |
| Current resource cleanup | PASS |
| Fresh flash through this exact bundled runtime | NOT RUN — prohibited by the acceptance safety boundary |
| Deliberate crash-pattern injection | NOT RUN — outside the non-invasive usability gate |

**Decision:** accepted as the required one-board physical usability record for the initial Codex plugin release. It demonstrates a successful real ESP32-S3 build/upload/reconnect/runtime path and bridges that hardware evidence to the current bundled plugin's exact-target, policy, history, and cleanup surfaces. It is not evidence for RP2040, STM32, or Arduino-class rows, and it does not replace a future fresh `hardware-e2e.yml` run when those fixtures are available.

## Privacy and retention

This document intentionally excludes the external project path, user directory, executable path, serial port, hardware ID, USB location, device fingerprint, target-binding digest, task IDs, raw logs, and launch/session credentials. The full source task and raw project-local history remain local to the operator.
