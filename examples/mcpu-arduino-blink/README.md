# mcpu-arduino-blink

Minimal template showing how to prepare a PlatformIO firmware project for MCP-U integration.

This template does **not** include third-party MCP-U code. It is a build/flash scaffold only.

## Use with PlatformIO-MCP

```bash
npx platformio-mcp agent-validate --project-dir ./examples/mcpu-arduino-blink
npx platformio-mcp agent-build-diagnose --project-dir ./examples/mcpu-arduino-blink
npx platformio-mcp agent-flash-monitor-verify --project-dir ./examples/mcpu-arduino-blink --expect-all MCPU_TEMPLATE_BOOT --timeout 45
```

When your MCP-U dependency is available, add it to `lib_deps` in `platformio.ini` and replace placeholder logic in `src/main.cpp`.
