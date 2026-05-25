# esp32-bad-gpio-audit

This demo intentionally uses GPIO12 (an ESP32 strapping pin) so `agent_safe_pin_audit` can flag it.

## Run the Audit

```bash
npx platformio-mcp agent-safe-pin-audit --project-dir ./examples/esp32-bad-gpio-audit --board esp32dev --json
```

## Expected Finding

- `pin: 12`
- `severity: high`
- reason mentions ESP32 strapping/boot risk
- recommendation suggests safer alternatives such as GPIO25/26/27

## Recommended Patch

Change:

```cpp
#define LED_PIN 12
```

To:

```cpp
#define LED_PIN 25
```
