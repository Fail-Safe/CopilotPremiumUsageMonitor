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
    assert.ok(['1m ago', 'just now'].includes(formatRelativeTime(now - 60_000, now)));
    // 2 hours
    assert.match(formatRelativeTime(now - 2 * 60 * 60 * 1000, now), /^2h/);
    // 1 day
    assert.equal(formatRelativeTime(now - 24 * 60 * 60 * 1000, now), '1d ago');
    // 10 days -> weeks branch
    assert.equal(formatRelativeTime(now - 10 * 24 * 60 * 60 * 1000, now), '1w ago');
    // 70 days -> months branch (approx 2mo)
    assert.equal(formatRelativeTime(now - 70 * 24 * 60 * 60 * 1000, now), '2mo ago');
    // 400 days -> years branch (approx 1y)
    assert.equal(formatRelativeTime(now - 400 * 24 * 60 * 60 * 1000, now), '1y ago');
});

test('pickIcon selects error variants and override', () => {
    const err = pickIcon({ percent: 10, warnAt: 80, dangerAt: 100, error: 'Network failure', mode: 'personal' });
    assert.equal(err.icon, 'cloud-offline');
    const ok = pickIcon({ percent: 10, warnAt: 80, dangerAt: 100, mode: 'personal', override: 'graph' });
    assert.equal(ok.icon, 'graph');
    const invalid = pickIcon({ percent: 10, warnAt: 80, dangerAt: 100, mode: 'personal', override: '!!!!' });
    // falls back to base icon (account) for personal mode
    assert.equal(invalid.icon, 'account');
});
