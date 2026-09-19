/** Load serialport from the self-contained plugin or the installed npm dependency, without opening a device. */
import fs from "node:fs";
import { PlatformIOError } from "../../utils/errors.js";

/** Resolve a packaged backend beside the main bundle; ordinary source/npm builds use their pinned dependency. */
export async function loadSerialBackend(): Promise<
  typeof import("serialport")
> {
  if (Number(process.versions.node.split(".")[0]) < 20)
    throw new PlatformIOError(
      "Direct serial support requires Node 20 or newer.",
      "SERIAL_BACKEND_UNAVAILABLE",
    );
  try {
    const bundled = new URL("./native/serialport.cjs", import.meta.url);
    if (fs.existsSync(bundled)) {
      const loaded = await import(bundled.href);
      const backend = loaded.default ?? loaded;
      if (
        typeof backend.SerialPort !== "function" ||
        typeof backend.SerialPort.list !== "function"
      )
        throw new Error("Invalid packaged serial backend");
      return backend;
    }
    return await import("serialport");
  } catch {
    throw new PlatformIOError(
      "The pinned native serial backend is unavailable on this installation.",
      "SERIAL_BACKEND_UNAVAILABLE",
    );
  }
}
