import assert from 'node:assert/strict';
import test from 'node:test';

import { detectMessageLanguage } from '../lib/language.ts';

void test('message language detection covers the live English query and Turkish requests', () => {
  assert.equal(
    detectMessageLanguage(
      'Find me a jazz or rock concert in Istanbul next weekend under 1500 TL',
    ),
    'en',
  );
  assert.equal(detectMessageLanguage('Any jazz events this weekend?'), 'en');
  assert.equal(detectMessageLanguage('Yes, Friday please.'), 'en');
  assert.equal(
    detectMessageLanguage('Bu hafta sonu 1500 TL altında konser bul'),
    'tr',
  );
  assert.equal(detectMessageLanguage("Cumartesi Kadıköy'de tiyatro"), 'tr');
});
