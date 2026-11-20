import test from 'node:test';
import assert from 'node:assert/strict';
import {
  searchEventsParameters,
  slotsToPlan,
  type SearchEventSlots,
} from '../agent/tools/search-events.ts';
import { evaluatePlan } from '../lib/plan-evidence.ts';
import type { EventRecord } from '../lib/types.ts';

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
      {
        type: 'atom',
        atom: { kind: 'date', from: '2026-11-07', to: '2026-11-08' },
      },
      {
        type: 'atom',
        atom: { kind: 'time', from: '18:00', fromExclusive: true },
      },
      {
        type: 'any',
        children: [
          {
            type: 'atom',
            atom: { kind: 'location', name: 'Kadıköy', precision: 'district' },
          },
          {
            type: 'atom',
            atom: { kind: 'location', name: 'Beşiktaş', precision: 'district' },
          },
        ],
      },
      {
        type: 'not',
        child: {
          type: 'atom',
          atom: { kind: 'location', name: 'Beyoğlu', precision: 'district' },
        },
      },
      {
        type: 'any',
        children: [
          { type: 'atom', atom: { kind: 'category', value: 'concert' } },
          { type: 'atom', atom: { kind: 'category', value: 'dance' } },
        ],
      },
      {
        type: 'not',
        child: { type: 'atom', atom: { kind: 'category', value: 'festival' } },
      },
      {
        type: 'any',
        children: [
          { type: 'atom', atom: { kind: 'topic', value: 'jazz' } },
          { type: 'atom', atom: { kind: 'topic', value: 'ballet' } },
        ],
      },
      {
        type: 'not',
        child: { type: 'atom', atom: { kind: 'topic', value: 'rock' } },
      },
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
      {
        type: 'not',
        child: { type: 'atom', atom: { kind: 'topic', value: 'kids' } },
      },
      { type: 'atom', atom: { kind: 'age', years: 21 } },
    ],
  });
});

void test('free budgets default to per person and reject an impossible strict ceiling', () => {
  const accepted = slotsToPlan({ maxPrice: 0 }, now);
  assert.equal(accepted.status, 'accepted');
  if (accepted.status === 'accepted')
    assert.deepEqual(accepted.plan.hard, {
      type: 'all',
      children: [
        {
          type: 'atom',
          atom: {
            kind: 'budget',
            comparison: 'lte',
            amount: 0,
            currency: 'TRY',
            basis: 'per_person',
          },
        },
      ],
    });
  assert.deepEqual(slotsToPlan({ maxPrice: 0, maxPriceExclusive: true }, now), {
    status: 'needs_input',
    reason: 'invalid_budget',
  });
});

void test('topic slots use canonical lexicon keys before deduplication', () => {
  const result = slotsToPlan(
    { topics: ['caz', 'Jazz'], excludeTopics: ['Komedi'] },
    now,
  );
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.deepEqual(result.plan.hard, {
    type: 'all',
    children: [
      { type: 'atom', atom: { kind: 'topic', value: 'jazz' } },
      {
        type: 'not',
        child: { type: 'atom', atom: { kind: 'topic', value: 'comedy' } },
      },
    ],
  });
  assert.deepEqual(
    slotsToPlan({ topics: ['caz'] }, now),
    slotsToPlan({ topics: ['jazz'] }, now),
  );
});

void test("an adult search rejects a labelled children's play even with a low minimum age", () => {
  const result = slotsToPlan({ audience: 'adults' }, now);
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  const event: EventRecord = {
    id: 'brave-stars',
    title: 'Brave Stars - Çocuk Tiyatrosu',
    description: 'Etkinlikte 5 yaş sınırı bulunmaktadır.',
    startsAt: '2026-11-07T12:00:00.000Z',
    venue: 'Çocuk Sahnesi',
    city: 'İstanbul',
    district: 'Kadıköy',
    address: 'Kadıköy, İstanbul',
    price: 300,
    currency: 'TRY',
    url: 'https://example.test/brave-stars',
    imageUrl: '',
    category: 'Tiyatro',
    availability: 'available',
    checkedAt: '2026-11-04T08:00:00.000Z',
    labels: {
      profile: 'event-labels-v1',
      audience: 'children',
      childSuitable: 0.99,
      minAge: 5,
      maxAge: null,
      place: 'istanbul',
      district: 'Kadıköy',
      category: 'Tiyatro',
      formats: { handsOn: 0, outdoor: 0, seated: 0.9 },
      evidence: {
        audience: 'Brave Stars - Çocuk Tiyatrosu',
        age: 'Etkinlikte 5 yaş sınırı bulunmaktadır.',
      },
    },
  };
  assert.equal(evaluatePlan(event, result.plan, now).status, 'contradicted');
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
          {
            type: 'atom',
            atom: { kind: 'location', name: 'Kadıköy', precision: 'district' },
          },
          {
            type: 'atom',
            atom: {
              kind: 'location',
              name: 'Anadolu yakası',
              precision: 'side',
            },
          },
          {
            type: 'atom',
            atom: {
              kind: 'location',
              name: 'Avrupa yakası',
              precision: 'side',
            },
          },
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
    children: [
      {
        type: 'atom',
        atom: { kind: 'date', from: '2026-11-07', to: '2026-11-07' },
      },
    ],
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
    assert.deepEqual(slotsToPlan(slots, now), {
      status: 'needs_input',
      reason,
    });
});

void test('the public schema exposes closed enums for places and categories', () => {
  assert.equal(
    searchEventsParameters.safeParse({ request: 'x', places: ['Atlantis'] })
      .success,
    false,
  );
  assert.equal(
    searchEventsParameters.safeParse({ request: 'x', categories: ['opera'] })
      .success,
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
