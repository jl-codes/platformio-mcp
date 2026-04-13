# Embedded Development Safety Rules

These rules apply to all PlatformIO embedded development tasks.

## GPIO Safety — Prevent Hardware Damage

**Before writing ANY code that configures or drives GPIO pins:**

- **Never set two electrically connected pins as OUTPUT simultaneously.** This creates a short circuit that can destroy the MCU or connected components. Always verify the schematic or wiring before configuring pin directions.
- **Always call `pinMode()` before `digitalWrite()` or `analogWrite()`.** Writing to a pin without setting its mode leads to undefined behavior and potential damage.
- **Never drive an OUTPUT pin directly into VCC or GND** without a current-limiting resistor (minimum 220Ω for LEDs, appropriate values for other loads). Calculate current draw: `I = V / R`. Most GPIO pins source/sink ≤ 20mA (AVR) or ≤ 40mA (ESP32).
- **Do not reconfigure I2C (SDA/SCL) or SPI (MOSI/MISO/SCK/CS) pins as GPIO** unless you have explicitly confirmed those buses are not in use. Bus conflicts can damage connected peripherals.
- **Always use pull-up or pull-down resistors on input pins** (or enable internal pull-ups via `INPUT_PULLUP`). Floating inputs cause erratic behavior and increased power consumption.
- **Never exceed the MCU's absolute maximum voltage rating on any pin.** Most 3.3V MCUs (ESP32, STM32, nRF52) are NOT 5V tolerant. Use level shifters when interfacing with 5V logic.
- **Check for PWM timer conflicts** on ESP32: pins sharing the same timer cannot independently generate different PWM frequencies.
- **ADC pins driven as digital outputs** can damage the analog front-end on some MCUs. Verify the datasheet before repurposing ADC-capable pins.

## Pin Assignment Discipline

- **Document every pin assignment** in a comment block at the top of the main source file or in a dedicated `pins.h` header. Example:
  ```cpp
  // Pin Assignments
  // GPIO 2  - OUTPUT - Onboard LED
  // GPIO 4  - INPUT_PULLUP - Button
  // GPIO 21 - SDA (I2C)
  // GPIO 22 - SCL (I2C)
  ```
- **Never use magic numbers for pins.** Define all pins as named constants (`constexpr` or `#define`).
- **When reviewing or modifying GPIO code, always cross-reference the pin assignment table** to check for conflicts before making changes.

## Build and Upload Discipline

- **Always build successfully before uploading.** Never flash stale or broken firmware.
- **Verify the target board matches the connected device** before uploading. Flashing wrong firmware can brick bootloaders.
- **Check the serial port** with `list_devices` before uploading if there's any ambiguity about which device is connected.
- **After uploading, verify the device is functioning** via serial monitor or observable behavior before declaring success.

## PlatformIO Conventions

- **`platformio.ini` is the source of truth** for board targets, frameworks, library dependencies, and build flags. Always check it before making assumptions.
- **Use environment names that describe the board** (e.g., `[env:esp32dev]`, `[env:nano_every]`), not generic names like `[env:default]`.
- **Pin libraries in `platformio.ini`** with version constraints (e.g., `lib_deps = ArduinoJson@^6.21.0`) to ensure reproducible builds.
- **Use `lib_ldf_mode = deep+` in `platformio.ini`** when libraries fail to resolve — this enables deep dependency scanning.

## Code Quality for Embedded

- **Avoid `String` class on AVR/small MCUs** — use `char[]` and `snprintf` to prevent heap fragmentation.
- **Avoid `delay()`** in production code — use non-blocking patterns with `millis()`.
- **Always check return values** from `Wire.endTransmission()`, `Serial.begin()`, and similar I/O functions.
- **Use `volatile` for variables shared between ISRs and main code.**
- **Keep ISR handlers minimal** — set a flag, don't do I/O or allocations inside interrupts.
