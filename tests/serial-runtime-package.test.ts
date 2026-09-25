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
      outfile: path.join(root, "platformio-mcp.mjs"),
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
        "import('./platformio-mcp.mjs').then(async({loadSerialBackend})=>{const {SerialPort}=await loadSerialBackend();if(typeof SerialPort!=='function'||typeof SerialPort.list!=='function')process.exit(2);process.stdout.write('loaded');}).catch(()=>process.exit(3));",
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

it.each(["missing-directory", "missing-bundle", "missing-prebuilds"])(
  "fails explicitly for %s instead of loading a different installed package",
  (failure) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-native-missing-"));
    try {
      if (failure !== "missing-directory")
        fs.mkdirSync(path.join(root, "native"));
      if (failure === "missing-prebuilds")
        fs.copyFileSync(
          path.resolve("plugins/platformio-mcp/runtime/native/serialport.cjs"),
          path.join(root, "native/serialport.cjs"),
        );
      const fallback = path.join(root, "node_modules", "serialport");
      fs.mkdirSync(fallback, { recursive: true });
      fs.writeFileSync(
        path.join(fallback, "package.json"),
        JSON.stringify({ name: "serialport", main: "index.js" }),
      );
      fs.writeFileSync(
        path.join(fallback, "index.js"),
        "require('node:fs').writeFileSync('fallback-loaded', 'yes'); throw new Error('FALLBACK_WAS_LOADED');",
      );
      buildSync({
        entryPoints: [path.resolve("src/core/serial/serial-backend.ts")],
        outfile: path.join(root, "platformio-mcp.mjs"),
        bundle: true,
        platform: "node",
        format: "esm",
        external: ["serialport"],
        logLevel: "silent",
      });
      const output = execFileSync(
        process.execPath,
        [
          "-e",
          "import('./platformio-mcp.mjs').then(({loadSerialBackend})=>loadSerialBackend()).then(()=>process.exit(2)).catch(e=>process.stdout.write(e.code||e.message));",
        ],
        { cwd: root, encoding: "utf8", timeout: 10000 },
      );
      expect(output).toBe("SERIAL_BACKEND_UNAVAILABLE");
      expect(fs.existsSync(path.join(root, "fallback-loaded"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
