/**
 * Board Intelligence Type Contracts
 *
 * Provides:
 * - BoardPinProfile: Risk-classified GPIO metadata for a board family.
 * - BoardProfile: Unified board profile metadata for agent workflows.
 */

/**
 * Pin safety profile for a board family.
 */
export interface BoardPinProfile {
  dangerousPins: number[]; // Pins with elevated boot/runtime risk
  inputOnlyPins: number[]; // Pins that cannot source output
  flashSpiPins: number[]; // Pins reserved by onboard flash/SPI
  saferAlternatives: number[]; // Suggested safer general-purpose pins
}

/**
 * Board profile resolved by board/platform metadata.
 */
export interface BoardProfile {
  key: string; // Stable key for profile matching
  title: string; // Human-readable profile name
  defaultMonitorBaudRate: number; // Preferred serial monitor baud rate
  pinProfile: BoardPinProfile; // Pin safety and capability metadata
  boardIdPattern: RegExp; // Pattern used for board-id family matching
  platformPattern: RegExp; // Pattern used for platform family matching
  mcuPattern: RegExp; // Pattern used for MCU family matching
}
