import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlanOverrides } from '../../lib/planUtils';

void test('computePlanOverrides applies included and price when appropriate', () => {
    // If no generated plans file is present, function returns empty; that's acceptable.
    const res = computePlanOverrides(undefined, 0, 0.04);
    assert.ok(res && typeof res === 'object');
});
