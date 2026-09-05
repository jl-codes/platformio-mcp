import { expect, test } from "@playwright/test";
import {
  getDashboardStatus,
  startPortalServer,
} from "../../src/api/server.js";

let closePortal: () => Promise<void>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  process.env.PORTAL_PORT = "0";
  process.env.PIO_MCP_NO_BROWSER = "true";
  const portal = startPortalServer(0);
  closePortal = portal.close;
  if (!portal.httpServer.listening) {
    await new Promise<void>((resolve) => portal.httpServer.once("listening", resolve));
  }
});

test.afterAll(async () => {
  await closePortal();
  delete process.env.PORTAL_PORT;
  delete process.env.PIO_MCP_NO_BROWSER;
});

test("opens the real dashboard through a single-use Codex browser session", async ({
  page,
}) => {
  const launch = await getDashboardStatus(false);
  expect(launch.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  expect(launch.token).toBe("[REDACTED_DEPRECATED]");

  await page.goto(launch.launchUrl);
  await expect(page).toHaveURL(`${launch.baseUrl}/`);
  await expect(page.getByText("PLATFORMIO MCP")).toBeVisible();
  await expect(page.getByText("CODEX SESSION")).toBeVisible();
  expect(page.url()).not.toContain("ticket=");

  const replay = await page.request.get(launch.launchUrl, { maxRedirects: 0 });
  expect(replay.status()).toBe(401);
});

test("remains operable in a narrow right-side Codex panel", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 760 });
  const launch = await getDashboardStatus(false);
  await page.goto(launch.launchUrl);
  await expect(page.locator(".cockpit-shell")).toBeVisible();
  await expect(page.locator(".cockpit-command-feed")).toBeVisible();
  await expect(page.locator(".cockpit-task-detail")).toBeVisible();

  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    feedWidth: document.querySelector(".cockpit-command-feed")?.getBoundingClientRect()
      .width,
    detailWidth: document.querySelector(".cockpit-task-detail")?.getBoundingClientRect()
      .width,
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.feedWidth).toBeGreaterThan(300);
  expect(geometry.detailWidth).toBeGreaterThan(300);
  expect(Math.abs((geometry.feedWidth ?? 0) - (geometry.detailWidth ?? 0))).toBeLessThan(2);
});
