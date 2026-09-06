import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installCodexPlugin } from "../scripts/installers/codex.js";

const temporaryDirectories: string[] = [];

function createPackageRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-codex-installer-"));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, ".agents", "plugins"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugins", "platformio-mcp"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, ".agents", "plugins", "marketplace.json"),
    "{}",
  );
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Codex plugin installer", () => {
  it("adds the local marketplace and plugin without a shell", async () => {
    const packageRoot = createPackageRoot();
    const commands: string[][] = [];
    const validatePlugin = vi.fn();
    const runCommand = vi.fn((args: string[]) => {
      commands.push(args);
      if (args.includes("marketplace") && args.includes("list")) {
        return '{"marketplaces":[]}';
      }
      if (args.includes("list")) return '{"installed":[],"available":[]}';
      return "{}";
    });

    const result = await installCodexPlugin({
      packageRoot,
      runCommand,
      validatePlugin,
    });

    expect(result).toMatchObject({ marketplaceAdded: true, pluginAdded: true });
    expect(validatePlugin).toHaveBeenCalledWith({
      requireRuntime: true,
      repoRoot: packageRoot,
    });
    expect(commands).toContainEqual([
      "plugin",
      "marketplace",
      "add",
      packageRoot,
      "--json",
    ]);
    expect(commands).toContainEqual([
      "plugin",
      "add",
      "platformio-mcp@platformio-mcp",
      "--json",
    ]);
  });

  it("is idempotent when the same marketplace and plugin are present", async () => {
    const packageRoot = createPackageRoot();
    const validatePlugin = vi.fn();
    const runCommand = vi.fn((args: string[]) =>
      args.includes("marketplace")
        ? JSON.stringify({ marketplaces: [{ root: packageRoot }] })
        : '{"installed":[{"name":"platformio-mcp"}],"available":[]}',
    );

    await expect(
      installCodexPlugin({ packageRoot, runCommand, validatePlugin }),
    ).resolves.toMatchObject({ marketplaceAdded: false, pluginAdded: false });
    expect(validatePlugin).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it("refuses to mutate Codex state when plugin validation fails", async () => {
    const packageRoot = createPackageRoot();
    const runCommand = vi.fn();
    const validatePlugin = vi.fn(() => {
      throw new Error("invalid plugin fixture");
    });

    await expect(
      installCodexPlugin({ packageRoot, runCommand, validatePlugin }),
    ).rejects.toThrow("invalid plugin fixture");
    expect(runCommand).not.toHaveBeenCalled();
  });
});
