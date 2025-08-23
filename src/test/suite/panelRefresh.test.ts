import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Panel refresh message paths (personal)', () => {
    async function activate(): Promise<any> {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports;
    }

    test('refresh personal success updates spend & clears stale', async () => {
        const api = await activate();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', 'TEST_TOKEN', vscode.ConfigurationTarget.Global);
        api._test_setOctokitFactory(() => ({
            request: (route: string) => {
                if (route === 'GET /user') return { data: { login: 'tester' } };
                if (route.startsWith('GET /users/')) return { data: { usageItems: [{ product: 'Copilot', sku: 'copilot-premium-request', netAmount: 3.5, quantity: 7 }] } };
                throw new Error('Unexpected route ' + route);
            }, paginate: () => []
        }));
        await api._test_refreshPersonal();
        // Poll until status reflects updated spend (timing can vary on CI)
        let spend: number | undefined; const start = Date.now();
        while (Date.now() - start < 500) { spend = api._test_getSpend(); if (spend === 3.5) break; await new Promise(r => setTimeout(r, 25)); }
        assert.strictEqual(spend, 3.5, 'Expected updated spend=3.5');
        assert.ok(!api._test_getLastError(), 'Should have cleared last error');
    });

    test('refresh personal 404 error sets stale tag', async () => {
        const api = await activate();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', 'TEST_TOKEN_2', vscode.ConfigurationTarget.Global);
        api._test_setOctokitFactory(() => ({
            request: (route: string) => {
                if (route === 'GET /user') return { data: { login: 'tester' } };
                if (route.startsWith('GET /users/')) { const err: any = new Error('Not Found'); err.status = 404; throw err; }
                throw new Error('Unexpected route ' + route);
            }, paginate: () => []
        }));
        await api._test_refreshPersonal();
        let err: string | undefined; const start = Date.now();
        while (Date.now() - start < 500) { err = api._test_getLastError(); if (err) break; await new Promise(r => setTimeout(r, 25)); }
        assert.ok(err && /404/i.test(err), 'Expected stored 404 error message');
    });
});
