import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { BaseLlm, type LlmRequest, type LlmResponse } from '@google/adk';
import { verifyFirebaseIdToken, bearerToken, firebaseWebConfigFrom } from '../lib/auth.ts';
import {
  createUserStore,
  memoryDocuments,
  MAX_PLANS_PER_USER,
  UserStoreLimitError,
  type SavedPlan,
} from '../lib/user-store.ts';
import { DocumentSessionService, trimSessionEvents } from '../agent/sessions.ts';
import { buildTimeline, venueAddress, estimatedMinutes } from '../agent/planner.ts';
import { createRouteLookup, routesConfigFrom, ROUTES_URL } from '../lib/routes.ts';
import { createWeatherLookup, summarizeDay, weatherKind } from '../lib/weather.ts';
import { createPlanningTools, MAX_ROUTE_CALLS_PER_TURN, LegCache } from '../agent/tools/planning.ts';
import { createSavedTools } from '../agent/tools/saved.ts';
import { createWeatherTool } from '../agent/tools/weather.ts';
import { findEvents } from '../agent/tools/event-details.ts';
import { agentTurnStream } from '../agent/stream.ts';
import { planToIcs, icsFileName } from '../lib/ics.ts';
import { userLimitBuckets } from '../lib/rate-limit.ts';
import type { AgentStreamEvent } from '../agent/turn.ts';
import type { EventRecord } from '../lib/types.ts';

const base: EventRecord = {
  id: 'concert',
  title: 'Caz Gecesi',
  description: 'Canlı caz.',
  startsAt: '2026-11-07T16:00:00.000Z', // 19:00 Istanbul
  checkedAt: '2026-11-01T00:00:00.000Z',
  venue: 'Sahne',
  city: 'İstanbul',
  district: 'Kadıköy',
  address: 'Moda Cd. 1, Kadıköy',
  price: 400,
  currency: 'TRY',
  category: 'Konser',
  availability: 'available',
  imageUrl: '',
  url: 'https://tickets.example/concert',
};
const late: EventRecord = {
  ...base,
  id: 'standup',
  title: 'Gece Stand-up',
  category: 'Stand-up',
  startsAt: '2026-11-07T19:30:00.000Z', // 22:30
  venue: 'Kulüp',
  district: 'Beşiktaş',
  address: 'Beşiktaş',
  url: 'https://tickets.example/standup',
};
const clash: EventRecord = { ...late, id: 'clash', title: 'Çakışan Oyun', category: 'Tiyatro', startsAt: '2026-11-07T17:00:00.000Z' };
const museum: EventRecord = {
  ...base,
  id: 'museum',
  title: 'Müze',
  category: 'Müze',
  startsAt: '2026-11-07T07:00:00.000Z',
  attendanceTiming: {
    kind: 'admission_window',
    evidence: 'provider_flexible_window',
    validFrom: '2026-11-01T00:00:00.000Z',
    validThrough: '2026-12-01T00:00:00.000Z',
  },
};
const catalog = [base, late, clash, museum];
const lookup = async (ids: string[]) => findEvents(catalog, ids);

// --- Firebase ID tokens ---------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const nowS = 1_800_000_000;
function token(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode(header)}.${encode(payload)}`;
  const signature = createSign('RSA-SHA256').update(body).sign(privateKey).toString('base64url');
  return `${body}.${signature}`;
}
const claims = {
  iss: 'https://securetoken.google.com/biplan-test',
  aud: 'biplan-test',
  sub: 'user_1',
  iat: nowS - 10,
  exp: nowS + 3000,
  email: 'a@example.com',
  firebase: { sign_in_provider: 'google.com' },
};
const keys = async (kid: string) => (kid === 'k1' ? publicKey : null);

await test('Firebase ID tokens verify signature, issuer, audience and time', async () => {
  const user = await verifyFirebaseIdToken(token(claims), 'biplan-test', keys, nowS * 1000);
  assert.deepEqual(user, { uid: 'user_1', anonymous: false, email: 'a@example.com', name: null });
  const anonymous = await verifyFirebaseIdToken(
    token({ ...claims, firebase: { sign_in_provider: 'anonymous' } }),
    'biplan-test',
    keys,
    nowS * 1000,
  );
  assert.equal(anonymous?.anonymous, true);
  for (const bad of [
    token({ ...claims, aud: 'other' }),
    token({ ...claims, iss: 'https://securetoken.google.com/other' }),
    token({ ...claims, exp: nowS - 120 }),
    token({ ...claims, iat: nowS + 600 }),
    token({ ...claims, sub: 'a/b' }),
    token(claims, { alg: 'HS256', kid: 'k1' }),
    token(claims, { alg: 'RS256', kid: 'unknown' }),
    token(claims).slice(0, -4) + 'AAAA',
    'not.a.jwt',
    '',
  ])
    assert.equal(await verifyFirebaseIdToken(bad, 'biplan-test', keys, nowS * 1000), null);
});

await test('bearer tokens and public Firebase settings are read strictly', () => {
  const request = (value: string) => new Request('http://x', { headers: { authorization: value } });
  assert.equal(bearerToken(request('Bearer abc.def-ghi_j')), 'abc.def-ghi_j');
  assert.equal(bearerToken(request('Basic abc')), null);
  assert.equal(bearerToken(request('Bearer a b')), null);
  assert.equal(firebaseWebConfigFrom({}), null);
  assert.deepEqual(firebaseWebConfigFrom({ FIREBASE_WEB_API_KEY: 'k', FIREBASE_PROJECT_ID: 'biplan-test' }), {
    apiKey: 'k',
    projectId: 'biplan-test',
    authDomain: 'biplan-test.firebaseapp.com',
  });
});

// --- Saved data -------------------------------------------------------------
const plan = (id: string, updatedAt = '2026-11-01T00:00:00.000Z'): SavedPlan => ({
  id,
  title: 'Cumartesi',
  note: '',
  items: [],
  legs: [],
  createdAt: updatedAt,
  updatedAt,
});

await test('user store keeps each user separate and enforces limits', async () => {
  const store = createUserStore(memoryDocuments(), 'test');
  await store.savePlan('alice', plan('p1', '2026-11-01T00:00:00.000Z'));
  await store.savePlan('alice', plan('p2', '2026-11-02T00:00:00.000Z'));
  assert.deepEqual((await store.listPlans('alice')).map((p) => p.id), ['p2', 'p1']);
  assert.deepEqual(await store.listPlans('bob'), []);
  assert.equal(await store.getPlan('bob', 'p1'), null);
  assert.equal(await store.deletePlan('bob', 'p1'), false);
  assert.equal(await store.deletePlan('alice', 'p1'), true);
  await assert.rejects(store.listPlans('../alice'));
  await assert.rejects(store.getPlan('alice', '../../x'));
  for (let i = 0; i < MAX_PLANS_PER_USER - 1; i++) await store.savePlan('carol', plan(`p${i}`));
  await store.savePlan('carol', plan('last'));
  await assert.rejects(store.savePlan('carol', plan('over')), UserStoreLimitError);
  // Updating an existing plan at the limit is allowed.
  await store.savePlan('carol', plan('last'));
});

await test('agent sessions persist in documents and stay with their owner', async () => {
  const documents = memoryDocuments();
  const service = new DocumentSessionService(documents, 'test', () => 1000);
  const session = await service.createSession({ appName: 'biplan', userId: 'alice', sessionId: 'session-1' });
  await service.appendEvent({
    session,
    event: { id: 'e1', invocationId: 'i', author: 'user', actions: {} as never, timestamp: 1, content: { role: 'user', parts: [{ text: 'merhaba' }] } },
  });
  const restored = await new DocumentSessionService(documents, 'test').getSession({
    appName: 'biplan',
    userId: 'alice',
    sessionId: 'session-1',
  });
  assert.equal(restored?.events.length, 1);
  assert.equal(await service.getSession({ appName: 'biplan', userId: 'bob', sessionId: 'session-1' }), undefined);
  await service.deleteSession({ appName: 'biplan', userId: 'alice', sessionId: 'session-1' });
  assert.equal(await service.getSession({ appName: 'biplan', userId: 'alice', sessionId: 'session-1' }), undefined);
});

await test('session trimming keeps whole turns', () => {
  const events = Array.from({ length: 10 }, (_, i) => ({
    id: `e${i}`,
    author: i % 3 === 0 ? 'user' : 'agent',
    timestamp: i,
  })) as never[];
  const kept = trimSessionEvents(events, 5);
  assert.equal((kept[0] as { author: string }).author, 'user');
  assert.ok(kept.length <= 5);
  assert.equal(trimSessionEvents(events, 100).length, 10);
});

// --- Planner ----------------------------------------------------------------
await test('the timeline orders events and finds overlaps, travel and day conflicts', () => {
  const ok = buildTimeline([late, base]);
  assert.deepEqual(ok.items.map((item) => item.eventId), ['concert', 'standup']);
  assert.deepEqual(ok.conflicts, []);
  assert.equal(ok.items[0].estimatedEndsAt, '2026-11-07T18:30:00.000Z');
  assert.equal(buildTimeline([base, clash]).conflicts[0].kind, 'overlap');
  const tight = buildTimeline([base, late], [
    { fromEventId: 'concert', toEventId: 'standup', mode: 'transit', minutes: 50, distanceKm: 9 },
  ]);
  assert.equal(tight.conflicts[0].kind, 'travel');
  const nextDay = { ...late, id: 'sunday', startsAt: '2026-11-08T16:00:00.000Z' };
  assert.equal(buildTimeline([base, nextDay]).conflicts[0].kind, 'different_days');
  assert.deepEqual(buildTimeline([museum, base]).conflicts, []);
  assert.equal(buildTimeline([museum]).items[0].flexible, true);
  assert.equal(estimatedMinutes({ category: 'Bilinmeyen' }), 120);
  assert.equal(venueAddress(base), 'Sahne, Moda Cd. 1, Kadıköy, İstanbul');
});

// --- Routes -----------------------------------------------------------------
await test('the routes client sends the key in a header and caches results', async () => {
  assert.equal(routesConfigFrom({}), null);
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ routes: [{ duration: '1530s', distanceMeters: 8400 }] });
  }) as unknown as typeof fetch;
  const route = createRouteLookup({ apiKey: 'secret-key' }, fetcher);
  assert.deepEqual(await route('A', 'B', 'transit'), { minutes: 26, distanceKm: 8.4 });
  assert.deepEqual(await route('A', 'B', 'transit'), { minutes: 26, distanceKm: 8.4 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ROUTES_URL);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['X-Goog-Api-Key'], 'secret-key');
  assert.match(headers['X-Goog-FieldMask'], /routes.duration/);
  assert.equal(JSON.parse(calls[0].init.body as string).travelMode, 'TRANSIT');
  const empty = createRouteLookup({ apiKey: 'k' }, (async () => Response.json({})) as unknown as typeof fetch);
  assert.equal(await empty('A', 'B', 'walk'), null);
  const failing = createRouteLookup({ apiKey: 'k' }, (async () => new Response('', { status: 403 })) as unknown as typeof fetch);
  await assert.rejects(failing('A', 'B', 'drive'));
});

// --- Weather ----------------------------------------------------------------
const hourly = (rain: number, code: number) => ({
  hourly: {
    time: Array.from({ length: 24 }, (_, h) => `2026-11-07T${String(h).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 24 }, (_, h) => 8 + h / 4),
    precipitation_probability: Array.from({ length: 24 }, (_, h) => (h >= 12 ? rain : 100)),
    weather_code: Array.from({ length: 24 }, () => code),
  },
});

await test('weather summaries cover the afternoon and evening', async () => {
  const day = summarizeDay(hourly(70, 61), '2026-11-07', 'kadıköy');
  assert.equal(day?.maxPrecipitationProbability, 70);
  assert.deepEqual(day?.conditions, ['rain']);
  assert.equal(day?.outdoorAdvice, 'poor');
  assert.equal(summarizeDay(hourly(10, 1), '2026-11-07', 'kadıköy')?.outdoorAdvice, 'good');
  assert.equal(summarizeDay(hourly(35, 1), '2026-11-07', 'kadıköy')?.outdoorAdvice, 'risky');
  assert.equal(summarizeDay(hourly(10, 1), '2026-11-08', 'kadıköy'), null);
  assert.equal(weatherKind(95), 'thunderstorm');
  assert.equal(weatherKind(0), 'clear');
  const urls: string[] = [];
  const weather = createWeatherLookup((async (url: URL) => {
    urls.push(String(url));
    return Response.json(hourly(0, 0));
  }) as unknown as typeof fetch);
  await weather('2026-11-07', 'Kadıköy');
  await weather('2026-11-07', 'kadıköy');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /latitude=40\.99/);
  const tool = createWeatherTool({ weather, now: () => new Date('2026-11-01T10:00:00Z') });
  assert.equal((await tool.runAsync({ args: { date: '2026-12-30' }, toolContext: undefined as never }) as { status: string }).status, 'out_of_range');
  assert.equal((await tool.runAsync({ args: { date: '2026-11-07', district: 'Kadıköy' }, toolContext: undefined as never }) as { status: string }).status, 'ok');
});

// --- Planning and saving tools ---------------------------------------------
const run = (tool: { runAsync(request: never): Promise<unknown> }, args: Record<string, unknown>) =>
  tool.runAsync({ args, toolContext: undefined } as never) as Promise<Record<string, unknown>>;

await test('plan_outing checks the order and limits paid route calls', async () => {
  let routeCalls = 0;
  const shown: string[] = [];
  const { tools, cache } = createPlanningTools({
    lookup,
    route: async () => {
      routeCalls++;
      return { minutes: 25, distanceKm: 7 };
    },
    showCards: (cards) => shown.push(...cards.map((card) => card.id)),
  });
  const [planRoute, planOuting] = tools;
  const outing = await run(planOuting, { eventIds: ['standup', 'concert'] });
  assert.equal(outing.status, 'ok');
  assert.deepEqual((outing.items as { eventId: string }[]).map((item) => item.eventId), ['concert', 'standup']);
  assert.deepEqual(outing.conflicts, []);
  assert.deepEqual(shown, ['concert', 'standup']);
  assert.equal(routeCalls, 1);
  assert.equal(cache.all()[0].minutes, 25);
  // A repeated leg uses the cache.
  await run(planRoute, { fromEventId: 'concert', toEventId: 'standup' });
  assert.equal(routeCalls, 1);
  for (let i = 0; i < MAX_ROUTE_CALLS_PER_TURN + 2; i++)
    await run(planRoute, { fromEventId: 'concert', toEventId: 'standup', mode: i % 2 ? 'walk' : 'drive' });
  assert.ok(routeCalls <= MAX_ROUTE_CALLS_PER_TURN);
  assert.equal((await run(planRoute, { fromEventId: 'x', toEventId: 'concert' })).status, 'unknown_event');
  const noMaps = createPlanningTools({ lookup, route: null, showCards: () => undefined });
  assert.equal((await run(noMaps.tools[0], { fromEventId: 'concert', toEventId: 'standup' })).status, 'unavailable');
});

await test('save tools need sign-in, refuse conflicts and save snapshots', async () => {
  const documents = memoryDocuments();
  const store = createUserStore(documents, 'test');
  const legs = new LegCache();
  const visitor = createSavedTools({ userId: null, store: async () => store, lookup, legs });
  assert.equal((await run(visitor[0], { title: 'x', eventIds: ['concert'] })).status, 'sign_in_required');
  const [savePlan, listPlans, saveFavorite] = createSavedTools({
    userId: 'alice',
    store: async () => store,
    lookup,
    legs,
    now: () => new Date('2026-11-01T10:00:00Z'),
    newId: () => 'plan1',
  });
  assert.equal((await run(savePlan, { title: 'Çakışma', eventIds: ['concert', 'clash'] })).status, 'conflict');
  assert.equal((await run(savePlan, { title: 'x', eventIds: ['nope'] })).status, 'unknown_event');
  legs.set({ fromEventId: 'concert', toEventId: 'standup', mode: 'transit', minutes: 25, distanceKm: 7 });
  const saved = await run(savePlan, { title: 'Cumartesi', eventIds: ['standup', 'concert'], note: 'Erken çık' });
  assert.equal(saved.status, 'saved');
  const stored = await store.getPlan('alice', 'plan1');
  assert.deepEqual(stored?.items.map((item) => item.eventId), ['concert', 'standup']);
  assert.deepEqual(stored?.legs, [{ fromEventId: 'concert', toEventId: 'standup', mode: 'transit', minutes: 25 }]);
  assert.equal(((await run(listPlans, {})).plans as unknown[]).length, 1);
  assert.equal((await run(saveFavorite, { eventId: 'concert' })).status, 'saved');
  assert.equal((await store.listFavorites('alice'))[0].url, base.url);
  assert.deepEqual(await store.listFavorites('bob'), []);
});

await test('calendar export escapes text, folds lines and uses CRLF', () => {
  const ics = planToIcs(
    {
      ...plan('p1'),
      title: 'Cumartesi; caz, stand-up',
      note: 'Not\nikinci satır',
      items: [
        {
          eventId: 'concert',
          title: 'Caz Gecesi'.repeat(10),
          startsAt: base.startsAt,
          venue: 'Sahne',
          district: 'Kadıköy',
          address: '',
          url: base.url,
        },
      ],
    },
    new Date('2026-11-01T00:00:00Z'),
  );
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /X-WR-CALNAME:Cumartesi\\; caz\\, stand-up/);
  assert.match(ics, /DTSTART:20261107T160000Z/);
  assert.match(ics, /DTEND:20261107T180000Z/);
  assert.match(ics, /Not\\nikinci satır/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(icsFileName({ title: 'Kadıköy Şarkı Gecesi!' }), 'kadikoy-sarki-gecesi.ics');
});

await test('signed-in users have their own rate-limit buckets', () => {
  const buckets = userLimitBuckets('alice', 120_000);
  assert.deepEqual(buckets.map((bucket) => bucket.key), ['user-minute:alice:2', 'user-hour:alice:0']);
});

// --- Agent turns with planning and saved sessions --------------------------
class ScriptedLlm extends BaseLlm {
  requests: LlmRequest[] = [];
  readonly script: (() => LlmResponse)[];
  constructor(script: (() => LlmResponse)[]) {
    super({ model: 'scripted' });
    this.script = script;
  }
  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.requests.push(request);
    const next = this.script[this.requests.length - 1];
    if (!next) throw new Error('Script ended.');
    yield next();
  }
  async connect(): Promise<never> {
    throw new Error('Live mode is not supported.');
  }
}
const call = (name: string, args: Record<string, unknown>) => () => ({
  content: { role: 'model', parts: [{ functionCall: { name, args } }] },
});
const say = (text: string) => () => ({ content: { role: 'model', parts: [{ text }] } });
const collect = async (stream: ReadableStream<Uint8Array>) =>
  (await new Response(stream).text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as AgentStreamEvent);

await test('a signed-in user plans and saves over two turns with a stored session', async () => {
  const documents = memoryDocuments();
  const sessions = new DocumentSessionService(documents, 'test');
  const store = createUserStore(documents, 'test');
  const tools = {
    search: async () => {
      throw new Error('not used');
    },
    lookup,
    route: async () => ({ minutes: 30, distanceKm: 8 }),
    weather: async () => null,
    userStore: async () => store,
  };
  const first = await collect(
    agentTurnStream({
      input: { sessionId: 'session-plan', message: 'Caz ve stand-up ile bir akşam planla' },
      userId: 'alice',
      model: new ScriptedLlm([call('plan_outing', { eventIds: ['concert', 'standup'] }), say('Plan uygun.')]),
      sessionService: sessions,
      tools,
    }),
  );
  assert.deepEqual(first.map((e) => e.type), ['tool', 'cards', 'text', 'done']);
  const second = new ScriptedLlm([call('save_plan', { title: 'Cumartesi', eventIds: ['concert', 'standup'] }), say('Kaydettim.')]);
  const events = await collect(
    agentTurnStream({
      input: { sessionId: 'session-plan', message: 'kaydet' },
      userId: 'alice',
      model: second,
      sessionService: sessions,
      tools,
    }),
  );
  assert.equal(events.at(-2)?.type, 'text');
  // The second turn saw the first turn from the stored session.
  assert.match(JSON.stringify(second.requests[0].contents), /Caz ve stand-up/);
  const [saved] = await store.listPlans('alice');
  assert.deepEqual(saved.items.map((item) => item.eventId), ['concert', 'standup']);
  // Another user cannot continue Alice's session.
  const intruder = new ScriptedLlm([say('Merhaba.')]);
  await collect(
    agentTurnStream({
      input: { sessionId: 'session-plan', message: 'devam' },
      userId: 'mallory',
      model: intruder,
      sessionService: sessions,
      tools,
    }),
  );
  assert.doesNotMatch(JSON.stringify(intruder.requests[0].contents), /Caz ve stand-up/);
});
