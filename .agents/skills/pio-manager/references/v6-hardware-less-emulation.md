# PlatformIO v6 Hardware-less Emulation & Testing

If the user requests you write unit tests or validate project logic, but **no physical device is plugged in** (or `mcp_platformio_list_devices` returns empty), do not abandon the task. PlatformIO v6 supports hardware-less environments and simulators (like Native host compilers or Renode) to run standard C++ tests completely inside a local virtual boundary.

**Reference Documentation:** 
- [PlatformIO Unit Testing Guide](https://docs.platformio.org/en/latest/advanced/unit-testing/index.html)
- [PlatformIO Simulators](https://docs.platformio.org/en/latest/advanced/unit-testing/simulators/index.html)

### Architectural Rules
1. **The `test_` Hierarchy**: Ensure your C++ tests are strictly placed in a subdirectory prefixed with `test_` (e.g., `test_main/`, `test_sensors/`). The CLI will ignore unit tests placed loosely in root. (Since PlatformIO v6).
2. **Injecting Emulator Environments**: Using standard file modification tools, cleanly append an emulation environment to the user's `platformio.ini` file if one does not exist.

**Example `platformio.ini` Emulator Setup:**
```ini
; Standard physical board (Ignores tests unless physical port is open)
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino

; Emulated Environment (Executes tests on Native x86/ARM host)
[env:native]
platform = native
test_framework = googletest
test_filter = common/* native/*
```

After modifying the configuration to include a native or simulated env block, execute `mcp_platformio_run_tests` passing `native` as the specific environment parameter. The MCP will seamlessly compile and run the logic on the host CPU or VM emulator.
