import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { findPlanById, listAvailablePlans, getGeneratedPrice, computePlanOverrides } from '../../lib/planUtils';

const GEN_DIR = path.resolve(process.cwd(), 'media', 'generated');
const GEN_FILE = path.join(GEN_DIR, 'copilot-plans.json');

function writeGen(json: object) {
    fs.mkdirSync(GEN_DIR, { recursive: true });
    fs.writeFileSync(GEN_FILE, JSON.stringify(json), 'utf8');
}

function removeGen() {
    try { fs.rmSync(GEN_FILE); } catch { /* noop */ }
}

void test('planUtils: generated plans file drives lookup and overrides', () => {
    const sample = {
        sourceUrl: 'https://example.local/plans.json',
        fetchedAt: new Date().toISOString(),
        pricePerPremiumRequest: 0.02,
        plans: [
            { id: 'copilot-test', name: 'Copilot Test', included: 123 }
        ]
    };
    writeGen(sample);

    try {
        const p = findPlanById('copilot-test');
        assert.ok(p, 'should find generated plan by id');
        assert.equal(p?.included, 123);

        const list = listAvailablePlans();
        assert.ok(Array.isArray(list));
        assert.ok(list.find(x => x.id === 'copilot-test'));

        const price = getGeneratedPrice();
        assert.equal(price, 0.02);

        const overrides = computePlanOverrides('copilot-test', 0, 0.04);
        assert.equal(overrides.included, 123);
        assert.equal(overrides.price, 0.02);
    } finally {
        removeGen();
    }
});

void test('planUtils: fallback plans when file missing', () => {
    removeGen();
    const p = findPlanById('copilot-pro');
    assert.ok(p);
    assert.equal(p?.included, 300);
    const list = listAvailablePlans();
    assert.ok(list.length > 0);
});
