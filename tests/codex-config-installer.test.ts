/** Regression coverage for preserving host configuration during MCP installation. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTOML, getStaticTOMLValue } from "toml-eslint-parser";
import {
  mergeCodexToml,
  resolveCodexConfigPath,
  mergeCodexConfig,
} from "../scripts/installers/codex.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
const parse = (source: string) => getStaticTOMLValue(parseTOML(source)) as any;

describe("Codex TOML configuration", () => {
  it.each([
    '[mcp_servers."platformio"] # server\ncommand = "old" # keep\nargs = []\n',
    'mcp_servers.platformio = { command = "old", args = [], enabled = false }\n',
    "mcp_servers = { platformio = { enabled = false } }\n",
    'mcp_servers.platformio.command = "old"\n',
    "[mcp_servers]\nplatformio.enabled = false\n",
    '[mcp_servers.platformio.env]\nPIO_MCP_POLICY_FILE = "/policy.yaml"\n',
    "[mcp_servers.platformio] # no newline",
    "",
  ])("supports valid alternate representations: %s", (source) => {
    const next = mergeCodexToml(source);
    expect(parse(next).mcp_servers.platformio.command).toBe(
      process.platform === "win32" ? "npx.cmd" : "npx",
    );
    expect(parse(next).mcp_servers.platformio.args).toContain("platformio-mcp");
    expect(mergeCodexToml(next)).toBe(next);
  });

  it("preserves permissions, comments, multiline values and separated environment tables", () => {
    const head =
      'approval_policy = "never"\r\nsandbox_mode = "workspace-write"\r\nnotes = """\r\n[mcp_servers.platformio]\r\nnot a table\r\n"""\r\n';
    const tail =
      '\r\n[mcp_servers.other] # keep\r\ncommand = "other"\r\n[mcp_servers.platformio.env]\r\nPIO_MCP_POLICY_FILE = "C:/policies/operator.yaml"\r\n';
    const source =
      head +
      '[mcp_servers."platformio"] # server\r\ncommand = "old" # keep\r\nargs = []\r\nenabled = false\r\ntool_timeout_sec = 123\r\n' +
      tail;
    const next = mergeCodexToml(source);
    expect(next.startsWith(head)).toBe(true);
    expect(next.endsWith(tail)).toBe(true);
    expect(next).toContain(" # keep\r\n");
    expect(parse(next).mcp_servers.platformio).toMatchObject({
      enabled: false,
      tool_timeout_sec: 123,
      env: { PIO_MCP_POLICY_FILE: "C:/policies/operator.yaml" },
    });
  });

  it("preserves custom launchers and their permission selectors", () => {
    const source =
      '[mcp_servers.platformio]\ncommand = "node"\nargs = ["/opt/pio/build/cli.js", "--policy-file", "/operator.yaml"]\n';
    expect(parse(mergeCodexToml(source)).mcp_servers.platformio).toEqual(
      parse(source).mcp_servers.platformio,
    );
  });

  it("retains runtime policy and compatibility selectors", () => {
    const source =
      '[mcp_servers.platformio]\ncommand = "npx"\nargs = ["-y", "platformio-mcp@3.0.0", "--policy-file", "/operator.yaml", "--compat", "platformio-mcp-python"]\n';
    expect(parse(mergeCodexToml(source)).mcp_servers.platformio.args).toEqual([
      "-y",
      "platformio-mcp",
      "--policy-file",
      "/operator.yaml",
      "--compat",
      "platformio-mcp-python",
    ]);
  });

  it.each(["bad = [", 'model = "one"\nmodel = "two"', "\0"])(
    "leaves invalid files byte-for-byte unchanged: %s",
    (source) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-codex-toml-"));
      dirs.push(dir);
      const file = path.join(dir, "config.toml");
      fs.writeFileSync(file, source);
      expect(() => mergeCodexConfig(file)).toThrow("invalid TOML");
      expect(fs.readFileSync(file, "utf8")).toBe(source);
      expect(fs.readdirSync(dir)).toEqual(["config.toml"]);
    },
  );

  it("leaves the original intact and cleans temporary files if replacement fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pio-codex-atomic-"));
    dirs.push(dir);
    const file = path.join(dir, "config.toml");
    const original = 'approval_policy = "on-request"\n';
    fs.writeFileSync(file, original);
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("replacement failed");
    });
    try {
      expect(() => mergeCodexConfig(file)).toThrow("replacement failed");
      expect(fs.readFileSync(file, "utf8")).toBe(original);
      expect(fs.readdirSync(dir)).toEqual(["config.toml"]);
    } finally {
      rename.mockRestore();
    }
  });

  it("does not overwrite a remote server with a conflicting local transport", () => {
    expect(() =>
      mergeCodexToml(
        '[mcp_servers.platformio]\nurl = "https://example.invalid/mcp"',
      ),
    ).toThrow("remote URL");
  });

  it("uses CODEX_HOME and rejects explicitly empty paths", () => {
    expect(
      resolveCodexConfigPath({ CODEX_HOME: "custom-codex" }, "/home/example"),
    ).toBe(path.resolve("custom-codex", "config.toml"));
    expect(resolveCodexConfigPath({}, "/home/example")).toBe(
      path.resolve("/home/example/.codex/config.toml"),
    );
    expect(() => resolveCodexConfigPath({ CODEX_HOME: " " })).toThrow(
      "non-empty",
    );
  });
});
