# PlatformIO v6 Package Sandboxing (`pio pkg exec`)

If you require advanced memory diagnostics, flash erasure, or you need to run an isolated microcontroller tool (`esptool.py`, `avrdude`, `JLinkGDBServer`), **DO NOT** attempt to install Python virtual environments globally or run them directly from the user's shell path.

PlatformIO natively sandboxes all CLI utilities inside its toolchains. You can execute them directly and safely utilizing the `pio pkg exec` command.

**Reference Documentation:** [PlatformIO pkg exec Guide](https://docs.platformio.org/en/latest/core/userguide/pkg/cmd_exec.html)

### Workflow Rules
1. Never invoke the tool directly.
2. Prefix your recovery target with `pio pkg exec --package=tool-<name> --`.

## Target Tool Templates

Below are common recovery and diagnostic templates you can deploy directly when troubleshooting failing builds or bricked boards.

**1. Erasing ESP32 Flash Memory (Fixes corrupted partition tables)**
```bash
pio pkg exec --package "platformio/tool-esptoolpy" -- esptool.py erase_flash
```

**2. Reading ESP32 MAC/Chip ID (Verifying hardware identity)**
```bash
pio pkg exec --package "platformio/tool-esptoolpy" -- esptool.py read_mac
pio pkg exec --package "platformio/tool-esptoolpy" -- esptool.py chip_id
```

**3. Reading/Writing ESP32 eFuses (Advanced hardware diagnostics)**
```bash
pio pkg exec --package "platformio/tool-esptoolpy" -- espefuse.py summary
```

> [!CAUTION]
> **IRREVERSIBLE ACTION GUARD**
> The `burn_key` and other `espefuse.py` write commands are **One-Time Programmable (OTP)** and completely irreversible. Writing the wrong fuse WILL permanently brick the device.
> 
> **YOU MUST NEVER AUTONOMOUSLY RUN AN EFUSE BURN COMMAND.**
> If a task requires burning an eFuse, you MUST STOP. You MUST explain the exact command to the user, warn them that it is irreversible, and wait for their EXPLICIT YES before proceeding. Do not assume permission under any circumstance.

```bash
# Example (REQUIRES EXPLICIT HUMAN APPROVAL FIRST):
# pio pkg exec --package "platformio/tool-esptoolpy" -- espefuse.py --port <PORT> burn_key flash_encryption my_key.bin
```

**4. Disassembling AVR/Atmel Binaries (Checking compiler output/sizes)**
```bash
# Ensure you replace 'avr2' and the 'uno' firmware path depending on the target framework.
pio pkg exec -- avr-objdump -d -m avr2 .pio/build/uno/firmware.elf
```

**5. Booting JLink GDB Servers Natively (Debugger bootstrapping)**
```bash
pio pkg exec --package=tool-jlink -- JLinkGDBServer -singlerun -if JTAG -select USB -device <DEVICE_ID> -port 2331
```

When building custom shell fallback execution loops, always default to wrapping underlying C++ binaries inside a `pio pkg exec` sandbox.
