# OTA Implementation Patterns & Anti-Patterns

Over-the-Air (OTA) updates are a critical architectural component for embedded systems, but if poorly designed, they can permanently "brick" devices remotely. A secure, resilient OTA pipeline requires careful state-machine design, hardware rollback protection, and cryptographic verification.

This reference provides established design patterns and critical anti-patterns, drawing heavily from robust ESP-IDF architectures.

## 1. Architectural OTA Patterns

### Dual-Slot (A/B) Update State Machine
A reliable OTA implementation never overwrites the active binary in place. It relies on a "Dual-Slot" partition table (e.g., `ota_0` and `ota_1`) and an `otadata` control partition. 

The firmware lifecycle transitions through explicit states in the `otadata` partition:
1. **ESP_OTA_IMG_NEW**: An update has been downloaded to the inactive slot but has not been executed yet.
2. **ESP_OTA_IMG_PENDING_VERIFY**: The device reboots into the new slot for the first time. The bootloader marks this as a strict test run.
3. **ESP_OTA_IMG_VALID**: The new firmware confirms its own stability, finalizing the update.
4. **ESP_OTA_IMG_ABORTED**: The firmware crashed during `PENDING_VERIFY`, triggering an automatic hardware rollback.

### The "Transactional Blessing" (esp_ota_mark_app_valid)
The application must perform a "Self-Test" immediately following the first boot of a new firmware version. This forms a transactional barrier.
- **Diagnostics Check**: Upon startup, the application verifies it can initialize core hardware, connect to Wi-Fi, and load configurations.
- **The Blessing**: If diagnostics pass, the application explicitly calls `esp_ota_mark_app_valid_cancel_rollback()` to permanently lock in the new version.
- **The Rollback**: If the device crashes (e.g., Watchdog Timer expiration, panic) *before* reaching this call, the bootloader automatically reverts to the previously working slot on the next boot, saving the device.

### Detached Signature Handshake (Pre-Flight)
To save bandwidth, memory, and power, the system should evaluate a lightweight detached signature (`firmware.sig`) or metadata manifest *before* attempting the heavyweight `.bin` download. 
By assessing the current version, target version, and cryptographic hash pre-flight, the device safely rejects downgrades or incompatible architectures early.

### Streaming Memory Verification
When downloading the bulk `firmware.bin`, avoid buffering massive chunks into the heap. Instead:
- Use streaming cryptographic contexts (like `mbedtls_md_context_t`).
- Read the incoming network bytestream in small (e.g., 512-byte) chunks.
- Pass each chunk directly through the hashing algorithm and write it straight to the inactive flash partition.
- Once the stream completes, finalize the hash and verify the RSA signature before flipping the active boot partition flag.

---

## 2. Critical Anti-Patterns (What NOT to do)

### The "Blind Trust" Flash
**Anti-Pattern**: Writing incoming bytes directly to the flash partition over plain HTTP without verifying the payload's origin or integrity.
**Consequence**: Exposes the entire fleet to malicious firmware injection and remote takeover via Man-in-the-Middle (MitM) attacks. Every byte must be authenticated (e.g., via Ed25519 or RSA-2048).

### Lack of Auto-Rollback
**Anti-Pattern**: Forcing the user or a separate watchdog script to manually manage partition flips, or assuming updates will always succeed.
**Consequence**: If the new firmware fails to initialize the Wi-Fi stack or WebServer, the device is permanently unreachable. A hardware-level backstop (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`) is mandatory.

### "Post-Hoc" OTA
**Anti-Pattern**: Treating OTA as an "add-on" software feature built late in development rather than a fundamental hardware constraint.
**Consequence**: Leads to inadequate flash memory allocation, missing `otadata` partitions, or insufficient RAM to handle TLS decryption alongside standard application loads.

### Ignoring Network Realities
**Anti-Pattern**: Designing the update pipeline assuming perfect, high-speed Wi-Fi and permanent wall-power.
**Consequence**: Power loss mid-flash or unexpected network saturation causes corruption. The system must tolerate abruptly dropped connections without corrupting the active `app0` partition.

---

## 3. ESP-IDF Implementation (Arduino Hybrid)

When building OTA on ESP32, standard Arduino `build_flags` cannot alter the bootloader's rollback mechanisms. 

To activate the true state-machine rollback described above, you must map your PlatformIO environment to run the `espidf` framework alongside `arduino` as a component to access `sdkconfig`.

**Required Kconfig Settings (`sdkconfig.defaults`)**
```ini
CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y
```

**Required Application Implementation (`main.cpp`)**
```cpp
#include <esp_ota_ops.h>

void setup() {
  // 1. Initialize Hardware
  // 2. Connect to Wi-Fi
  // 3. Mount LittleFS and verify state
  
  // If we reach this line without crashing or panicking, the firmware is healthy.
  #ifdef CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE
  esp_ota_mark_app_valid_cancel_rollback();
  #endif
}
```
