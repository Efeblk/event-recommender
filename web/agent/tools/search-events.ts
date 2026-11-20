import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import type { EventRecord, SearchResult } from '../../lib/types.ts';
import { checkAgeEvidence } from '../../lib/age-evidence.ts';
import { normalize } from '../../lib/search.ts';
import { validateSearchPlan } from '../../lib/plan-evidence.ts';
import type {
  Atom,
  BudgetBasis,
  Category,
  Condition,
  Order,
  Plan,
} from '../../parser/contract.ts';
import { DISTRICTS, fold, NEIGHBORHOODS } from '../../parser/lexicon.ts';
import { placeOf } from '../../../contracts/location.ts';
import { eventCard, eventFacts, type AgentEventCard } from '../cards.ts';

export const MAX_SEARCH_RESULTS = 10;
export const MAX_REQUEST_CHARS = 600;

export interface SearchEventsDeps {
  /** The stateless v1 pipeline. One complete request in, checked events out. */
  search: (request: string) => Promise<SearchResult>;
  /** The same pipeline with Gemini's checked structured plan. */
  searchPlan?: (request: string, plan: Plan) => Promise<SearchResult>;
  showCards: (cards: AgentEventCard[]) => void;
  now?: () => Date;
}

const categoryValues = [
  'concert',
  'theatre',
  'standup',
  'workshop',
  'exhibition',
  'festival',
  'sport',
  'cinema',
  'talk',
  'dance',
  'show',
  'course',
  'tour',
  'museum',
] as const satisfies readonly Category[];
const placeValues = [
  DISTRICTS[0]!,
  ...DISTRICTS.slice(1),
  ...NEIGHBORHOODS,
  'avrupa',
  'anadolu',
] as [string, ...string[]];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const places = z.array(z.enum(placeValues)).min(1).max(8);
const categories = z.array(z.enum(categoryValues)).min(1).max(categoryValues.length);
const topics = z.array(z.string().trim().min(1).max(80)).min(1).max(8);

export const searchEventsParameters = z.object({
  request: z
    .string()
    .trim()
    .min(1)
    .max(MAX_REQUEST_CHARS)
    .describe(
      'One complete, self-contained event request in the user\'s language. ' +
        'Include every condition from the conversation that still applies: dates, ' +
        'times, districts or side, budget, categories, exclusions, ages, group.',
    ),
  dateFrom: date.optional().describe('First Istanbul calendar date, YYYY-MM-DD.'),
  dateTo: date.optional().describe('Last Istanbul calendar date, YYYY-MM-DD.'),
  timeFrom: time.optional().describe('Earliest Istanbul start time, HH:MM.'),
  timeTo: time.optional().describe('Latest Istanbul start time, HH:MM.'),
  timeFromExclusive: z.boolean().optional().describe('True only when the start must be after timeFrom.'),
  timeToExclusive: z.boolean().optional().describe('True only when the start must be before timeTo.'),
  places: places.optional().describe(
    'Accepted Istanbul districts, neighborhoods, or side: "avrupa" or "anadolu". Several values mean OR.',
  ),
  excludePlaces: places.optional().describe('Istanbul places that must not match.'),
  categories: categories.optional().describe('Accepted event categories. Several values mean OR.'),
  excludeCategories: categories.optional().describe('Event categories that must not match.'),
  topics: topics.optional().describe('Named genres or topics. Several values mean OR.'),
  excludeTopics: topics.optional().describe('Named genres or topics that must not match.'),
  maxPrice: z.number().nonnegative().max(1_000_000).optional().describe('Maximum price in TRY.'),
  maxPriceExclusive: z.boolean().optional().describe('True only when an event at exactly maxPrice is too expensive.'),
  budgetBasis: z.enum(['per_person', 'per_ticket', 'group_total']).optional(),
  partySize: z.number().int().min(1).max(50).optional(),
  audience: z.enum(['children', 'family', 'adults']).optional(),
  attendeeAges: z.array(z.number().int().min(0).max(120)).min(1).max(20).optional(),
  order: z.enum(['none', 'soonest', 'cheapest']).optional(),
});

export type SearchEventSlots = Omit<z.infer<typeof searchEventsParameters>, 'request'>;
export type SlotValidationReason =
  | 'invalid_date'
  | 'past_date'
  | 'date_out_of_range'
  | 'invalid_date_range'
  | 'invalid_time_range'
  | 'unknown_place'
  | 'unknown_category'
  | 'budget_basis_required'
  | 'party_size_required'
  | 'invalid_budget'
  | 'structured_search_unavailable'
  | 'invalid_plan';

export type SlotPlanResult =
  | { status: 'accepted'; plan: Plan }
  | { status: 'needs_input'; reason: SlotValidationReason };

const atom = (value: Atom): Condition => ({ type: 'atom', atom: value });
const any = (children: Condition[]): Condition =>
  children.length === 1 ? children[0] : { type: 'any', children };
const not = (child: Condition): Condition => ({ type: 'not', child });
const canonicalDistricts = new Map(DISTRICTS.map((name) => [fold(name), name]));
const canonicalNeighborhoods = new Map(NEIGHBORHOODS.map((name) => [fold(name), name]));

function istanbulDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDays(day: string, days: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function locationAtom(name: string): Extract<Atom, { kind: 'location' }> | null {
  const folded = fold(name).trim();
  if (folded === 'anadolu') return { kind: 'location', name: 'Anadolu yakası', precision: 'side' };
  if (folded === 'avrupa') return { kind: 'location', name: 'Avrupa yakası', precision: 'side' };
  const district = canonicalDistricts.get(folded);
  if (district) return { kind: 'location', name: district, precision: 'district' };
  const neighborhood = canonicalNeighborhoods.get(folded);
  const place = neighborhood ? placeOf(fold(neighborhood).trim()) : null;
  if (place?.district) {
    const parent = canonicalDistricts.get(place.district);
    return parent ? { kind: 'location', name: parent, precision: 'district' } : null;
  }
  if (place?.side)
    return {
      kind: 'location',
      name: place.side === 'asia' ? 'Anadolu yakası' : 'Avrupa yakası',
      precision: 'side',
    };
  return null;
}

function locationConditions(values: readonly string[]) {
  const locations = values.map(locationAtom);
  if (locations.some((value) => value === null)) return null;
  const unique = [...new Map(locations.map((value) => [JSON.stringify(value), value!])).values()];
  return unique.map(atom);
}

function categoryConditions(values: readonly string[]) {
  if (values.some((value) => !categoryValues.includes(value as Category))) return null;
  return [...new Set(values)].map((value) => atom({ kind: 'category', value: value as Category }));
}

/** Converts Gemini slots to the same validated Plan used by the parser path. */
export function slotsToPlan(slots: SearchEventSlots, now = new Date()): SlotPlanResult {
  const hard: Condition[] = [];
  if ((slots.timeFromExclusive && !slots.timeFrom) || (slots.timeToExclusive && !slots.timeTo))
    return { status: 'needs_input', reason: 'invalid_time_range' };
  if (slots.maxPrice === undefined && (slots.maxPriceExclusive || slots.budgetBasis))
    return { status: 'needs_input', reason: 'invalid_budget' };
  const from = slots.dateFrom ?? slots.dateTo;
  const to = slots.dateTo ?? slots.dateFrom;
  if (from && to) {
    if (!validCalendarDate(from) || !validCalendarDate(to))
      return { status: 'needs_input', reason: 'invalid_date' };
    const today = istanbulDate(now);
    if (from < today || to < today) return { status: 'needs_input', reason: 'past_date' };
    if (from > addDays(today, 119) || to > addDays(today, 119))
      return { status: 'needs_input', reason: 'date_out_of_range' };
    if (from > to) return { status: 'needs_input', reason: 'invalid_date_range' };
    hard.push(atom({ kind: 'date', from, to }));
  }
  if (slots.timeFrom && slots.timeTo && slots.timeFrom > slots.timeTo)
    return { status: 'needs_input', reason: 'invalid_time_range' };
  if (slots.timeFrom || slots.timeTo)
    hard.push(atom({
      kind: 'time',
      ...(slots.timeFrom ? { from: slots.timeFrom, fromExclusive: slots.timeFromExclusive ?? false } : {}),
      ...(slots.timeTo ? { to: slots.timeTo, toExclusive: slots.timeToExclusive ?? false } : {}),
    }));

  if (slots.places) {
    const conditions = locationConditions(slots.places);
    if (!conditions) return { status: 'needs_input', reason: 'unknown_place' };
    hard.push(any(conditions));
  }
  if (slots.excludePlaces) {
    const conditions = locationConditions(slots.excludePlaces);
    if (!conditions) return { status: 'needs_input', reason: 'unknown_place' };
    hard.push(...conditions.map(not));
  }
  if (slots.categories) {
    const conditions = categoryConditions(slots.categories);
    if (!conditions) return { status: 'needs_input', reason: 'unknown_category' };
    hard.push(any(conditions));
  }
  if (slots.excludeCategories) {
    const conditions = categoryConditions(slots.excludeCategories);
    if (!conditions) return { status: 'needs_input', reason: 'unknown_category' };
    hard.push(...conditions.map(not));
  }
  if (slots.topics) hard.push(any([...new Set(slots.topics)].map((value) => atom({ kind: 'topic', value }))));
  if (slots.excludeTopics) hard.push(...[...new Set(slots.excludeTopics)].map((value) => not(atom({ kind: 'topic', value }))));
  if (slots.maxPrice !== undefined) {
    if (!slots.budgetBasis) return { status: 'needs_input', reason: 'budget_basis_required' };
    if (slots.budgetBasis === 'group_total' && !slots.partySize)
      return { status: 'needs_input', reason: 'party_size_required' };
    if (slots.partySize) hard.push(atom({ kind: 'party', count: slots.partySize }));
    hard.push(atom({
      kind: 'budget',
      comparison: slots.maxPriceExclusive ? 'lt' : 'lte',
      amount: slots.maxPrice,
      currency: 'TRY',
      basis: slots.budgetBasis as BudgetBasis,
    }));
  } else if (slots.partySize) hard.push(atom({ kind: 'party', count: slots.partySize }));
  if (slots.audience === 'children') hard.push(atom({ kind: 'companion', value: 'children' }));
  if (slots.audience === 'family') hard.push(atom({ kind: 'companion', value: 'family' }));
  if (slots.audience === 'adults') hard.push(atom({ kind: 'age', years: 18 }));
  for (const years of slots.attendeeAges ?? []) hard.push(atom({ kind: 'age', years }));

  const plan: Plan = {
    hard: { type: 'all', children: hard },
    preferences: [],
    order: (slots.order ?? 'none') as Order,
  };
  try {
    validateSearchPlan(plan);
    return { status: 'accepted', plan };
  } catch {
    return { status: 'needs_input', reason: 'invalid_plan' };
  }
}

function hasStructuredSlots(slots: SearchEventSlots) {
  return Object.values(slots).some((value) => value !== undefined);
}

/** The request is for children or minors (Turkish or English). */
export function childAudienceRequested(request: string) {
  return /\b(?:cocuk\w*|minik\w*|kids?|child(?:ren)?|toddlers?|minors?|teens?|teenagers?|ergen\w*|aile(?:ce|mle|yle)?|family|18 yas alti\w*|under 18)\b|\b\d{1,2}\s*(?:yas\w*|years? old|yo)\b/.test(
    normalize(request),
  );
}

/** Code guard: a request for children never returns sessions that the source limits to older people. */
const CHILD_AGE = 10;

export function searchEventsResult(result: SearchResult, request = '', structuredChildAudience = false) {
  const forChildren = structuredChildAudience || childAudienceRequested(request);
  const events: EventRecord[] = result.recommendations
    .map((recommendation) => recommendation.event)
    .filter((event) => !forChildren || checkAgeEvidence(event, CHILD_AGE).status !== 'contradicted')
    .slice(0, MAX_SEARCH_RESULTS);
  return {
    events,
    response: {
      status: result.status,
      reason:
        result.pendingInput?.reason ??
        (result.status === 'unsupported_location' ? 'unsupported_location' : null),
      totalCandidates: result.totalCandidates,
      ...(forChildren ? { ageGuard: 'removed sessions with an age limit above children' } : {}),
      events: events.map(eventFacts),
    },
  };
}

export function createSearchEventsTool(deps: SearchEventsDeps) {
  return new FunctionTool({
    name: 'search_events',
    description:
      'Search the checked Istanbul event catalog (Biletinial, Bubilet, Biletix). ' +
      'Code checks hard conditions (date, place, budget, category, exclusions, age) ' +
      'and removes duplicate sessions. Returns at most 10 events. Status ' +
      '"needs_input" means one condition is unclear: ask the user about it.',
    parameters: searchEventsParameters,
    execute: async ({ request, ...slots }) => {
      let result: SearchResult;
      if (hasStructuredSlots(slots)) {
        const converted = slotsToPlan(slots, deps.now?.() ?? new Date());
        if (converted.status === 'needs_input')
          return { status: 'needs_input', reason: converted.reason, totalCandidates: 0, events: [] };
        if (!deps.searchPlan)
          return { status: 'needs_input', reason: 'structured_search_unavailable', totalCandidates: 0, events: [] };
        result = await deps.searchPlan(request, converted.plan);
      } else {
        result = await deps.search(request);
      }
      const structuredChildAudience =
        slots.audience === 'children' ||
        slots.audience === 'family' ||
        slots.attendeeAges?.some((age) => age < 18) === true;
      const { events, response } = searchEventsResult(result, request, structuredChildAudience);
      deps.showCards(events.map(eventCard));
      return response;
    },
  });
}
