import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_EVIDENCE_MAX_HOURS,
  evidenceMaxHoursFrom,
} from '../lib/evidence-window.ts';

void test('evidence window accepts only integer hours from 1 through 720', () => {
  assert.equal(evidenceMaxHoursFrom({}), DEFAULT_EVIDENCE_MAX_HOURS);
  assert.equal(
    evidenceMaxHoursFrom({ EVENT_REC_EVIDENCE_MAX_HOURS: ' 1 ' }),
    1,
  );
  assert.equal(
    evidenceMaxHoursFrom({ EVENT_REC_EVIDENCE_MAX_HOURS: '720' }),
    720,
  );
  for (const value of ['', '0', '721', '72.5', '-1', 'hours'])
    assert.equal(
      evidenceMaxHoursFrom({ EVENT_REC_EVIDENCE_MAX_HOURS: value }),
      DEFAULT_EVIDENCE_MAX_HOURS,
      value,
    );
});
