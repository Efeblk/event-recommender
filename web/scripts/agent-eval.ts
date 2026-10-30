/**
 * Agent evaluation runner.
 *
 *   npm run eval:agent                       replay recorded steps (offline, no cost)
 *   npm run eval:agent -- --record --max-model-calls 250 --out work/agent-eval/live.json
 *                                            record a live Gemini run (paid above the free tier)
 *
 * Record mode needs Gemini settings (see README) and an explicit call budget.
 * It never retries a failed call. It stops before a case when the budget is spent.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { agentModelConfigFrom } from '../agent/config.ts';
import { geminiModel } from '../agent/agent.ts';
import { MAX_LLM_CALLS_PER_TURN } from '../agent/turn.ts';
import {
  meetsAcceptance,
  runAgentCase,
  runAgentEval,
  agentEvalWorld,
  validateAgentFixture,
  type AgentEvalFixture,
  type CaseResult,
} from '../evals/agent-v1.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    fixture: { type: 'string', default: 'fixtures/agent-v1.json' },
    record: { type: 'boolean', default: false },
    'max-model-calls': { type: 'string' },
    out: { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
});

function workPath(path: string) {
  const full = resolve(root, path);
  const child = relative(resolve(root, 'work'), full);
  if (!child || child.startsWith('..')) throw new Error('Recorded output must stay under web/work.');
  return full;
}

function printCase(result: CaseResult) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id}`);
  if (result.passed && !values.verbose) return;
  result.turns.forEach((turn, index) => {
    const problems = [...turn.failures, ...turn.violations, ...turn.duplicates, ...turn.invented.map((t) => `invented ${t}`)];
    if (!problems.length && !values.verbose) return;
    console.log(`  turn ${index + 1}: tools=${turn.tools.join(',') || '-'} cards=${turn.cards.length}`);
    for (const search of turn.searches) console.log(`    search: ${search}`);
    for (const problem of problems) console.log(`    ! ${problem}`);
  });
}

const fixture = validateAgentFixture(JSON.parse(await readFile(resolve(root, values.fixture), 'utf8')));

if (!values.record) {
  const report = await runAgentEval(fixture, { onCase: printCase });
  const { results: _results, ...summary } = report;
  console.log(JSON.stringify({ recording: fixture.recording, ...summary }, null, 2));
  process.exitCode = meetsAcceptance(report) ? 0 : 1;
} else {
  const budget = Number(values['max-model-calls']);
  if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('Record mode needs --max-model-calls N.');
  if (!values.out) throw new Error('Record mode needs --out work/<file>.json.');
  const out = workPath(values.out);
  const config = agentModelConfigFrom(process.env);
  if (!config) throw new Error('Record mode needs Gemini settings (GEMINI_API_KEY or Vertex AI).');
  const inner = geminiModel(config);
  const world = agentEvalWorld(new Date(fixture.referenceTime));
  const recorded: AgentEvalFixture = {
    ...fixture,
    recording: { source: 'live', model: config.model, recordedAt: new Date().toISOString() },
    cases: [],
  };
  const results: CaseResult[] = [];
  let calls = 0;
  for (const testCase of fixture.cases) {
    const worstCase = testCase.turns.length * MAX_LLM_CALLS_PER_TURN;
    if (calls + worstCase > budget) {
      console.log(`Budget stop before ${testCase.id}: ${calls} of ${budget} model calls used.`);
      break;
    }
    const { modelCalls, ...result } = await runAgentCase(testCase, { inner, world });
    calls += modelCalls;
    results.push(result);
    printCase(result);
    recorded.cases.push({
      ...testCase,
      turns: testCase.turns.map((turn, index) => ({ ...turn, model: result.turns[index]?.steps ?? [] })),
    });
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(recorded, null, 2)}\n`);
  const passed = results.filter((result) => result.passed).length;
  console.log(
    JSON.stringify({ model: config.model, modelCalls: calls, cases: results.length, passed, out: relative(root, out) }, null, 2),
  );
}
