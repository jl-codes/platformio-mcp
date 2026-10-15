import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fingerprintDevice,
  parseTargetEnvironments,
  resolveWriteTarget,
  resolveTarget,
  verifyTargetBinding,
} from "../src/core/target-resolution.js";
import type { SerialDevice } from "../src/types.js";

vi.mock("../src/tools/projects.js", () => ({ getProjectConfig: vi.fn() }));
vi.mock("../src/utils/logger.js", () => ({ logDiagnostic: vi.fn() }));
import { getProjectConfig } from "../src/tools/projects.js";
import { logDiagnostic } from "../src/utils/logger.js";

const createdDirectories: string[] = [];

function createProject(ini: string): string {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-target-"));
  createdDirectories.push(projectDir);
  fs.writeFileSync(path.join(projectDir, "platformio.ini"), ini, "utf8");
  return projectDir;
}

function device(port: string, board = "esp32dev", serial = "ABC123"): SerialDevice {
  return {
    port,
    description: "USB JTAG/serial debug unit",
    hwid: `USB VID:PID=303A:1001 SER=${serial} LOCATION=1-2`,
    detectedBoard: board,
  };
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("target resolution", () => {
  it("parses default environments and board metadata", () => {
    const parsed = parseTargetEnvironments(
      "[platformio]\ndefault_envs = release\n[env:release]\nboard = esp32dev\nframework = arduino\n",
    );
    expect(parsed.defaults).toEqual(["release"]);
    expect(parsed.environments).toEqual([
      { name: "release", board: "esp32dev", framework: "arduino" },
    ]);
  });

  it("returns ambiguity instead of choosing among multiple environments", async () => {
    const projectDir = createProject(
      "[env:first]\nboard = esp32dev\n[env:second]\nboard = esp32dev\n",
    );
    const result = await resolveTarget({ projectDir }, [device("COM7")]);
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
    expect(result.binding).toBeUndefined();
  });

  it("binds one exact device and tolerates stable port re-enumeration", async () => {
    const projectDir = createProject("[env:release]\nboard = esp32dev\n");
    const original = device("COM7");
    const result = await resolveTarget(
      { projectDir, environment: "release", port: "COM7" },
      [original],
    );
    expect(result.success).toBe(true);
    expect(result.confidence).toBe("exact");
    expect(result.binding?.deviceFingerprint).toBe(fingerprintDevice(original));

    const verified = await verifyTargetBinding(result.binding!, {
      projectDir,
      environment: "release",
      devices: [device("COM9")],
    });
    expect(verified).toEqual({ valid: true, port: "COM9", portChanged: true });
  });

  it("rejects substitution by a different physical serial identity", async () => {
    const projectDir = createProject("[env:release]\nboard = esp32dev\n");
    const result = await resolveTarget(
      { projectDir, environment: "release" },
      [device("COM7", "esp32dev", "FIRST")],
    );
    await expect(
      verifyTargetBinding(result.binding!, {
        projectDir,
        environment: "release",
        devices: [device("COM7", "esp32dev", "SECOND")],
      }),
    ).rejects.toMatchObject({ code: "STALE_TARGET_BINDING" });
  });

  it("refuses an ambiguous write target instead of deferring selection", async () => {
    const projectDir = createProject(
      "[env:first]\nboard = esp32dev\n[env:second]\nboard = esp32dev\n",
    );
    await expect(
      resolveWriteTarget({ projectDir }),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_TARGET" });
  });
});


it("binds the inherited board from Core's computed configuration", async () => {
  const projectDir = createProject("[env:base]\nboard = esp32-s3-devkitc-1\n[env:native]\nextends = env:base\n");
  vi.mocked(getProjectConfig).mockResolvedValueOnce([
    ["platformio", [["default_envs", ["native"]]]],
    ["env:base", [["board", "esp32-s3-devkitc-1"]]],
    ["env:native", [["board", "esp32-s3-devkitc-1"], ["framework", ["arduino"]]]],
  ]);
  const result = await resolveTarget({ projectDir, environment: "native", port: "COM7" }, [device("COM7", "esp32-s3-devkitc-1")]);
  expect(result.success).toBe(true);
  expect(result.binding?.board).toBe("esp32-s3-devkitc-1");
  expect(getProjectConfig).toHaveBeenCalledWith(projectDir);
});

it("does not fall back to raw target metadata when computed configuration fails", async () => {
  const projectDir = createProject("[env:base]\nboard = esp32dev\n[env:native]\nextends = env:base\nboard = esp32dev\n");
  vi.mocked(getProjectConfig).mockRejectedValueOnce(new Error("invalid inheritance"));
  await expect(resolveTarget({ projectDir, environment: "native" }, [device("COM7")])).rejects.toThrow("invalid inheritance");
});

describe("extends inheritance parsing", () => {
  it("inherits board from [env:base] via extends = env:base", () => {
    const parsed = parseTargetEnvironments(`
[env:base]
board = esp32dev

[env:child]
extends = env:base
`);
    const child = parsed.environments.find((e) => e.name === "child");
    expect(child).toBeDefined();
    expect(child?.board).toBe("esp32dev");
  });

  it("inherits board from [common] section via extends = common", () => {
    const parsed = parseTargetEnvironments(`
[common]
board = esp32dev

[env:child]
extends = common
`);
    const child = parsed.environments.find((e) => e.name === "child");
    expect(child).toBeDefined();
    expect(child?.board).toBe("esp32dev");
  });

  it("resolves multi-level extends inheritance (a -> b -> c)", () => {
    const parsed = parseTargetEnvironments(`
[env:a]
extends = env:b

[env:b]
extends = env:c

[env:c]
board = esp32dev
`);
    const envA = parsed.environments.find((e) => e.name === "a");
    expect(envA).toBeDefined();
    expect(envA?.board).toBe("esp32dev");
  });

  it("handles circular extends without infinite looping, logs a warning, and leaves board undefined", () => {
    const parsed = parseTargetEnvironments(`
[env:a]
extends = env:b

[env:b]
extends = env:a
`);
    const envA = parsed.environments.find((e) => e.name === "a");
    const envB = parsed.environments.find((e) => e.name === "b");
    expect(envA?.board).toBeUndefined();
    expect(envB?.board).toBeUndefined();
    expect(logDiagnostic).toHaveBeenCalledWith(expect.stringContaining("Circular extends detected"));
  });

  it("allows child to override parent's board value", () => {
    const parsed = parseTargetEnvironments(`
[env:base]
board = esp32dev

[env:child]
extends = env:base
board = esp32-s3-devkitc-1
`);
    const child = parsed.environments.find((e) => e.name === "child");
    expect(child).toBeDefined();
    expect(child?.board).toBe("esp32-s3-devkitc-1");
  });
});


describe("extends edge cases", () => {
  it("gracefully handles nonexistent extends parent", () => {
    const ini = `
[env:child]
extends = does_not_exist
framework = arduino
`;
    const { environments } = parseTargetEnvironments(ini);
    const child = environments.find((e) => e.name === "child");
    expect(child).toBeDefined();
    expect(child!.board).toBeUndefined();
    expect(child!.framework).toBe("arduino");
  });

  it("resolves multi-parent extends from different sources", () => {
    const ini = `
[common]
board = esp32dev

[env:networking]
framework = arduino

[env:app]
extends = common, env:networking
`;
    const { environments } = parseTargetEnvironments(ini);
    const app = environments.find((e) => e.name === "app");
    expect(app).toBeDefined();
    expect(app!.board).toBe("esp32dev");
    expect(app!.framework).toBe("arduino");
  });

  it("handles mixed-case extends with spaces after env:", () => {
    const ini = `
[env:base]
board = esp32-s3-devkitc-1

[env:app]
extends = ENV: base
`;
    const { environments } = parseTargetEnvironments(ini);
    const app = environments.find((e) => e.name === "app");
    expect(app).toBeDefined();
    expect(app!.board).toBe("esp32-s3-devkitc-1");
  });
});
