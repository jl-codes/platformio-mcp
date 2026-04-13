# Build, Upload, and Monitor

Complete firmware development cycle: compile, flash to device, and observe serial output.

## Step 1: Verify Connected Device

Check what's plugged in before we do anything. This prevents uploading to the wrong board.

Use the `list_devices` MCP tool to detect connected serial devices. If no device is found, stop and inform the user.

## Step 2: Build the Project

Compile the firmware in the current project directory.

```bash
pio run
```

If the build fails, stop here — do NOT proceed to upload. Show the build errors and help fix them.

## Step 3: Upload Firmware

Flash the compiled firmware to the connected device.

```bash
pio run -t upload
```

If a specific port is needed (e.g., multiple devices connected), use the port discovered in Step 1:

```bash
pio run -t upload --upload-port /dev/cu.usbserial-XXXX
```

## Step 4: Start Serial Monitor

Provide the serial monitor command so the user can observe device output.

```bash
pio device monitor
```

If a custom baud rate is needed (check `Serial.begin()` in the source code):

```bash
pio device monitor -b 115200
```

Report the baud rate you found in the source code. If no `Serial.begin()` is found, default to 115200.
