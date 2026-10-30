import { expect, test } from '@playwright/test';

const card = {
  id: 'event-1',
  title: 'Gece Cazı',
  startsAt: '2026-10-03T17:00:00.000Z',
  venue: 'Sahne İstanbul',
  district: 'Kadıköy',
  address: 'Kadıköy, İstanbul',
  category: 'Konser',
  price: 450,
  currency: 'TRY',
  priceKind: 'exact',
  availability: 'available',
  url: 'https://tickets.example/event-1',
  imageUrl: '',
  source: 'bubilet',
  offers: [],
};

const ndjson = (events: unknown[]) => events.map((event) => JSON.stringify(event)).join('\n') + '\n';

test.describe('plan assistant', () => {
  test('streams tool status, text and cards from tool results', async ({ page }) => {
    const bodies: unknown[] = [];
    await page.route('**/api/agent', async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: ndjson([
          { type: 'tool', name: 'search_events' },
          { type: 'cards', tool: 'search_events', cards: [card] },
          { type: 'text', text: 'Gece Cazı cumartesi akşamı için uygun.' },
          { type: 'done' },
        ]),
      });
    });
    await page.goto('/plan');
    await page.getByLabel('Mesajın').fill('Cumartesi Kadıköy konser');
    await page.getByRole('button', { name: 'Gönder' }).click();
    await expect(page.getByText('Gece Cazı cumartesi akşamı için uygun.')).toBeVisible();
    await expect(page.getByText('Etkinlikler aranıyor')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Gece Cazı' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Bubilet/ })).toHaveAttribute('href', card.url);

    await page.getByLabel('Mesajın').fill('daha ucuz olsun');
    await page.keyboard.press('Enter');
    await expect.poll(() => bodies.length).toBe(2);
    const [first, second] = bodies as { sessionId: string; message: string }[];
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.message).toBe('daha ucuz olsun');
  });

  test('shows a clear message when the assistant is not configured', async ({ page }) => {
    await page.route('**/api/agent', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'agent_unavailable', error: 'x' }),
      }),
    );
    await page.goto('/plan');
    await page.getByLabel('Mesajın').fill('konser');
    await page.getByRole('button', { name: 'Gönder' }).click();
    await expect(page.getByRole('alert')).toHaveText('Asistan henüz yapılandırılmadı.');
    await expect(page.getByLabel('Mesajın')).toBeEnabled();
  });

  test('a new conversation uses a new session', async ({ page }) => {
    const sessions: string[] = [];
    await page.route('**/api/agent', async (route) => {
      sessions.push((route.request().postDataJSON() as { sessionId: string }).sessionId);
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: ndjson([{ type: 'text', text: 'Tamam.' }, { type: 'done' }]),
      });
    });
    await page.goto('/plan');
    await page.getByLabel('Mesajın').fill('konser');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Tamam.')).toBeVisible();
    await page.getByRole('button', { name: 'Yeni sohbet' }).click();
    await expect(page.getByText('Tamam.')).toHaveCount(0);
    await page.getByLabel('Mesajın').fill('tiyatro');
    await page.keyboard.press('Enter');
    await expect.poll(() => sessions.length).toBe(2);
    expect(sessions[1]).not.toBe(sessions[0]);
  });
});
