import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression test for the "million PlatformIO MCP windows" bug.
//
// Symptom: every invocation of getDashboardStatus(true) — whether from the
// get_dashboard_url MCP tool, --open-dashboard-on-start, rehydration, or
// multiple Cline profile launches — spawned a fresh OS browser tab via
// `open()`. Combined with port-creep (8080 → 8081 → 8082 → 8083 → 8084…)
// when multiple MCP instances ran concurrently, the host's default browser
// would be flooded with tabs.
//
// Fix: track activePortalStatus.browserOpened so we only ever call open()
// once per process lifetime, and honor an opt-out env var.
//
// These tests lock that behavior in.

// Mock `open` module-wide so we can count invocations.
const openMock = vi.fn(() => Promise.resolve({} as any));
vi.mock("open", () => ({
  default: openMock,
}));

// Mock platformio executor to avoid hardware-related hangs while booting
// the express server inside getDashboardStatus.
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: {
    spawn: vi.fn(() => ({ pid: 12345, on: vi.fn(), unref: vi.fn() })),
    executeWithJsonOutput: vi.fn(() => Promise.resolve([])),
  },
  checkPlatformIOInstalled: vi.fn(() => Promise.resolve(true)),
}));

describe("Dashboard browser auto-open is idempotent (regression: million-windows bug)", () => {
  beforeEach(() => {
    openMock.mockClear();
    process.env.PORTAL_PORT = "0"; // ephemeral
    delete process.env.PIO_MCP_NO_BROWSER;
    delete process.env.PIO_MCP_DISABLE_DASHBOARD;
  });

  it("calls open() at most once across many getDashboardStatus(true) invocations", async () => {
    const { getDashboardStatus } = await import("../src/api/server.js");

    // Simulate the failure scenario: many rapid calls with autoOpen=true
    // (as would happen from repeated tool invocations + rehydration).
    await getDashboardStatus(true);
    await getDashboardStatus(true);
    await getDashboardStatus(true);
    await getDashboardStatus(true);
    await getDashboardStatus(true);

    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it("does not call open() when autoOpen is false", async () => {
    const { getDashboardStatus, activePortalStatus } = await import(
      "../src/api/server.js"
    );
    // Reset the latched flag in case a prior test in this module flipped it
    activePortalStatus.browserOpened = false;
    openMock.mockClear();

    await getDashboardStatus(false);
    await getDashboardStatus(false);

    expect(openMock).not.toHaveBeenCalled();
  });

  it("does not call open() when PIO_MCP_NO_BROWSER=true even with autoOpen=true", async () => {
    const { getDashboardStatus, activePortalStatus } = await import(
      "../src/api/server.js"
    );
    activePortalStatus.browserOpened = false;
    openMock.mockClear();
    process.env.PIO_MCP_NO_BROWSER = "true";

    await getDashboardStatus(true);
    await getDashboardStatus(true);

    expect(openMock).not.toHaveBeenCalled();

    delete process.env.PIO_MCP_NO_BROWSER;
  });
});
