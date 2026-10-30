/**
 * Agent evaluation (agent-v1). Each case is a multi-turn conversation with
 * recorded model steps and expectations written before the run.
 *
 * Replay mode feeds the recorded steps to the agent. The tools run for real
 * on a synthetic catalog with fake route and weather services, so a replay
 * makes no network calls. Record mode wraps a live model, stores its steps
 * and checks the same expectations.
 */
import { BaseLlm, type LlmRequest, type LlmResponse } from '@google/adk';
import { agentTurnStream } from '../agent/stream.ts';
import { BoundedSessionService } from '../agent/agent.ts';
import { findEvents } from '../agent/tools/event-details.ts';
import type { AgentStreamEvent } from '../agent/turn.ts';
import type { AgentEventCard } from '../agent/cards.ts';
import { buildSearchCatalog, searchCatalogCandidates } from '../lib/materialized-catalog.ts';
import { recommendRequest } from '../lib/recommend.ts';
import { createUserStore, memoryDocuments } from '../lib/user-store.ts';
import type { RouteLookup } from '../lib/routes.ts';
import type { DayForecast, WeatherLookup } from '../lib/weather.ts';
import { emptyFilters, type EventRecord } from '../lib/types.ts';
import { agentEvalCatalog, AGENT_EVAL_REFERENCE_TIME } from './agent-catalog-v1.ts';

// --- Fixture types -----------------------------------------------------------

export type ModelStep =
  | { call: string; args: Record<string, unknown> }
  | { calls: { name: string; args: Record<string, unknown> }[] }
  | { text: string };

/** Hard conditions. Every card in the turn must meet all of them. */
export interface CardConstraints {
  /** Istanbul dates, YYYY-MM-DD. */
  dates?: string[];
  districts?: string[];
  excludeDistricts?: string[];
  maxPrice?: number;
  categories?: string[];
  excludeCategories?: string[];
  /** Earliest Istanbul start time, HH:MM. */
  startsFrom?: string;
  /** No sessions with an 18+ age limit. */
  noAdultOnly?: boolean;
}

export interface TurnExpectation {
  /** Each tool must be called at least once in this turn. */
  tools?: string[];
  /** These tools must not be called in this turn. */
  forbidTools?: string[];
  /** Each text must appear in at least one search_events request (case-insensitive). */
  searchIncludes?: string[];
  constraints?: CardConstraints;
  cards?: { min?: number; max?: number; include?: string[]; exclude?: string[] };
  /** Expected values in the last response of a tool, by dotted path. */
  responses?: Record<string, Record<string, unknown>>;
  /** The answer text must not contain these strings (case-insensitive). */
  textExcludes?: string[];
}

export interface AgentEvalTurn {
  user: string;
  model: ModelStep[];
  expect: TurnExpectation;
}

export interface AgentEvalCase {
  id: string;
  language: 'tr' | 'en';
  /** What the case tests, in one line. */
  goal: string;
  signedIn?: boolean;
  turns: AgentEvalTurn[];
}

export interface AgentEvalFixture {
  schemaVersion: 1;
  referenceTime: string;
  /** "scripted": steps written by hand. "live": steps recorded from a model. */
  recording: { source: 'scripted' | 'live'; model: string | null; recordedAt: string | null };
  cases: AgentEvalCase[];
}

// --- Fake services -----------------------------------------------------------

const ASIAN_SIDE = new Set(['Kadıköy', 'Üsküdar', 'Maltepe', 'Ataşehir']);
const DISTRICTS = ['Kadıköy', 'Üsküdar', 'Maltepe', 'Ataşehir', 'Beşiktaş', 'Beyoğlu', 'Şişli', 'Sarıyer'];

/** Deterministic travel times: same district 12 min, same side 30, across the Bosphorus 55. */
export const fakeRoute: RouteLookup = async (origin, destination, mode) => {
  const district = (address: string) => DISTRICTS.find((name) => address.includes(name)) ?? '';
  const [a, b] = [district(origin), district(destination)];
  const base = a === b ? 12 : ASIAN_SIDE.has(a) === ASIAN_SIDE.has(b) ? 30 : 55;
  const minutes = mode === 'walk' ? base * 3 : mode === 'drive' ? Math.round(base * 0.8) : base;
  return { minutes, distanceKm: Math.round(base / 3) };
};

/** Rain on Saturday 2026-11-07, clear on Sunday, no forecast after 2026-11-19. */
export const fakeWeather: WeatherLookup = async (date, district = 'İstanbul') => {
  if (date > '2026-11-19') return null;
  const rainy = date === '2026-11-07';
  const day: DayForecast = {
    date,
    district,
    maxPrecipitationProbability: rainy ? 80 : 10,
    minTemperatureC: rainy ? 9 : 13,
    maxTemperatureC: rainy ? 12 : 18,
    conditions: rainy ? ['rain'] : ['clear'],
    outdoorAdvice: rainy ? 'poor' : 'good',
  };
  return day;
};

// --- Model -------------------------------------------------------------------

/**
 * Replays recorded steps, or records the steps of a live model. In both modes
 * it reads tool responses from the request so the run can check them.
 */
export class EvalLlm extends BaseLlm {
  readonly inner: BaseLlm | null;
  steps: ModelStep[] = [];
  recorded: ModelStep[] = [];
  responses: { name: string; response: Record<string, unknown> }[] = [];
  calls = 0;
  private seen = 0;

  constructor(inner: BaseLlm | null) {
    super({ model: inner?.model ?? 'replay' });
    this.inner = inner;
  }

  /** Starts a new turn with these recorded steps (ignored in record mode). */
  begin(steps: ModelStep[]) {
    this.steps = [...steps];
    this.recorded = [];
    this.responses = [];
  }

  private readResponses(request: LlmRequest) {
    const contents = request.contents ?? [];
    for (const content of contents.slice(this.seen))
      for (const part of content.parts ?? [])
        if (part.functionResponse?.name)
          this.responses.push({
            name: part.functionResponse.name,
            response: (part.functionResponse.response ?? {}) as Record<string, unknown>,
          });
    this.seen = contents.length;
  }

  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.readResponses(request);
    this.calls++;
    if (this.inner) {
      let last: LlmResponse | undefined;
      for await (const response of this.inner.generateContentAsync(request, false)) last = response;
      if (!last) throw new Error('The live model returned nothing.');
      const parts = last.content?.parts ?? [];
      const calls = parts.flatMap((part) =>
        part.functionCall?.name ? [{ name: part.functionCall.name, args: part.functionCall.args ?? {} }] : [],
      );
      const text = parts
        .filter((part) => typeof part.text === 'string' && !part.thought)
        .map((part) => part.text)
        .join('');
      if (calls.length === 1) this.recorded.push({ call: calls[0].name, args: calls[0].args });
      else if (calls.length > 1) this.recorded.push({ calls });
      else this.recorded.push({ text });
      yield last;
      return;
    }
    const step = this.steps.shift();
    if (!step) throw new Error('The recorded steps ended before the turn finished.');
    this.recorded.push(step);
    const parts =
      'text' in step
        ? [{ text: step.text }]
        : ('calls' in step ? step.calls : [{ name: step.call, args: step.args }]).map((call) => ({
            functionCall: call,
          }));
    yield { content: { role: 'model', parts } };
  }

  async connect(): Promise<never> {
    throw new Error('Live connections are not supported.');
  }
}

// --- Checks ------------------------------------------------------------------

const istanbulDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(iso));
const istanbulTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
const fold = (value: string) => value.toLocaleLowerCase('tr-TR');

/** Hard-constraint violations for one card, checked against the catalog record. */
export function constraintViolations(
  card: AgentEventCard,
  event: EventRecord | undefined,
  constraints: CardConstraints,
  now: Date,
): string[] {
  if (!event) return [`${card.id}: not in the catalog`];
  const out: string[] = [];
  const day = istanbulDay(event.startsAt);
  if (Date.parse(event.startsAt) < now.getTime()) out.push(`${card.id}: in the past`);
  if (event.availability !== 'available') out.push(`${card.id}: ${event.availability}`);
  if (constraints.dates && !constraints.dates.includes(day)) out.push(`${card.id}: date ${day}`);
  if (constraints.districts && !constraints.districts.includes(event.district))
    out.push(`${card.id}: district ${event.district}`);
  if (constraints.excludeDistricts?.includes(event.district)) out.push(`${card.id}: excluded district ${event.district}`);
  if (constraints.maxPrice !== undefined && (event.price === null || event.price > constraints.maxPrice))
    out.push(`${card.id}: price ${event.price}`);
  if (constraints.categories && !constraints.categories.includes(event.category))
    out.push(`${card.id}: category ${event.category}`);
  if (constraints.excludeCategories?.includes(event.category)) out.push(`${card.id}: excluded category ${event.category}`);
  if (constraints.startsFrom && istanbulTime(event.startsAt) < constraints.startsFrom)
    out.push(`${card.id}: starts ${istanbulTime(event.startsAt)}`);
  if (constraints.noAdultOnly && /18 yaş|\+18|18\+/i.test(event.description)) out.push(`${card.id}: 18+`);
  return out;
}

/** Distinct cards that show the same session (same title, start and venue). */
export function duplicateCards(cards: AgentEventCard[]): string[] {
  const byKey = new Map<string, string>();
  const out: string[] = [];
  for (const card of new Map(cards.map((c) => [c.id, c])).values()) {
    const key = `${fold(card.title)}|${card.startsAt}|${fold(card.venue)}`;
    const first = byKey.get(key);
    if (first) out.push(`${card.id} repeats ${first}`);
    else byKey.set(key, card.id);
  }
  return out;
}

const valueAt = (value: unknown, path: string) =>
  path.split('.').reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), value);

/** Matches a catalog record by its canonical ID, a merged source ID or a short fixture ID. */
const matchesId = (event: EventRecord, id: string) =>
  [event.id, ...(event.mergedIds ?? [])].some((known) => known === id || known.endsWith(`:${id}`));

// --- Runner ------------------------------------------------------------------

export interface TurnResult {
  user: string;
  tools: string[];
  searches: string[];
  cards: string[];
  text: string;
  failures: string[];
  violations: string[];
  duplicates: string[];
  invented: string[];
  steps: ModelStep[];
}

export interface CaseResult {
  id: string;
  passed: boolean;
  turns: TurnResult[];
}

export interface AgentEvalReport {
  cases: number;
  passed: number;
  passRate: number;
  hardViolations: number;
  duplicateCards: number;
  inventedEvents: number;
  modelCalls: number;
  results: CaseResult[];
}

export function agentEvalWorld(now = new Date(AGENT_EVAL_REFERENCE_TIME)) {
  const catalog = buildSearchCatalog(agentEvalCatalog(), now);
  const eligible = searchCatalogCandidates(catalog, emptyFilters, now);
  return {
    now,
    eligible,
    search: (request: string) =>
      recommendRequest(
        { message: request },
        { config: null, now, candidates: async (filters) => searchCatalogCandidates(catalog, filters, now) },
      ),
    lookup: async (ids: string[]) => findEvents(eligible, ids),
  };
}

export async function runAgentCase(
  testCase: AgentEvalCase,
  options: { inner?: BaseLlm | null; world?: ReturnType<typeof agentEvalWorld> } = {},
): Promise<CaseResult & { modelCalls: number }> {
  const world = options.world ?? agentEvalWorld();
  const model = new EvalLlm(options.inner ?? null);
  const sessionService = new BoundedSessionService(10);
  const userId = testCase.signedIn ? 'eval-user' : null;
  const store = createUserStore(memoryDocuments(), 'eval');
  const titles = new Map(agentEvalCatalog().map((event) => [fold(event.title), event.title]));
  const shown = new Set<string>();
  const turns: TurnResult[] = [];
  const sessionId = `eval-${testCase.id}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);

  for (const turn of testCase.turns) {
    model.begin(turn.model);
    const searches: string[] = [];
    const stream = agentTurnStream({
      input: { sessionId, message: turn.user },
      userId,
      model,
      sessionService,
      tools: {
        search: (request) => {
          searches.push(request);
          return world.search(request);
        },
        lookup: world.lookup,
        route: fakeRoute,
        weather: fakeWeather,
        userStore: async () => store,
        now: () => world.now,
      },
    });
    const events = (await new Response(stream).text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AgentStreamEvent);
    const tools = events.flatMap((event) => (event.type === 'tool' ? [event.name] : []));
    const cards = [
      ...new Map(events.flatMap((event) => (event.type === 'cards' ? event.cards : [])).map((card) => [card.id, card])).values(),
    ];
    for (const card of cards) shown.add(fold(card.title));
    const text = events.flatMap((event) => (event.type === 'text' ? [event.text] : [])).join('\n');
    const expect = turn.expect;
    const failures: string[] = [];
    for (const event of events) if (event.type === 'error') failures.push(`stream error ${event.code}`);
    if (model.steps.length && !model.inner) failures.push(`${model.steps.length} recorded steps not used`);
    for (const tool of expect.tools ?? []) if (!tools.includes(tool)) failures.push(`missing tool ${tool}`);
    for (const tool of expect.forbidTools ?? []) if (tools.includes(tool)) failures.push(`forbidden tool ${tool}`);
    for (const part of expect.searchIncludes ?? [])
      if (!searches.some((request) => fold(request).includes(fold(part)))) failures.push(`no search includes "${part}"`);
    const ids = cards.map((card) => card.id);
    const resolve = (card: AgentEventCard) => world.eligible.find((event) => event.id === card.id);
    const violations = expect.constraints
      ? cards.flatMap((card) => constraintViolations(card, resolve(card), expect.constraints!, world.now))
      : cards.flatMap((card) => constraintViolations(card, resolve(card), {}, world.now));
    const has = (id: string) => cards.some((card) => {
      const event = resolve(card);
      return event ? matchesId(event, id) : card.id === id;
    });
    if (expect.cards?.min !== undefined && ids.length < expect.cards.min) failures.push(`${ids.length} cards < ${expect.cards.min}`);
    if (expect.cards?.max !== undefined && ids.length > expect.cards.max) failures.push(`${ids.length} cards > ${expect.cards.max}`);
    for (const id of expect.cards?.include ?? []) if (!has(id)) failures.push(`missing card ${id}`);
    for (const id of expect.cards?.exclude ?? []) if (has(id)) failures.push(`unexpected card ${id}`);
    for (const [tool, fields] of Object.entries(expect.responses ?? {})) {
      const response = model.responses.filter((entry) => entry.name === tool).at(-1)?.response;
      if (!response) failures.push(`no ${tool} response`);
      else
        for (const [path, value] of Object.entries(fields))
          if (JSON.stringify(valueAt(response, path)) !== JSON.stringify(value))
            failures.push(`${tool}.${path} = ${JSON.stringify(valueAt(response, path))}, expected ${JSON.stringify(value)}`);
    }
    // A catalog title in the answer must come from a card shown in this conversation.
    const answer = fold(text);
    for (const part of expect.textExcludes ?? []) if (answer.includes(fold(part))) failures.push(`answer contains "${part}"`);
    const invented = [...titles.keys()].filter((title) => answer.includes(title) && !shown.has(title)).map((t) => titles.get(t)!);
    turns.push({
      user: turn.user,
      tools,
      searches,
      cards: ids,
      text,
      failures,
      violations,
      duplicates: duplicateCards(cards),
      invented,
      steps: model.recorded,
    });
  }
  const passed = turns.every(
    (turn) => !turn.failures.length && !turn.violations.length && !turn.duplicates.length && !turn.invented.length,
  );
  return { id: testCase.id, passed, turns, modelCalls: model.calls };
}

export async function runAgentEval(
  fixture: AgentEvalFixture,
  options: { inner?: BaseLlm | null; onCase?: (result: CaseResult) => void } = {},
): Promise<AgentEvalReport> {
  const world = agentEvalWorld(new Date(fixture.referenceTime));
  const results: CaseResult[] = [];
  let modelCalls = 0;
  for (const testCase of fixture.cases) {
    const { modelCalls: calls, ...result } = await runAgentCase(testCase, { inner: options.inner, world });
    modelCalls += calls;
    results.push(result);
    options.onCase?.(result);
  }
  const count = (key: 'violations' | 'duplicates' | 'invented') =>
    results.reduce((sum, result) => sum + result.turns.reduce((n, turn) => n + turn[key].length, 0), 0);
  const passed = results.filter((result) => result.passed).length;
  return {
    cases: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    hardViolations: count('violations'),
    duplicateCards: count('duplicates'),
    inventedEvents: count('invented'),
    modelCalls,
    results,
  };
}

/** Acceptance from the project plan, Sprint 3. */
export function meetsAcceptance(report: AgentEvalReport) {
  return report.hardViolations === 0 && report.duplicateCards === 0 && report.passRate >= 0.85;
}

export function validateAgentFixture(value: unknown): AgentEvalFixture {
  const fixture = value as AgentEvalFixture;
  if (fixture?.schemaVersion !== 1 || !Array.isArray(fixture.cases)) throw new Error('Unknown agent eval fixture.');
  const ids = new Set<string>();
  for (const testCase of fixture.cases) {
    if (!/^[a-z0-9-]{3,64}$/.test(testCase.id) || ids.has(testCase.id)) throw new Error(`Bad case ID ${testCase.id}`);
    ids.add(testCase.id);
    if (!['tr', 'en'].includes(testCase.language) || !testCase.turns?.length) throw new Error(`Bad case ${testCase.id}`);
    for (const turn of testCase.turns)
      if (typeof turn.user !== 'string' || !Array.isArray(turn.model) || !turn.expect)
        throw new Error(`Bad turn in ${testCase.id}`);
  }
  return fixture;
}
