import { expect, test } from '@playwright/test';

test('viewer loads and shows the title and sim version', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Evolution Island');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Evolution Island');
  await expect(page.getByText(/sim v\d+/)).toBeVisible();
});
