import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Panel refresh message paths (org)', () => {
    async function activate(): Promise<any> {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports as any;
    }

    test('org refresh success clears stale', async () => {
        const api = await activate();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', 'ORG_TOKEN', vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('org', 'my-org', vscode.ConfigurationTarget.Global);
        api._test_setOctokitFactory(() => ({
            request: async (route: string) => {
                if (route === 'GET /orgs/{org}/copilot/metrics') return { data: [] };
                if (route === 'GET /user') return { data: { login: 'tester' } };
                throw new Error('Unexpected route ' + route);
            }, paginate: async () => []
        }));
        await api._test_refreshOrg();
        let err: string | undefined; const start = Date.now();
        while (Date.now() - start < 500) { err = api._test_getLastError(); if (!err) break; await new Promise(r => setTimeout(r, 25)); }
        assert.ok(!err, 'Org refresh success should clear last error');
    });

    test('org refresh network error sets stale', async () => {
        const api = await activate();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', 'ORG_TOKEN2', vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('org', 'my-org', vscode.ConfigurationTarget.Global);
        api._test_setOctokitFactory(() => ({
            request: async (route: string) => {
                if (route === 'GET /orgs/{org}/copilot/metrics') { const err: any = new Error('Network Unreachable'); err.message = 'Network Unreachable'; throw err; }
                if (route === 'GET /user') return { data: { login: 'tester' } };
                throw new Error('Unexpected route ' + route);
            }, paginate: async () => []
        }));
        await api._test_refreshOrg();
        let err: string | undefined; const start = Date.now();
        while (Date.now() - start < 500) { err = api._test_getLastError(); if (err) break; await new Promise(r => setTimeout(r, 25)); }
        assert.ok(err && (/org metrics/i.test(err) || /Network error/i.test(err)), 'Expected stored org metrics or network error message');
    });
});
