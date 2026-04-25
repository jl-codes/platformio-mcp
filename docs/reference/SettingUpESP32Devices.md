# Setting Up ESP32 Devices in PlatformIO

When configuring ESP32 and ESP32-S3 devices running on macOS inside PlatformIO, developers often encounter kernel-level port exceptions such as `[Errno 6] Device not configured` or `[Errno 2] No such file or directory`. 

This guide consolidates the best practices and configurations required to safely flash, boot, and monitor modern ESP32 variants over Native USB. For a deeper, architectural dive on why macOS drops the USB bus upon DTR assertion, see the [macOS Port Conflicts Reference Document](reference/ESP32PortConflictsOnMacOS.md).

## Recommended `platformio.ini` Configuration

To guarantee stability when compiling via `esptool`, append the following configuration directly into your `platformio.ini` environment block. 

```ini
[env:esp32s3nano]
board = arduino_nano_esp32
framework = arduino

build_flags =
    ; 1. NATIVE USB SUPPORT
    ; Initialize the USB CDC stack so logs don't go to the unpopulated physical RX/TX pins
    -D ARDUINO_USB_MODE=1
    -D ARDUINO_USB_CDC_ON_BOOT=1

    ; 2. HARDWARE IDENTITY RESTORATION
    ; Prevent the device from assuming the generic Espressif "JTAG" identity (303A:1001)
    ; Replace these with your board's factory Vendor and Product IDs.
    -D USB_VID=0x2341
    -D USB_PID=0x0070

; 3. macOS MONITOR STABILITY
; Keep standard serial monitors from aggressively dropping the DTR/RTS lines 
; and forcing the board into a hard-reset bootloop when opening the terminal.
monitor_dtr = 0
monitor_rts = 0

; 4. USB BOOTLOADER BRIDGING
; When using esptool on a Native USB port, asserting DTR will crash the flash pipeline.
; These flags command PlatformIO to ping the device at 1200bps, triggering it to 
; autonomously reboot into JTAG flash mode, bypassing the lethal DTR reset altogether. 
upload_protocol = esptool
board_upload.use_1200bps_touch = yes
board_upload.wait_for_upload_port = yes
```

## Detailed Explanations

### 1. `ARDUINO_USB_CDC_ON_BOOT`
Modern ESP32-S3 boards possess an internal USB PHY, meaning the micro-USB/USB-C plug is wired directly to the silicon rather than passing through a secondary silicon bridge chip (like a CP2102). If you do not explicitly enable the Core Device Class (CDC) stack on boot, the `Serial.print()` commands will be blindly routed to the physical hardware UART pins attached to the PCB, leaving your serial monitor completely blank.

### 2. `USB_VID` and `USB_PID`
When PlatformIO uses `esptool.py` to flash the firmware, it frequently overwrites the original factory bootloader (e.g. the Arduino `tinyuf2` bootloader). A side effect of this is that the board will boot using the generic ESP-IDF profile and broadcast itself to macOS as `USB JTAG/serial debug unit` (`303A:1001`). 
By passing explicit IDs to the compiler, the flashed Application firmware will seamlessly restore the canonical brand identity of the hardware (e.g. `Arduino Nano ESP32`).

> [!TIP]
> **How to find your factory VID and PID:** 
> If you aren't sure what your board's original IDs were, you can usually find them by:
> 1. **The PlatformIO CLI (Easiest):** Plug your board in *before* flashing it for the first time and run `pio device list` in your terminal. Look for the `Hardware ID: USB VID:PID=XXXX:XXXX` field in the output.
> 2. **System Tools:** Check your OS hardware tree.
>    - **macOS:** Open *System Information* -> *Hardware* -> *USB*. The Vendor ID and Product ID will be listed in hexadecimal.
>    - **Windows:** Open *Device Manager* -> *Ports (COM & LPT)*, right-click the device -> *Properties* -> *Details* tab -> *Hardware Ids* (look for `VID_XXXX&PID_XXXX`).
>    - **Linux:** Run `lsusb` in your terminal.
> 3. **The Raw Board Manifests:** If you don't have the board plugged in, navigate to the PlatformIO GitHub matrix (e.g. `platformio/platform-espressif32`), open the `boards/` directory, and inspect your specific board's `.json` configuration file. The default values will be statically listed inside the `"hwids"` JSON array.

### 3. `monitor_dtr` and `monitor_rts`
Standard UNIX serial terminals automatically pull the Data Terminal Ready (DTR) and Ready To Send (RTS) lines low the moment they open a `/dev/cu.*` file descriptor. On ESP32s, these abstract serial lines are physically bridged to the `EN` (Reset) and `BOOT0` hardware pins. Pulling them low instantly crashes the executing firmware. By setting these flags to `0`, PlatformIO explicitly requests passive terminal connections.

### 4. USB Bootloader Bridging (`use_1200bps_touch`)
Because standard `esptool.py` relies on the DTR hardware reset to enter the bootloader, executing it against a Native USB endpoint results in the underlying USB protocol dying abruptly, causing `pyserial` to crash with an `ENXIO (Device not configured)` OS-level kernel exception.
Enabling the `use_1200bps_touch` flag directs PlatformIO to gently stream a standardized sequence to the USB endpoint, waiting until the hardware safely jumps into Native Bootloader (JTAG) fashion before handing execution control over to `esptool`. 
