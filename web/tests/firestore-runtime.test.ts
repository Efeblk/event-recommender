import assert from 'node:assert/strict';
import test from 'node:test';

import {
  firestoreRuntimeConfigFromEnv,
  serviceAccountCredentialsFromEnv,
} from '../lib/firestore-runtime.node.ts';

const secret = JSON.stringify({
  type: 'service_account',
  project_id: 'event-rec-demo-2026',
  client_email: 'demo@example.iam.gserviceaccount.com',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
});
const encoded = Buffer.from(secret).toString('base64');

void test('missing standalone Firestore credentials select the memory fallback', () => {
  assert.equal(serviceAccountCredentialsFromEnv({}), null);
  assert.equal(
    firestoreRuntimeConfigFromEnv({
      EVENT_REC_GCP_PROJECT: 'event-rec-demo-2026',
    }),
    null,
  );
});

void test('service-account base64 creates explicit Firestore options', () => {
  assert.deepEqual(
    firestoreRuntimeConfigFromEnv({
      EVENT_REC_GCP_PROJECT: 'event-rec-demo-2026',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: encoded,
    }),
    {
      projectId: 'event-rec-demo-2026',
      databaseId: '(default)',
      credentials: {
        client_email: 'demo@example.iam.gserviceaccount.com',
        private_key:
          '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
      },
    },
  );
});

void test('invalid base64 and JSON errors never include the secret', () => {
  for (const value of [
    'secret-value-not-base64',
    Buffer.from('{bad').toString('base64'),
  ]) {
    assert.throws(
      () =>
        serviceAccountCredentialsFromEnv({
          EVENT_REC_GCP_PROJECT: 'event-rec-demo-2026',
          GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: value,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /GOOGLE_SERVICE_ACCOUNT_JSON_BASE64/);
        assert.equal(error.message.includes(value), false);
        return true;
      },
    );
  }
});
