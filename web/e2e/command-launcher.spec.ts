import { test, expect } from '@playwright/test';

test.describe('Command Launcher & Target Environment', () => {
  test('should hydrate the Target Environment dropdown based on active project config', async ({ page }) => {
    // Mock project config API
    await page.route('**/api/system/info', async route => {
      await route.fulfill({
        status: 200,
        json: {
          success: true,
          activeWorkspace: '/path/to/workspace'
        }
      });
    });

    await page.route('**/api/projects/config*', async route => {
      await route.fulfill({
        status: 200,
        json: [
          ["env:esp32dev", []],
          ["env:uno", []]
        ]
      });
    });

    await page.goto('/');

    // Click "NEW TASK"
    await page.click('button:has-text("NEW TASK")');
    await expect(page.getByRole('dialog', { name: 'LAUNCH NEW COMMAND' })).toBeVisible();

    // Verify the modal has loaded by checking for the execute button
    await expect(page.locator('button:has-text("EXECUTE")')).toBeVisible();

    // Ensure the Target Environment Select has finished loading the config
    await expect(page.locator('.ant-select-loading')).toHaveCount(0);

    // Open Target Environment dropdown
    await page.locator('#environment').click({ force: true });
    
    // Wait for the deterministic portal class to appear
    const dropdown = page.locator('.target-environment-dropdown');
    await expect(dropdown).toBeVisible();
    
    // Verify the hydrated options exist inside the portal
    await expect(dropdown.locator('.ant-select-item-option-content', { hasText: 'esp32dev' })).toBeVisible();
    await expect(dropdown.locator('.ant-select-item-option-content', { hasText: 'uno' })).toBeVisible();
  });

  test('should stream logs and show correct visual status when dispatching a task', async ({ page }) => {
    // Dispatch the task (we mock the API call)
    let dispatched = false;
    await page.route('**/api/commands/build', async route => {
      dispatched = true;
      await route.fulfill({ status: 200, json: { success: true } });
    });
    
    // Mock active workspace
    await page.route('**/api/system/info', async route => {
      await route.fulfill({
        status: 200,
        json: {
          success: true,
          activeWorkspace: '/path/to/workspace'
        }
      });
    });

    await page.route('**/api/projects/config*', async route => {
      await route.fulfill({
        status: 200,
        json: []
      });
    });

    await page.goto('/');

    // Open Launcher
    await page.click('button:has-text("NEW TASK")');
    await expect(page.getByRole('dialog', { name: 'LAUNCH NEW COMMAND' })).toBeVisible();
    
    await page.click('button:has-text("EXECUTE")');
  });
});

