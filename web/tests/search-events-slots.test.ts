import test from 'node:test';
import assert from 'node:assert/strict';
import {
  searchEventsParameters,
  slotsToPlan,
  type SearchEventSlots,
} from '../agent/tools/search-events.ts';

const now = new Date('2026-11-04T09:00:00.000Z');

void test('structured slots produce one validated plan with OR places and categories', () => {
  const result = slotsToPlan(
    {
      dateFrom: '2026-11-07',
      dateTo: '2026-11-08',
      timeFrom: '18:00',
      timeFromExclusive: true,
      places: ['Kadıköy', 'Beşiktaş'],
      excludePlaces: ['Taksim'],
      categories: ['concert', 'dance'],
      excludeCategories: ['festival'],
      topics: ['jazz', 'ballet'],
      excludeTopics: ['rock'],
      maxPrice: 1000,
      maxPriceExclusive: true,
      budgetBasis: 'group_total',
      partySize: 2,
      audience: 'adults',
      attendeeAges: [21],
      order: 'cheapest',
    },
    now,
  );
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.equal(result.plan.order, 'cheapest');
  assert.deepEqual(result.plan.hard, {
    type: 'all',
    children: [
      { type: 'atom', atom: { kind: 'date', from: '2026-11-07', to: '2026-11-08' } },
      { type: 'atom', atom: { kind: 'time', from: '18:00', fromExclusive: true } },
      {
        type: 'any',
        children: [
          { type: 'atom', atom: { kind: 'location', name: 'Kadıköy', precision: 'district' } },
          { type: 'atom', atom: { kind: 'location', name: 'Beşiktaş', precision: 'district' } },
        ],
      },
      {
        type: 'not',
        child: { type: 'atom', atom: { kind: 'location', name: 'Beyoğlu', precision: 'district' } },
      },
      {
        type: 'any',
        children: [
          { type: 'atom', atom: { kind: 'category', value: 'concert' } },
          { type: 'atom', atom: { kind: 'category', value: 'dance' } },
        ],
      },
      { type: 'not', child: { type: 'atom', atom: { kind: 'category', value: 'festival' } } },
      {
        type: 'any',
        children: [
          { type: 'atom', atom: { kind: 'topic', value: 'jazz' } },
          { type: 'atom', atom: { kind: 'topic', value: 'ballet' } },
        ],
      },
      { type: 'not', child: { type: 'atom', atom: { kind: 'topic', value: 'rock' } } },
      { type: 'atom', atom: { kind: 'party', count: 2 } },
      {
        type: 'atom',
        atom: {
          kind: 'budget',
          comparison: 'lt',
          amount: 1000,
          currency: 'TRY',
          basis: 'group_total',
        },
      },
      { type: 'atom', atom: { kind: 'age', years: 18 } },
      { type: 'atom', atom: { kind: 'age', years: 21 } },
    ],
  });
});

void test('neighborhood and side slots become verifiable parent locations', () => {
  const result = slotsToPlan({ places: ['Moda', 'anadolu', 'Levent'] }, now);
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.deepEqual(result.plan.hard, {
    type: 'all',
    children: [
      {
        type: 'any',
        children: [
          { type: 'atom', atom: { kind: 'location', name: 'Kadıköy', precision: 'district' } },
          { type: 'atom', atom: { kind: 'location', name: 'Anadolu yakası', precision: 'side' } },
          { type: 'atom', atom: { kind: 'location', name: 'Avrupa yakası', precision: 'side' } },
        ],
      },
    ],
  });
});

void test('one date slot becomes a single inclusive day', () => {
  const result = slotsToPlan({ dateFrom: '2026-11-07' }, now);
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.deepEqual(result.plan.hard, {
    type: 'all',
    children: [{ type: 'atom', atom: { kind: 'date', from: '2026-11-07', to: '2026-11-07' } }],
  });
});

void test('slot validation returns a specific needs_input reason for every failure', () => {
  const cases: Array<[SearchEventSlots, string]> = [
    [{ dateFrom: '2026-02-30' }, 'invalid_date'],
    [{ dateFrom: '2026-11-03' }, 'past_date'],
    [{ dateFrom: '2027-03-04' }, 'date_out_of_range'],
    [{ dateFrom: '2026-11-08', dateTo: '2026-11-07' }, 'invalid_date_range'],
    [{ timeFrom: '20:00', timeTo: '18:00' }, 'invalid_time_range'],
    [{ places: ['Atlantis'] }, 'unknown_place'],
    [{ categories: ['opera'] }, 'unknown_category'],
    [{ maxPrice: 500 }, 'budget_basis_required'],
    [{ maxPrice: 500, budgetBasis: 'group_total' }, 'party_size_required'],
    [{ budgetBasis: 'per_ticket' }, 'invalid_budget'],
    [{ order: 'nearest' }, 'invalid_plan'],
  ] as Array<[SearchEventSlots, string]>;
  for (const [slots, reason] of cases)
    assert.deepEqual(slotsToPlan(slots, now), { status: 'needs_input', reason });
});

void test('the public schema exposes closed enums for places and categories', () => {
  assert.equal(
    searchEventsParameters.safeParse({ request: 'x', places: ['Atlantis'] }).success,
    false,
  );
  assert.equal(
    searchEventsParameters.safeParse({ request: 'x', categories: ['opera'] }).success,
    false,
  );
  assert.equal(
    searchEventsParameters.safeParse({
      request: 'Anadolu yakasında bale',
      places: ['anadolu'],
      categories: ['dance'],
    }).success,
    true,
  );
});
