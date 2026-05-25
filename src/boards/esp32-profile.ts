/**
 * ESP32 Board Profile
 *
 * Provides:
 * - esp32BoardProfile: Baseline board intelligence for ESP32-family targets.
 */

import type { BoardProfile } from "./types.js";

/**
 * Baseline ESP32 profile used for pin-risk and runtime defaults.
 */
export const esp32BoardProfile: BoardProfile = {
  key: "esp32",
  title: "ESP32 Family",
  defaultMonitorBaudRate: 115200,
  pinProfile: {
    dangerousPins: [0, 2, 4, 5, 12, 15],
    inputOnlyPins: [34, 35, 36, 37, 38, 39],
    flashSpiPins: [6, 7, 8, 9, 10, 11],
    saferAlternatives: [25, 26, 27],
  },
  boardIdPattern: /^esp32/i,
  platformPattern: /espressif32/i,
  mcuPattern: /esp32/i,
};
