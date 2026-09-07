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
  await page.route("**/api/system/info*", async (route) => {
    await route.fulfill({
      json: {
        core_version: { value: "6.1.16" },
        python_version: { value: "3.14.4-final.0" },
        system: { value: "windows_amd64" },
        global_lib_nums: { value: 0 },
      },
    });
  });
  await page.route("**/api/projects/config?*", async (route) => {
    await route.fulfill({
      json: [
        [
          "env:esp32dev",
          [
            ["platform", "espressif32"],
            ["board", "esp32dev"],
            ["framework", "arduino"],
          ],
        ],
      ],
    });
  });
  await page.route("**/api/libraries/installed?*", async (route) => {
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
  await expect(page).toHaveTitle("PIO Agent");
  await expect(page.getByText("PIO AGENT")).toBeVisible();
  await expect(page.getByRole("img", { name: "PIO Agent" })).toHaveAttribute(
    "src",
    "/pio_agent.png",
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/pio_agent.png",
  );
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

test("keeps the medium-width Codex header on one line", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 760 });
  await openSanitizedDashboard(page);

  await expect(page.locator(".cockpit-title")).toBeVisible();
  await expect(page.locator(".cockpit-auto-track-label")).toBeHidden();
  await expect(page.locator(".cockpit-session-badge")).toBeHidden();
  await expect(page.locator(".cockpit-server-label")).toBeVisible();

  const geometry = await page.evaluate(() => {
    const header = document
      .querySelector<HTMLElement>(".cockpit-header")
      ?.getBoundingClientRect();
    const visibleItems = [
      ".cockpit-title",
      ".cockpit-project-select",
      ".cockpit-server-label",
      ".cockpit-header-actions [role='switch']",
    ]
      .map((selector) => {
        const rect = document
          .querySelector<HTMLElement>(selector)
          ?.getBoundingClientRect();
        return rect
          ? {
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
              selector,
              top: rect.top,
            }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    return {
      headerBottom: header?.bottom,
      headerTop: header?.top,
      itemsOutsideHeader: visibleItems.filter(
        (item) =>
          item.top < (header?.top ?? 0) - 1 ||
          item.bottom > (header?.bottom ?? 0) + 1 ||
          item.left < 0 ||
          item.right > window.innerWidth,
      ),
    };
  });

  expect(geometry.headerTop).toBe(0);
  expect(geometry.headerBottom).toBe(72);
  expect(geometry.itemsOutsideHeader).toEqual([]);
});

test("keeps project telemetry readable at the minimum Codex panel width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await openSanitizedDashboard(page);
  await page.locator(".cockpit-activity-bar .ant-menu-item").nth(1).click();

  await expect(page.getByText("PIO Core", { exact: true })).toBeVisible();
  await expect(page.getByText("windows_amd64", { exact: true })).toBeVisible();
  await expect(page.getByText("esp32dev", { exact: true }).first()).toBeVisible();

  const geometry = await page.evaluate(() => {
    const configView = document.querySelector<HTMLElement>(
      ".cockpit-config-view",
    );
    const workspace = document.querySelector<HTMLElement>(
      ".workspace-config",
    );
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(".workspace-config .ant-card"),
    );
    const cardTitles = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".workspace-config .ant-card-head-title",
      ),
    );
    return {
      configClientWidth: configView?.clientWidth,
      configScrollWidth: configView?.scrollWidth,
      overflowingCardTitles: cardTitles.filter(
        (title) => title.scrollWidth > title.clientWidth,
      ).length,
      workspaceRight: workspace?.getBoundingClientRect().right,
      widestCardRight: Math.max(
        0,
        ...cards.map((card) => card.getBoundingClientRect().right),
      ),
      viewportWidth: window.innerWidth,
    };
  });

  expect(geometry.configScrollWidth).toBeLessThanOrEqual(
    geometry.configClientWidth ?? 0,
  );
  expect(geometry.overflowingCardTitles).toBe(0);
  expect(geometry.workspaceRight).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.widestCardRight).toBeLessThanOrEqual(geometry.viewportWidth);
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
