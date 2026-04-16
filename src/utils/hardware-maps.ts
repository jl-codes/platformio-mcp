/**
 * USB Hardware IDs mapping database.
 * Portions adapted from @toponextech/smartembed-mcp-server under MIT attribution.
 * Copyright (c) ToponexTech. Licensed under the MIT License.
 *
 * Provides:
 * - mapVidPidToBoard: Resolves hardware names for the device list tool based on VID/PID or description
 * - vidPidDatabase: Dictionary mapping USB raw strings to development boards
 * - boardPatterns: Regex patterns for matching hardware descriptions
 */

/**
 * Database mapping USB VID:PID raw strings to their known development boards
 */
export const vidPidDatabase: Record<
  string,
  { boards: string[]; confidence: string }
> = {
  "2341:0043": { boards: ["uno"], confidence: "high" },
  "2341:0042": { boards: ["megaatmega2560"], confidence: "high" },
  "2341:8036": { boards: ["leonardo"], confidence: "high" },
  "1a86:7523": { boards: ["uno", "esp32dev", "nodemcuv2"], confidence: "low" },
  "10c4:ea60": {
    boards: ["esp32dev", "esp32-c3-devkitm-1"],
    confidence: "medium",
  },
  "0403:6001": { boards: ["uno", "pro16MHzatmega328"], confidence: "low" },
  "2e8a:0005": { boards: ["pico"], confidence: "high" },
  "0483:374b": { boards: ["nucleo_f103rb"], confidence: "high" },
};

/**
 * Regex patterns for deriving board types from strings like manufacturer or description
 */
export const boardPatterns = [
  {
    patterns: [/CP210[0-9]/i, /Silicon Labs/i],
    boardType: "ESP32",
    boards: ["esp32dev", "esp32-c3-devkitm-1"],
  },
  {
    patterns: [/CH340/i, /CH341/i],
    boardType: "ESP32/ESP8266/Arduino",
    boards: ["nodemcuv2", "esp32dev", "uno"],
  },
  {
    patterns: [/NodeMCU/i],
    boardType: "ESP8266",
    boards: ["nodemcuv2", "nodemcu"],
  },
  {
    patterns: [/Wemos.*D1/i, /WEMOS/i],
    boardType: "ESP8266",
    boards: ["d1_mini", "d1_mini_pro"],
  },
  { patterns: [/Arduino.*Uno/i], boardType: "Arduino", boards: ["uno"] },
  {
    patterns: [/Arduino.*Mega/i],
    boardType: "Arduino",
    boards: ["megaatmega2560"],
  },
  { patterns: [/Arduino.*Nano/i], boardType: "Arduino", boards: ["nano"] },
  {
    patterns: [/Arduino.*Leonardo/i],
    boardType: "Arduino",
    boards: ["leonardo"],
  },
  {
    patterns: [/STM32.*Nucleo/i],
    boardType: "STM32",
    boards: ["nucleo_f401re", "nucleo_f103rb"],
  },
  {
    patterns: [/Raspberry.*Pi.*Pico/i, /RP2040/i],
    boardType: "RP2040",
    boards: ["pico"],
  },
];

/**
 * Maps a USB hardware ID and description to a probable PlatformIO board identifier
 * @param hwid The raw hardware ID string (e.g. from PlatformIO CLI)
 * @param description The device description string
 * @returns A string representing the most likely board format, or undefined
 */
export function mapVidPidToBoard(
  hwid: string,
  description: string = "",
): string | undefined {
  // Extract standard hex VID:PID
  const vidPidMatch =
    hwid.match(/VID:PID=([0-9A-Fa-f]{4}):([0-9A-Fa-f]{4})/i) ||
    hwid.match(/VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})/i);

  if (vidPidMatch) {
    const vidPidStr = `${vidPidMatch[1]}:${vidPidMatch[2]}`.toLowerCase();
    if (vidPidDatabase[vidPidStr]) {
      return vidPidDatabase[vidPidStr].boards[0];
    }
  }

  // Fallback to pattern matching against descriptions and ids
  const matchText = `${description} ${hwid}`;
  for (const pattern of boardPatterns) {
    if (pattern.patterns.some((p) => p.test(matchText))) {
      return pattern.boards[0];
    }
  }

  return undefined;
}
