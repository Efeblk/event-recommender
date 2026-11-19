import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BundledCatalogReadOnlyError,
  bundledEventCount,
  createBundledStore,
} from '../lib/store.bundled.ts';
import { emptyFilters, type EventRecord } from '../lib/types.ts';

const loadedAt = new Date('2026-11-18T09:00:00.000Z');
function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'source-a',
    title: 'Sample Concert',
    description: 'A recorded concert listing.',
    startsAt: '2026-12-01T17:00:00.000Z',
    checkedAt: '2026-11-17T09:00:00.000Z',
    venue: 'Sample Hall',
    city: 'İstanbul',
    district: 'Kadıköy',
    address: 'Sample address',
    price: 500,
    currency: 'TRY',
    url: 'https://biletinial.example/sample',
    imageUrl: '',
    category: 'Konser',
    availability: 'available',
    source: 'biletinial',
    ...overrides,
  };
}

void test('tracked bundled catalog has the expected source record count', () => {
  assert.equal(bundledEventCount(), 4076);
});

void test('bundled backend uses the evidence window and deduplicates sessions', async () => {
  const store = createBundledStore(
    [
      event(),
      event({
        id: 'source-b',
        source: 'bubilet',
        url: 'https://bubilet.example/sample',
        price: 450,
      }),
    ],
    { loadedAt, consumeLimit: async () => true },
  );
  const candidates = await store.candidates(emptyFilters, loadedAt);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].preparedSearch?.version, 1);
  assert.deepEqual(
    new Set(candidates[0].offers?.map(({ id }) => id)),
    new Set(['source-a', 'source-b']),
  );
  assert.deepEqual(await store.catalogStatus(loadedAt), {
    status: 'ready',
    stored: 2,
    eligible: 1,
    lastCheckedAt: '2026-11-17T09:00:00.000Z',
    oldestCheckedAt: '2026-11-17T09:00:00.000Z',
    expiresAt: '2026-11-20T09:00:00.000Z',
  });
  const staleAt = new Date('2026-11-20T09:00:00.001Z');
  assert.deepEqual(await store.candidates(emptyFilters, staleAt), []);
  assert.equal((await store.catalogStatus(staleAt)).status, 'stale');
});

void test('bundled backend refuses catalog writes', async () => {
  const store = createBundledStore([event()], {
    loadedAt,
    consumeLimit: async () => true,
  });
  await assert.rejects(
    store.acquireLease('sync_lock'),
    BundledCatalogReadOnlyError,
  );
});
