/** Load the packaged native backend outside the repository; never enumerate or open a port. */
import { buildSync } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
it("loads serial native exports without node_modules or device access", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-native-package-"));
  try {
    const source = path.resolve("plugins/platformio-mcp/runtime");
    fs.cpSync(path.join(source, "native"), path.join(root, "native"), {
      recursive: true,
    });
    fs.cpSync(path.join(source, "prebuilds"), path.join(root, "prebuilds"), {
      recursive: true,
    });
    buildSync({
      entryPoints: [path.resolve("src/core/serial/serial-backend.ts")],
      outfile: path.join(root, "backend.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      external: ["serialport"],
      logLevel: "silent",
    });
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        "import('./backend.mjs').then(async({loadSerialBackend})=>{const {SerialPort}=await loadSerialBackend();if(typeof SerialPort!=='function'||typeof SerialPort.list!=='function')process.exit(2);process.stdout.write('loaded');}).catch(()=>process.exit(3));",
      ],
      {
        cwd: root,
        env: { ...process.env, NODE_PATH: "" },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    expect(output).toBe("loaded");
    expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
