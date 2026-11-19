import assert from 'node:assert/strict';
import test from 'node:test';

import { eventCard, eventFacts, istanbulTime } from '../agent/cards.ts';
import { eventDetails } from '../agent/tools/event-details.ts';
import type { EventRecord } from '../lib/types.ts';

const event: EventRecord = {
  id: 'source-a',
  title: 'Sample Stand-up',
  description: 'A recorded stand-up listing.',
  startsAt: '2026-11-20T17:30:00.000Z',
  checkedAt: '2026-11-18T21:30:00.000Z',
  venue: 'Sample Stage',
  city: 'İstanbul',
  district: 'Kadıköy',
  address: 'Sample address',
  price: 250,
  currency: 'TRY',
  url: 'https://biletinial.example/sample',
  imageUrl: '',
  category: 'Stand-up',
  availability: 'available',
  source: 'biletinial',
};

void test('model-facing times use the Istanbul wall clock', () => {
  assert.equal(istanbulTime('2026-11-20T17:30:00.000Z'), 'Fri 2026-11-20 20:30');
  assert.equal(istanbulTime('2026-11-20T22:15:00.000Z'), 'Sat 2026-11-21 01:15');
  assert.equal(istanbulTime(null), null);
  assert.equal(istanbulTime('not a date'), 'not a date');
});

void test('search facts and details give the model Istanbul time, cards keep ISO time', () => {
  assert.equal(eventFacts(event).startsAt, 'Fri 2026-11-20 20:30');
  assert.equal(eventDetails(event).startsAt, 'Fri 2026-11-20 20:30');
  assert.equal(eventCard(event).startsAt, '2026-11-20T17:30:00.000Z');
});
