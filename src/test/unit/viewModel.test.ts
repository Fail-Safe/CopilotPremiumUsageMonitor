import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageViewModel } from '../../lib/viewModel';

void test('viewModel builder: clamps includedShown and computes overage', () => {
    const vm = buildUsageViewModel({
        budget: 10,
        spend: 2,
        budgetPct: 20,
        warnAt: 75,
        dangerAt: 90,
        progressColor: '#2d7d46',
        included: 50,
        includedUsed: 134,
        includedPct: 100,
        usageHistory: null
    }, { pricePerPremiumRequest: 0.04 });

    assert.equal(vm.includedShown, 50, 'includedShown should clamp to included');
    assert.equal(vm.includedPct, 100, 'includedPct should be capped at 100');
    assert.equal(vm.overageQty, 84, 'overage quantity should be used - included');
    assert.equal(vm.overageCost, 3.36, 'overage cost should be qty * price');
});

void test('viewModel builder: handles zero included gracefully', () => {
    const vm = buildUsageViewModel({
        budget: 0,
        spend: 0,
        budgetPct: 0,
        warnAt: 75,
        dangerAt: 90,
        progressColor: '#2d7d46',
        included: 0,
        includedUsed: 134,
        includedPct: 0,
        usageHistory: null
    }, { pricePerPremiumRequest: 0.04 });

    assert.equal(vm.includedShown, 0, 'includedShown should be 0 when included is 0');
    assert.equal(vm.includedPct, 0, 'includedPct should be 0 when included is 0');
    assert.equal(vm.overageQty, 134, 'overage quantity should equal used when included is 0');
    assert.equal(vm.overageCost, 5.36, 'overage cost should compute from qty * price');
});
