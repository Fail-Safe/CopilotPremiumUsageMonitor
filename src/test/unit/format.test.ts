import test from 'node:test';
import assert from 'node:assert/strict';
import { computeUsageBar, formatRelativeTime, pickIcon } from '../../lib/format';

test('computeUsageBar basic distribution', () => {
  assert.equal(computeUsageBar(0), '▱'.repeat(10));
  assert.equal(computeUsageBar(100), '▰'.repeat(10));
  const mid = computeUsageBar(55); // rounding to nearest segment
  assert.equal(mid.length, 10);
});

test('formatRelativeTime buckets', () => {
  const now = Date.now();
  assert.equal(formatRelativeTime(now, now), 'just now');
  assert.equal(formatRelativeTime(now - 10_000, now).endsWith('s ago'), true);
  assert.ok(['1m ago','just now'].includes(formatRelativeTime(now - 60_000, now)));
});

test('pickIcon selects error variants and override', () => {
  const err = pickIcon({ percent: 10, warnAt: 80, dangerAt: 100, error: 'Network failure', mode: 'personal' });
  assert.equal(err.icon, 'cloud-offline');
  const ok = pickIcon({ percent: 10, warnAt: 80, dangerAt: 100, mode: 'personal', override: 'graph' });
  assert.equal(ok.icon, 'graph');
});
