import { listDevices } from "../tools/devices.js";
import type { SerialDevice } from "../types.js";

export async function listDevicesCore(): Promise<SerialDevice[]> {
  return listDevices();
}
