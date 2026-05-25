# esp32-serial-verify

This demo prints `BOOT_OK` and periodic `HEARTBEAT` for runtime verification.

## Verify Flash + Runtime

```bash
npx platformio-mcp agent-flash-monitor-verify \
  --project-dir ./examples/esp32-serial-verify \
  --expect-all BOOT_OK \
  --reject-patterns "Guru Meditation,Brownout detector,WDT reset" \
  --timeout 45 \
  --stability-window 10 \
  --json
```

## Expected Success Case

- `flashSuccess: true`
- `monitorSuccess: true`
- `verificationStatus: "passed"`
- `matchedExpectations` includes `BOOT_OK`
- `rejectedPatterns` is empty

## Typical Failure Cases

- Missing `BOOT_OK` print: `verificationStatus` becomes `failed` with unmatched expectations.
- Runtime panic/brownout/watchdog line appears: rejected patterns and runtime failures are reported.
- No serial output: `detectedRuntimeErrors` includes `NoSerialOutput`.
