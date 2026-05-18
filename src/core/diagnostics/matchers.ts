import type { DiagnosticMatcher } from "./types.js";

export const buildMatchers: DiagnosticMatcher[] = [
  {
    errorType: "MissingHeader",
    pattern: /fatal error: .*: No such file or directory/i,
    recommendedAction: "Install the missing library or fix the include path.",
    severity: "error",
    safeToAutoRetry: false,
  },
  {
    errorType: "SyntaxError",
    pattern: /error: expected|error: stray|error: .* was not declared/i,
    recommendedAction:
      "Inspect the referenced source line and patch the syntax or missing symbol.",
    severity: "error",
    safeToAutoRetry: false,
  },
  {
    errorType: "MemoryOverflow",
    pattern: /region .* overflowed|RAM.*overflow|Flash.*overflow/i,
    recommendedAction:
      "Reduce firmware size, change board config, or optimize memory usage.",
    severity: "critical",
    safeToAutoRetry: false,
  },
  {
    errorType: "LinkerError",
    pattern: /undefined reference|ld returned/i,
    recommendedAction: "Check missing symbols, library linkage, or build flags.",
    severity: "error",
    safeToAutoRetry: false,
  },
  {
    errorType: "MissingLibrary",
    pattern: /library .* not found|library manager:.*not found/i,
    recommendedAction: "Install or correct the missing library dependency.",
    severity: "error",
    safeToAutoRetry: false,
  },
  {
    errorType: "WrongBoard",
    pattern: /unknown board|invalid board|board .* not found/i,
    recommendedAction:
      "Check the PlatformIO board ID and update platformio.ini accordingly.",
    severity: "error",
    safeToAutoRetry: false,
  },
  {
    errorType: "WrongFramework",
    pattern: /framework .* is not compatible|unknown framework/i,
    recommendedAction:
      "Select a framework supported by the selected board and retry build.",
    severity: "error",
    safeToAutoRetry: false,
  },
];

export const uploadMatchers: DiagnosticMatcher[] = [
  {
    errorType: "PortBusy",
    pattern: /Resource busy|Access is denied|device or resource busy/i,
    recommendedAction:
      "Release the serial port lock or stop the active monitor process.",
    severity: "error",
    safeToAutoRetry: true,
  },
  {
    errorType: "PermissionDenied",
    pattern: /Permission denied|Operation not permitted/i,
    recommendedAction:
      "Check serial device permissions or run the required permission setup.",
    severity: "error",
    safeToAutoRetry: false,
  },
  {
    errorType: "UploadSyncFailed",
    pattern: /Failed to connect|Timed out waiting for packet|Invalid head of packet/i,
    recommendedAction:
      "Put the board into bootloader mode, check cable, or retry upload.",
    severity: "error",
    safeToAutoRetry: true,
  },
  {
    errorType: "DeviceDisconnected",
    pattern: /No such file or directory|device not found|could not open port/i,
    recommendedAction: "Reconnect the device and re-run device discovery.",
    severity: "error",
    safeToAutoRetry: true,
  },
];

export const serialMatchers: DiagnosticMatcher[] = [
  {
    errorType: "Brownout",
    pattern: /brownout/i,
    recommendedAction: "Check power supply, USB cable, and peak current draw.",
    severity: "critical",
    safeToAutoRetry: false,
  },
  {
    errorType: "WatchdogReset",
    pattern: /watchdog|wdt/i,
    recommendedAction:
      "Inspect blocking loops, task starvation, and interrupt behavior.",
    severity: "error",
    safeToAutoRetry: false,
  },
  {
    errorType: "PanicTrace",
    pattern: /Guru Meditation|panic|stack trace|backtrace/i,
    recommendedAction:
      "Extract the backtrace and map it to source lines if debug symbols are available.",
    severity: "critical",
    safeToAutoRetry: false,
  },
  {
    errorType: "BootLoop",
    pattern: /(rst:|boot:)[\s\S]*(rst:|boot:)/i,
    recommendedAction:
      "Device appears to be repeatedly rebooting. Inspect startup code and power stability.",
    severity: "critical",
    safeToAutoRetry: false,
  },
  {
    errorType: "NoSerialOutput",
    pattern: /^\s*$/i,
    recommendedAction:
      "No runtime output was observed. Check baud rate, wiring, and boot markers.",
    severity: "warning",
    safeToAutoRetry: true,
  },
];

