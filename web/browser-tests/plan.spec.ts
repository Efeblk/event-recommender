import { expect, test } from '@playwright/test';

const card = {
  id: 'event-1',
  title: 'Gece Cazı',
  startsAt: '2026-10-03T17:00:00.000Z',
  checkedAt: '2026-10-02T11:05:00.000Z',
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

const ndjson = (events: unknown[]) =>
  events.map((event) => JSON.stringify(event)).join('\n') + '\n';

test.describe('plan assistant', () => {
  test('streams tool status, text and cards from tool results', async ({
    page,
  }) => {
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
    await expect(
      page.getByText('Gece Cazı cumartesi akşamı için uygun.'),
    ).toBeVisible();
    await expect(page.getByText('Etkinlikler aranıyor')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Gece Cazı' }),
    ).toBeVisible();
    await expect(page.getByText(/Kontrol edildi: 2 Eki/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Bubilet/ })).toHaveAttribute(
      'href',
      card.url,
    );

    await page.getByLabel('Mesajın').fill('daha ucuz olsun');
    await page.keyboard.press('Enter');
    await expect.poll(() => bodies.length).toBe(2);
    const [first, second] = bodies as { sessionId: string; message: string }[];
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.message).toBe('daha ucuz olsun');
  });

  test('shows a clear message when the assistant is not configured', async ({
    page,
  }) => {
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
    await expect(page.getByRole('alert')).toHaveText(
      'Asistan henüz yapılandırılmadı.',
    );
    await expect(page.getByLabel('Mesajın')).toBeEnabled();
  });

  test('a new conversation uses a new session', async ({ page }) => {
    const sessions: string[] = [];
    await page.route('**/api/agent', async (route) => {
      sessions.push(
        (route.request().postDataJSON() as { sessionId: string }).sessionId,
      );
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

  test('renders safe assistant Markdown and English tool status', async ({
    page,
  }) => {
    await page.route('**/api/agent', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: ndjson([
          { type: 'tool', name: 'search_events' },
          {
            type: 'text',
            text: '**Good options**\n* First event\n* Second event\n\n<script>alert(1)</script> <b>unsafe</b>',
          },
          { type: 'done' },
        ]),
      }),
    );
    await page.goto('/plan');
    await page.getByLabel('Mesajın').fill('Find jazz events');
    await page.getByRole('button', { name: 'Gönder' }).click();

    const answer = page.locator('.agent-turn-assistant');
    await expect(answer.getByText('Searching events')).toBeVisible();
    await expect(answer.locator('strong')).toHaveText('Good options');
    await expect(answer.locator('li')).toHaveCount(2);
    await expect(answer).toContainText(
      '<script>alert(1)</script> <b>unsafe</b>',
    );
    await expect(answer).not.toContainText('**Good options**');
    await expect(answer.locator('script, b')).toHaveCount(0);
  });

  test('keeps the plan link visible on a narrow home page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/events', (route) =>
      route.fulfill({
        json: {
          events: [],
          total: 0,
          aiEnabled: false,
          catalog: { status: 'ready', stored: 0, eligible: 0 },
        },
      }),
    );
    await page.route('**/api/site', (route) =>
      route.fulfill({ json: { donationUrl: null } }),
    );
    await page.goto('/');
    const link = page.getByRole('link', { name: 'Plan asistanı' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/plan');
    await expect(link).toBeInViewport();
  });
});
