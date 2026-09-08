import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareHardwareEvidence,
  sanitizeHardwareEvidence,
} from "../scripts/prepare-hardware-evidence.mjs";

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("hardware evidence preparation", () => {
  it("redacts secrets, host paths, ports, and device identifiers", () => {
    const raw = [
      "password=supersecret",
      "Authorization: Bearer token.value",
      "C:\\Users\\alice\\firmware",
      "/Users/alice/firmware",
      "port=COM17 /dev/cu.usbserial-123",
      "serial_number=ABC123",
      "device_fingerprint=deadbeef",
      "aa:bb:cc:dd:ee:ff",
    ].join("\n");
    const result = sanitizeHardwareEvidence(raw);

    expect(result.redactions).toBeGreaterThanOrEqual(8);
    expect(result.text).not.toMatch(
      /supersecret|token\.value|alice|COM17|usbserial-123|ABC123|deadbeef|aa:bb/iu,
    );
    expect(result.text).toContain("[REDACTED_SECRET]");
    expect(result.text).toContain("[REDACTED_PORT]");
  });

  it("uploads only sanitized copies and a path-free manifest", () => {
    const repositoryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "pio-evidence-"),
    );
    createdDirectories.push(repositoryRoot);
    const logsDirectory = path.join(
      repositoryRoot,
      ".pio-mcp-workspace",
      "logs",
    );
    const auditDirectory = path.join(
      repositoryRoot,
      ".pio-mcp-workspace",
      "audit",
    );
    const outputDirectory = path.join(repositoryRoot, "safe-artifact");
    fs.mkdirSync(logsDirectory, { recursive: true });
    fs.mkdirSync(auditDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(logsDirectory, "monitor.log"),
      "token=secret-value port=COM9\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(auditDirectory, "events.jsonl"),
      '{"password":"hidden"}\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(logsDirectory, "firmware.bin"),
      "raw-secret",
      "utf8",
    );

    const result = prepareHardwareEvidence({ repositoryRoot, outputDirectory });
    expect(result.files).toHaveLength(2);
    const manifestText = fs.readFileSync(
      path.join(outputDirectory, "manifest.json"),
      "utf8",
    );
    const monitorText = fs.readFileSync(
      path.join(outputDirectory, "workspace-logs", "monitor.log.txt"),
      "utf8",
    );
    expect(manifestText).not.toContain(repositoryRoot);
    expect(monitorText).not.toMatch(/secret-value|COM9/iu);
    expect(
      fs.existsSync(
        path.join(outputDirectory, "workspace-logs", "firmware.bin.txt"),
      ),
    ).toBe(false);
  });

  it("collects a selected nested fixture without allowing path escape", () => {
    const repositoryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "pio-evidence-project-"),
    );
    createdDirectories.push(repositoryRoot);
    const projectDirectory = path.join(repositoryRoot, "examples", "board");
    const auditDirectory = path.join(
      projectDirectory,
      ".pio-mcp-workspace",
      "audit",
    );
    const outputDirectory = path.join(repositoryRoot, "safe-artifact");
    fs.mkdirSync(auditDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(auditDirectory, "hardware-acceptance.json"),
      '{"initialPort":"/dev/ttyUSB0","deviceFingerprint":"abc123"}\n',
      "utf8",
    );

    const result = prepareHardwareEvidence({
      repositoryRoot,
      projectDirectory,
      outputDirectory,
    });
    expect(result.files).toHaveLength(1);
    expect(
      fs.readFileSync(
        path.join(
          outputDirectory,
          "workspace-audit",
          "hardware-acceptance.json.txt",
        ),
        "utf8",
      ),
    ).not.toMatch(/ttyUSB0|abc123/iu);
    expect(() =>
      prepareHardwareEvidence({
        repositoryRoot,
        projectDirectory: path.dirname(repositoryRoot),
        outputDirectory,
      }),
    ).toThrow("must be inside");
  });
});
