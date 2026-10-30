import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const repo = new URL('../../', import.meta.url);
const read = (path: string) => readFile(new URL(path, repo), 'utf8');
const workflow = await read('.github/workflows/gcp-staging.yml');
const ci = await read('.github/workflows/web.yml');
const terraform = (
  await Promise.all(
    (await readdir(new URL('infra/gcp/', repo)))
      .filter((name) => name.endsWith('.tf'))
      .map((name) => read(`infra/gcp/${name}`)),
  )
).join('\n');

await test('staging deployment runs only by hand through the protected environment', () => {
  const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /\b(?:push|pull_request|schedule|workflow_run|repository_dispatch):/);
  assert.match(workflow, /\n {4}environment: gcp-staging\n/);
  assert.match(workflow, /test "\$EXPECTED_SHA" = "\$GITHUB_SHA"/);
  for (const check of ['verify (ubuntu-latest)', 'collector (ubuntu-latest)', 'terraform', 'container'])
    assert.ok(workflow.includes(`'${check}'`), check);
});

await test('staging stays private', () => {
  assert.match(workflow, /--no-allow-unauthenticated/);
  assert.doesNotMatch(workflow.replaceAll('--no-allow-unauthenticated', ''), /allow-unauthenticated/);
  const code = (text: string) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  for (const text of [workflow, terraform]) assert.doesNotMatch(code(text), /allUsers|allAuthenticatedUsers/);
  assert.match(workflow, /= 403$/m);
  assert.match(terraform, /public_access_prevention\s+=\s+"enforced"/);
});

await test('workflows pin every action to a commit SHA', () => {
  for (const text of [workflow, ci])
    for (const [, ref] of text.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(ref, /@[0-9a-f]{40}$/, ref);
});

await test('secret values never pass through GitHub or Terraform', () => {
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.match(workflow, /--set-secrets "\$SECRETS"/);
  assert.match(workflow, /\^\[1-9\]\[0-9\]\*\$/); // pinned numeric versions, never "latest"
  assert.doesNotMatch(terraform, /google_secret_manager_secret_version|google_service_account_key/);
});

await test('agent features are optional deploy settings', () => {
  for (const name of ['GEMINI_API_KEY optional', 'GOOGLE_MAPS_API_KEY optional', 'GOOGLE_GENAI_USE_VERTEXAI=true', 'FIREBASE_WEB_API_KEY='])
    assert.ok(workflow.includes(name), name);
  assert.match(terraform, /collection\s+=\s+"agentSessions"/);
  assert.match(terraform, /field\s+=\s+"expiresAt"/);
});
