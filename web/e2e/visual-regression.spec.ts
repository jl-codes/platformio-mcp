import { test, expect } from '@playwright/test';

test.describe('Visual Regression & Theme Cohesion', () => {
  test('Light and Dark mode cohesion across components', async ({ page }) => {
    await page.goto('/');

    // Ensure we are loaded
    await page.waitForSelector('.ant-layout');

    // Default could be dark or light. Let's capture baseline.
    await expect(page).toHaveScreenshot('dashboard-baseline.png', {
      mask: [page.locator('.mono-label:has-text("SERVER:")')],
    });

    // Toggle theme
    await page.click('.ant-switch');

    // Capture toggled snapshot
    await expect(page).toHaveScreenshot('dashboard-toggled.png', {
      mask: [page.locator('.mono-label:has-text("SERVER:")')],
    });
  });
});

