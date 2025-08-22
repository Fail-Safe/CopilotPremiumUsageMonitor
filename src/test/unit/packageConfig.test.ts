import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import test from 'node:test';

test('token setting has deprecationMessage', () => {
    const pkgPath = path.resolve(__dirname, '../../../package.json');
    const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const props = json?.contributes?.configuration?.properties || {};
    const node = props['copilotPremiumUsageMonitor.token'];
    assert.ok(node, 'token setting missing');
    assert.ok(typeof node.deprecationMessage === 'string' && node.deprecationMessage.toLowerCase().includes('deprecated'), 'deprecationMessage missing or not descriptive');
});
