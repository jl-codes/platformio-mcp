import { listDevicesCore } from "../../core/devices.js";
import type { CommandHandler } from "./types.js";

export const devices: CommandHandler = async () => listDevicesCore();
