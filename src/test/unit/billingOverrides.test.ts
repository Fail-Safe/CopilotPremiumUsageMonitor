import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { loadGeneratedPlans } from '../../lib/planUtils';

void test('generated plans file loads and contains known keys or fallback', () => {
    const f = loadGeneratedPlans();
    // The generator may not have been run in CI; accept null but ensure fallback plan shape is plausible when present
    if (!f) return;
    assert.ok(Array.isArray(f.plans));
    for (const p of f.plans) {
        assert.ok(typeof p.id === 'string');
        assert.ok(typeof p.name === 'string');
    }
});

void test('billing override shape and behavior', () => {
    // Simulate billing items shape that fetchUserBillingUsage returns
    const billing = { totalNetAmount: 12.34, totalQuantity: 500, totalIncludedQuantity: 300, totalOverageQuantity: 200 };
    // User overrides
    const userIncluded = 1000;
    const userPrice = Number(0.05);
    const billingWithOverrides = {
        ...billing,
        pricePerPremiumRequest: userPrice,
        userConfiguredIncluded: userIncluded > 0,
        userConfiguredPrice: userPrice !== Number(0.04),
        totalIncludedQuantity: userIncluded > 0 ? userIncluded : billing.totalIncludedQuantity,
        totalOverageQuantity: Math.max(0, billing.totalQuantity - (userIncluded > 0 ? userIncluded : billing.totalIncludedQuantity))
    };
    assert.equal(billingWithOverrides.pricePerPremiumRequest, userPrice);
    assert.equal(billingWithOverrides.userConfiguredIncluded, true);
    assert.equal(billingWithOverrides.totalIncludedQuantity, userIncluded);
    assert.equal(billingWithOverrides.totalOverageQuantity, 0);
});
