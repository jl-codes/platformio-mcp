/** Real GNU-toolchain acceptance for the repository-owned build-only Xtensa fixture. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  decodeFirmwareCrash,
  reportFirmwareSize,
} from "../src/core/analysis/firmware-analysis.js";
import { readElfIdentity } from "../src/core/analysis/elf-identity.js";
import { resolveAnalysisToolchain } from "../src/core/analysis/toolchain-resolver.js";
import { runAnalysisProcess } from "../src/core/analysis/analysis-process.js";
import { parseNm } from "../src/core/analysis/size-parser.js";

const [project, compiler, trustedRoot, output, target = "xtensa"] = process.argv.slice(2);
assert(
  project && compiler && trustedRoot && output,
  "Usage: node --import tsx scripts/verify-analysis-fixture.ts PROJECT COMPILER TRUSTED_ROOT OUTPUT_JSON",
);
const projectDir = await fs.realpath(project);
assert(["xtensa", "arm"].includes(target), "Unsupported fixture target");
const environment = target === "arm" ? "analysis-cortex-m" : "analysis-esp32s3";
const elfPath = path.join(
  projectDir,
  ".pio",
  "build",
  environment,
  "firmware.elf",
);
const identity = await readElfIdentity(elfPath);
assert.equal(identity.architecture, target);
const tools = await resolveAnalysisToolchain(compiler, [trustedRoot]);
const nm = await runAnalysisProcess(
  tools.nm,
  ["-S", "-C", "-l", "--size-sort", "--defined-only", elfPath],
  { cwd: projectDir },
);
const symbol = parseNm(nm.stdout).find(
  (item) => item.name === "fixture_add(unsigned int)",
);
assert(symbol, "GNU nm must find the fixture function");
assert(symbol.size > 0);
const context = {
  projectDir,
  environment,
  elfPath,
  compilerPath: compiler,
  trustedToolchainRoots: [trustedRoot],
  expectedElfSha256: identity.sha256,
};
const crash = await decodeFirmwareCrash(
  context,
  target === "arm" ? `HardFault\nPC: ${symbol.address} LR: 0xdeadbeef` : `Backtrace: ${symbol.address}:0x3fc00000 0xdeadbeef:0x3fc00010`,
);
assert(crash.ok, "Fixture frame must resolve");
assert("elf" in crash);
assert.equal(crash.elf.sha256, identity.sha256);
assert.equal(crash.artifactIdentity, "matched_expected_elf");
assert.equal(crash.flashedFirmwareVerified, false);
assert(crash.frames[0].function === symbol.name || crash.frames[0].inlined.some(frame => frame.function === symbol.name));
assert(crash.frames[0].file?.replaceAll("\\", "/").endsWith("src/main.cpp"));
assert(
  crash.frames[0].line &&
    crash.frames[0].line >= (target === "arm" ? 4 : 6) &&
    crash.frames[0].line <= 9,
);
assert.equal(crash.frames[1].resolved, false, "Unknown frame must be retained");
const size = await reportFirmwareSize(context, 1000);
assert.equal(size.elf.sha256, identity.sha256);
assert(size.totals.flashEstimate > 0 && size.totals.ramEstimate > 0);
assert.equal(size.symbolCount, parseNm(nm.stdout).length);
assert(
  size.topSymbols.every(
    (item, index, items) => index === 0 || items[index - 1].size >= item.size,
  ),
);
assert(
  size.topFiles.some((item) =>
    item.file.replaceAll("\\", "/").endsWith("src/main.cpp"),
  ),
);
await assert.rejects(
  decodeFirmwareCrash(
    { ...context, expectedElfSha256: "0".repeat(64) },
    `PC : ${symbol.address}`,
  ),
  (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ANALYSIS_ELF_MISMATCH",
);
const filtered = await reportFirmwareSize(context, 25, "^fixture_add");
assert.equal(filtered.symbolCount, 1);
assert.equal(filtered.topSymbols[0].name, symbol.name);
assert.deepEqual(filtered.totals, size.totals);
const source = await fs.readFile(path.join(projectDir, "src/main.cpp"));
const version = await runAnalysisProcess(tools.nm, ["--version"], {
  cwd: projectDir,
});
const evidence = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  },
  environment,
  board: target === "arm" ? "nucleo_f401re" : "esp32-s3-devkitc-1",
  platform: target === "arm" ? "ststm32@19.4.0" : "espressif32@7.0.1",
  sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
  elf: {
    sha256: identity.sha256,
    architecture: identity.architecture,
    bytes: identity.size,
  },
  utilityVersion: version.stdout.split(/\r?\n/)[0],
  checks: {
    knownFunction: true,
    sourceLine: crash.frames[0].line,
    unresolvedFrame: true,
    expectedHash: true,
    wrongHashRejected: true,
    symbolAttribution: true,
    filteredSymbols: true,
    inlineFrames: crash.frames[0].inlined.length,
  },
  totals: size.totals,
  symbolCount: size.symbolCount,
  physicalDeviceTest: false,
};
await fs.writeFile(output, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify(evidence, null, 2));
