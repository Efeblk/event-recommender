import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  constraintViolations,
  duplicateCards,
  meetsAcceptance,
  runAgentCase,
  runAgentEval,
  validateAgentFixture,
  type AgentEvalCase,
} from '../evals/agent-v1.ts';
import { agentEvalCatalog, AGENT_EVAL_REFERENCE_TIME } from '../evals/agent-catalog-v1.ts';
import { eventCard } from '../agent/cards.ts';
import { childAudienceRequested } from '../agent/tools/search-events.ts';
import { favoriteKey, validEventId } from '../lib/user-store.ts';

const fixture = validateAgentFixture(
  JSON.parse(await readFile(new URL('../fixtures/agent-v1.json', import.meta.url), 'utf8')),
);
const now = new Date(AGENT_EVAL_REFERENCE_TIME);
const catalog = agentEvalCatalog();
const byId = (id: string) => catalog.find((event) => event.id.endsWith(`:${id}`))!;

await test('the agent evaluation has at least 30 Turkish and English conversations', () => {
  assert.ok(fixture.cases.length >= 30);
  assert.ok(fixture.cases.some((c) => c.language === 'tr'));
  assert.ok(fixture.cases.some((c) => c.language === 'en'));
  assert.ok(fixture.cases.filter((c) => c.turns.length > 1).length >= 10);
});

await test('the recorded agent evaluation meets the Sprint 3 acceptance', async () => {
  const report = await runAgentEval(fixture);
  const failed = report.results
    .filter((result) => !result.passed)
    .map((result) => ({
      id: result.id,
      problems: result.turns.flatMap((turn) => [...turn.failures, ...turn.violations, ...turn.duplicates, ...turn.invented]),
    }));
  assert.equal(report.hardViolations, 0, JSON.stringify(failed));
  assert.equal(report.duplicateCards, 0);
  assert.equal(report.inventedEvents, 0, JSON.stringify(failed));
  assert.ok(meetsAcceptance(report), JSON.stringify(failed));
  assert.equal(report.passed, report.cases, JSON.stringify(failed));
});

await test('constraint checks catch wrong dates, districts, prices, categories and 18+ sessions', () => {
  const standup = byId('standup-kadikoy-cmt');
  const card = eventCard(standup);
  assert.deepEqual(constraintViolations(card, standup, { dates: ['2026-11-07'], districts: ['Kadıköy'] }, now), []);
  const problems = constraintViolations(
    card,
    standup,
    { dates: ['2026-11-08'], excludeDistricts: ['Kadıköy'], maxPrice: 300, categories: ['Tiyatro'], startsFrom: '23:00', noAdultOnly: true },
    now,
  );
  assert.equal(problems.length, 6, problems.join('; '));
  const soldOut = byId('tukendi-kadikoy-cmt');
  assert.match(constraintViolations(eventCard(soldOut), soldOut, {}, now).join(), /sold_out/);
  assert.match(constraintViolations(card, undefined, {}, now).join(), /not in the catalog/);
});

await test('duplicate checks find two cards for the same session', () => {
  const a = eventCard(byId('caz-moda-cmt'));
  const b = { ...eventCard(byId('caz-moda-cmt-bb')), id: 'other' };
  assert.equal(duplicateCards([a, b]).length, 1);
  assert.equal(duplicateCards([a, a]).length, 0);
});

await test('a replay fails when the model mentions an event that no tool showed', async () => {
  const invented: AgentEvalCase = {
    id: 'invented-event',
    language: 'en',
    goal: 'Guard check.',
    turns: [{ user: 'Jazz on Saturday?', model: [{ text: 'Try Hamlet in Kadıköy!' }], expect: {} }],
  };
  const result = await runAgentCase(invented);
  assert.equal(result.passed, false);
  assert.deepEqual(result.turns[0].invented, ['Hamlet']);
});

await test('a replay fails when recorded steps run out or are left over', async () => {
  const short: AgentEvalCase = {
    id: 'short-script',
    language: 'en',
    goal: 'Guard check.',
    turns: [{ user: 'Jazz?', model: [{ call: 'search_events', args: { request: 'Saturday jazz' } }], expect: {} }],
  };
  assert.equal((await runAgentCase(short)).passed, false);
  const long: AgentEvalCase = {
    ...short,
    id: 'long-script',
    turns: [{ user: 'Hi', model: [{ text: 'Hello.' }, { text: 'Extra.' }], expect: {} }],
  };
  assert.equal((await runAgentCase(long)).passed, false);
});

await test('child requests are detected in Turkish and English', () => {
  for (const request of ['Cumartesi çocuklar için', '7 yaşında kızım', 'events for kids', 'my 15 year old', 'ailece']) assert.ok(childAudienceRequested(request), request);
  for (const request of ['Cumartesi konser', 'stand-up in Kadıköy', 'saat 18:00']) assert.ok(!childAudienceRequested(request), request);
});

await test('favorite keys accept catalog event IDs and stay path-safe', () => {
  assert.ok(validEventId('biletinial:tiyatro-1'));
  assert.ok(validEventId('session-ea3ab41b'));
  assert.ok(!validEventId('../x/y'));
  assert.match(favoriteKey('biletinial:tiyatro-1'), /^[0-9a-f]{40}$/);
  assert.throws(() => favoriteKey('a/b'));
});
