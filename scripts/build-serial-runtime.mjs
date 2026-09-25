/** Bundle the pinned serial backend and its native prebuilds without an installed node_modules tree. */
import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";

/** Build a portable dependency bundle; loading it does not enumerate or open a serial device. */
export async function buildSerialRuntime(repoRoot, runtimeRoot) {
  const require = createRequire(join(repoRoot, "package.json"));
  const serialManifest = require.resolve("serialport/package.json");
  const serial = JSON.parse(readFileSync(serialManifest, "utf8"));
  if (serial.version !== "13.0.0")
    throw new Error("Expected pinned serialport 13.0.0");
  const output = join(runtimeRoot, "native", "serialport.cjs");
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [require.resolve("serialport")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    metafile: true,
    legalComments: "eof",
    logLevel: "silent",
  });
  // bindings-cpp resolves ../prebuilds relative to this bundle's native directory.
  const bindingsRoot = dirname(
    require.resolve("@serialport/bindings-cpp/package.json"),
  );
  const targets = ["win32-x64", "darwin-x64+arm64", "linux-x64", "linux-arm64"];
  for (const target of targets) {
    const source = join(bindingsRoot, "prebuilds", target);
    if (!existsSync(source)) throw new Error(`Missing native target ${target}`);
    cpSync(source, join(runtimeRoot, "prebuilds", target), { recursive: true });
  }
  const packages = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    let directory = dirname(resolve(repoRoot, input));
    while (!existsSync(join(directory, "package.json"))) {
      const parent = dirname(directory);
      if (parent === directory)
        throw new Error("Unidentified bundled dependency");
      directory = parent;
    }
    const manifest = JSON.parse(
      readFileSync(join(directory, "package.json"), "utf8"),
    );
    if (packages.has(manifest.name)) continue;
    const licenses = readdirSync(directory).filter((name) =>
      /^(license|licence|copying|notice)(\.|$)/i.test(name),
    );
    if (!licenses.length)
      throw new Error(`Missing license for ${manifest.name}`);
    const destination = join(
      runtimeRoot,
      "native",
      "licenses",
      manifest.name.replaceAll("/", "--"),
    );
    mkdirSync(destination, { recursive: true });
    for (const name of licenses)
      cpSync(join(directory, name), join(destination, name));
    packages.set(manifest.name, {
      name: manifest.name,
      version: manifest.version,
      license: manifest.license,
    });
  }
  writeFileSync(
    join(runtimeRoot, "native", "dependencies.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        minimumNodeMajor: 20,
        packages: [...packages.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        prebuildTargets: targets,
      },
      null,
      2,
    ) + "\n",
  );
}
