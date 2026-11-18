import assert from 'node:assert/strict';
import test from 'node:test';

import { catalogStorageMode } from '../lib/storage-selection.ts';

void test('catalog storage keeps GCP as the existing default', () => {
  assert.equal(catalogStorageMode({}), 'gcp');
  assert.equal(catalogStorageMode({ EVENT_REC_CATALOG: 'gcp' }), 'gcp');
});

void test('catalog storage selects the bundled snapshot explicitly', () => {
  assert.equal(catalogStorageMode({ EVENT_REC_CATALOG: 'bundled' }), 'bundled');
});

void test('catalog storage rejects unknown backends', () => {
  assert.throws(
    () => catalogStorageMode({ EVENT_REC_CATALOG: 'database' }),
    /EVENT_REC_CATALOG/,
  );
});
