/**
 * Board Profile Resolver
 *
 * Provides:
 * - getBoardProfile: Resolves board intelligence profile from board metadata.
 * - boardProfiles: Registry of known board family profiles.
 */

import { esp32BoardProfile } from "./esp32-profile.js";
import type { BoardProfile } from "./types.js";

/**
 * Registry of known board-family profiles.
 * Additive-only to preserve predictable matcher behavior.
 */
export const boardProfiles: BoardProfile[] = [esp32BoardProfile];

/**
 * Minimal board metadata shape used for profile resolution.
 */
export interface BoardProfileLookupInput {
  boardId: string;
  platform?: string;
  mcu?: string;
}

/**
 * Resolves a board profile using board ID, platform, and MCU hints.
 *
 * @param input - Board metadata used to select a known profile.
 * @returns Matching board profile, if one is known.
 */
export function getBoardProfile(
  input: BoardProfileLookupInput,
): BoardProfile | undefined {
  const boardId = input.boardId.trim();
  const platform = input.platform?.trim() ?? "";
  const mcu = input.mcu?.trim() ?? "";

  return boardProfiles.find((profile) => {
    if (profile.boardIdPattern.test(boardId)) return true;
    if (platform && profile.platformPattern.test(platform)) return true;
    if (mcu && profile.mcuPattern.test(mcu)) return true;
    return false;
  });
}
