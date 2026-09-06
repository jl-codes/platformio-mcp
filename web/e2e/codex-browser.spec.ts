import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

let closePortal: () => Promise<void>;
let dataDirectory: string;
let getDashboardStatus: (typeof import("../../src/api/server.js"))["getDashboardStatus"];
let startPortalServer: (typeof import("../../src/api/server.js"))["startPortalServer"];

async function openSanitizedDashboard(page: Page) {
  await page.route("**/api/hardware", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/workspaces", async (route) => {
    await route.fulfill({ json: ["/demo/codex-blink"] });
  });
  await page.route("**/api/commands?*", async (route) => {
    await route.fulfill({ json: [] });
  });

  const launch = await getDashboardStatus(false);
  await page.goto(launch.launchUrl);
  await expect(page).toHaveURL(`${launch.baseUrl}/`);
  await expect(page.locator(".cockpit-shell")).toBeVisible();
  return launch;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dataDirectory = mkdtempSync(join(tmpdir(), "pio-mcp-codex-browser-"));
  process.env.PIO_MCP_DATA_DIR = dataDirectory;
  process.env.PORTAL_PORT = "0";
  process.env.PIO_MCP_NO_BROWSER = "true";
  ({ getDashboardStatus, startPortalServer } =
    await import("../../src/api/server.js"));
  const portal = startPortalServer(0);
  closePortal = portal.close;
  if (!portal.httpServer.listening) {
    await new Promise<void>((resolve) =>
      portal.httpServer.once("listening", resolve),
    );
  }
});

test.afterAll(async () => {
  await closePortal();
  rmSync(dataDirectory, { recursive: true, force: true });
  delete process.env.PIO_MCP_DATA_DIR;
  delete process.env.PORTAL_PORT;
  delete process.env.PIO_MCP_NO_BROWSER;
});

test("opens the real dashboard through a single-use Codex browser session", async ({
  page,
}) => {
  const launch = await openSanitizedDashboard(page);
  await expect(page.getByText("PLATFORMIO MCP")).toBeVisible();
  await expect(page.getByText("CODEX SESSION")).toBeVisible();
  expect(launch.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  expect(launch.token).toBe("[REDACTED_DEPRECATED]");
  expect(page.url()).not.toContain("ticket=");

  const replay = await page.request.get(launch.launchUrl, { maxRedirects: 0 });
  expect(replay.status()).toBe(401);
});

test("remains operable in a narrow right-side Codex panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 760 });
  await openSanitizedDashboard(page);
  await expect(page.locator(".cockpit-shell")).toBeVisible();
  await expect(page.locator(".cockpit-command-feed")).toBeVisible();
  await expect(page.locator(".cockpit-task-detail")).toBeVisible();

  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    feedWidth: document
      .querySelector(".cockpit-command-feed")
      ?.getBoundingClientRect().width,
    detailWidth: document
      .querySelector(".cockpit-task-detail")
      ?.getBoundingClientRect().width,
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.feedWidth).toBeGreaterThan(300);
  expect(geometry.detailWidth).toBeGreaterThan(300);
  expect(
    Math.abs((geometry.feedWidth ?? 0) - (geometry.detailWidth ?? 0)),
  ).toBeLessThan(2);
});

test("captures a sanitized plugin dashboard screenshot", async ({ page }) => {
  test.skip(
    process.env.PIO_MCP_CAPTURE_SCREENSHOT !== "1",
    "Screenshot capture is an explicit release task.",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSanitizedDashboard(page);
  await expect(page.getByText("CODEX SESSION")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select PlatformIO project" }),
  ).toContainText("codex-blink");

  const screenshotPath = resolve(
    process.cwd(),
    "..",
    "plugins",
    "platformio-mcp",
    "assets",
    "screenshot-dashboard.png",
  );
  mkdirSync(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  expect(screenshotPath).not.toContain(dataDirectory);
});
