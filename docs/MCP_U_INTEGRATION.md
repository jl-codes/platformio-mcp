# MCP-U Integration Template

PlatformIO-MCP can compile and flash firmware that includes the MCP-U Arduino library workflow pattern.

This repository includes a starter template at:

- `examples/mcpu-arduino-blink/`

## Scope

Current scope is build/flash preparation. Live runtime MCP-U command routing is intentionally out of scope for this release.

## What You Can Do Now

1. Open the template project directory.
2. Build with `build_project` (or `agent_build_diagnose`).
3. Flash with `upload_firmware` (or `agent_flash_monitor_verify`).
4. Observe runtime markers in serial output.

## Recommended Flow

```text
agent_validate_project -> agent_build_diagnose -> agent_flash_monitor_verify
```

## Runtime Vision

Once firmware with MCP-U support is flashed, an external runtime controller can drive device features (GPIO/PWM/ADC) through MCP-U semantics while PlatformIO-MCP continues to provide:
- compile/flash control
- diagnostics
- policy/approval gates
- serial verification and reporting

This separation keeps hardware execution transparent and extensible.
