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
    await page.goto('/');
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
    await page.goto('/');
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
    await page.goto('/');
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
    await page.goto('/');
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

  test('waits for hydration before enabling the composer', async ({ page }) => {
    let releaseScripts!: () => void;
    const scriptsReleased = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    let sawScript!: () => void;
    const scriptRequested = new Promise<void>((resolve) => {
      sawScript = resolve;
    });

    await page.route('**/_next/static/**/*.js', async (route) => {
      sawScript();
      await scriptsReleased;
      await route.continue();
    });

    const navigation = page.goto('/', { waitUntil: 'commit' });
    const message = page.getByRole('textbox', { name: 'Mesajın' });
    const send = page.getByRole('button', { name: 'Gönder' });
    const restart = page.getByRole('button', { name: 'Yeni sohbet' });
    try {
      await navigation;
      await scriptRequested;
      await expect(message).toBeDisabled();
      await expect(send).toBeDisabled();
      await expect(restart).toBeDisabled();
    } finally {
      releaseScripts();
    }

    await expect(message).toBeEnabled();
    await expect(send).toBeEnabled();
    await expect(restart).toBeEnabled();
  });

  test('keeps navigation and the composer visible at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Ana menü' });
    const link = nav.getByRole('link', { name: 'Plan asistanı' });
    await expect(link).toHaveAttribute('href', '/');
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(link).toBeInViewport();
    await expect(page.getByRole('link', { name: 'Etkinlikler', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Mesajın' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Gönder' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Yeni sohbet' })).toBeInViewport();
  });

  test('redirects the old /plan URL to the assistant', async ({ page }) => {
    await page.goto('/plan');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Plan asistanı' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mesajın' })).toBeEnabled();
  });
});
