import { expect, test } from '@playwright/test';

test.describe('saved plans', () => {
  test('explains that sign-in is off when the server has no Firebase settings', async ({ page }) => {
    await page.route('**/api/site', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ donationUrl: null, requestLog: false, intentVersion: 1, firebase: null }),
      }),
    );
    await page.goto('/saved');
    await expect(page.getByRole('heading', { name: 'Kayıtlarım' })).toBeVisible();
    await expect(page.getByText('Giriş bu sunucuda kapalı.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0);
  });

  test('the plan assistant hides sign-in and favorites without Firebase settings', async ({ page }) => {
    await page.goto('/plan');
    await expect(page.getByRole('heading', { name: 'Plan asistanı' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Kayıtlarım' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0);
  });
});
