import { test, expect } from '@playwright/test';

test.describe('Workspace Validation & Management', () => {
  test('should display an error when adding a directory missing platformio.ini', async ({ page }) => {
    // Navigates to app
    await page.goto('/');

    // Mock the /api/workspaces/browse endpoint to simulate an invalid workspace selection
    await page.route('**/api/workspaces/browse', async route => {
      await route.fulfill({
        status: 200,
        json: { error: 'Not a valid PlatformIO project. Missing platformio.ini.' }
      });
    });

    // Click on the workspace dropdown (it might say "No Project Selected" or something else)
    // There's a button with the text "No Project Selected" or the current workspace
    // Let's click the dropdown trigger
    await page.click('button.ant-dropdown-trigger');

    // Click on "Open Project"
    await page.click('text=Open Project');

    // Verify error message is displayed
    await expect(page.locator('.ant-message-notice-content')).toContainText('Not a valid PlatformIO project');
  });

  test('should add the workspace when selecting a valid PlatformIO directory', async ({ page }) => {
    await page.goto('/');

    // Mock the /api/workspaces/browse endpoint to simulate a valid workspace selection
    const mockPath = '/Users/test/valid-pio-project';
    await page.route('**/api/workspaces/browse', async route => {
      await route.fulfill({
        status: 200,
        json: { path: mockPath }
      });
    });

    // Click on the workspace dropdown
    await page.click('button.ant-dropdown-trigger');

    // Click on "Open Project"
    await page.click('text=Open Project');

    // Verify success message is displayed
    await expect(page.locator('.ant-message-notice-content')).toContainText(`Tracking workspace: ${mockPath}`);
  });

  test('auto-track switch should be toggleable', async ({ page }) => {
    await page.goto('/');
    
    // Find the switch
    // It's next to "AUTO-TRACK"
    const autoTrackSwitch = page.locator('.ant-switch').first();
    
    // It should be visible
    await expect(autoTrackSwitch).toBeVisible();
    
    // Toggle it
    await autoTrackSwitch.click();
  });
});

