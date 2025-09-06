import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import test from 'node:test';

void test('token setting has deprecationMessage', () => {
    const pkgPath = path.resolve(__dirname, '../../../package.json');
    const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const props = json?.contributes?.configuration?.properties || {};
    const node = props['copilotPremiumUsageMonitor.token'];
    assert.ok(node, 'token setting missing');
    assert.ok(typeof node.deprecationMessage === 'string' && node.deprecationMessage.toLowerCase().includes('deprecated'), 'deprecationMessage missing or not descriptive');
});

import { computeIncludedOverageSummary } from '../../lib/usageUtils';

void test('computeIncludedOverageSummary produces expected string', () => {
    const s = computeIncludedOverageSummary({ totalQuantity: 150, totalIncludedQuantity: 100, pricePerPremiumRequest: 0.04 });
    assert.ok(s.includes('Included Premium Requests'), 'Should mention Included Premium Requests');
    assert.ok(s.includes('Overage'), 'Should mention Overage');
    assert.ok(s.includes('2.00') || s.includes('2.0'), 'Should include calculated overage cost (50 * 0.04 = 2.00)');
});
