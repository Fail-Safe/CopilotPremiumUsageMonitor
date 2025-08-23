import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Panel refresh message paths (org)', () => {
    async function activate(): Promise<any> {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports;
    }

    void test('org refresh success clears stale', async () => {
        const api = await activate();
        api._test_clearLastError?.();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', 'ORG_TOKEN', vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('org', 'my-org', vscode.ConfigurationTarget.Global);
    // Wait for setting propagation (org + token) to become observable to getGitHubToken/_test_refreshOrg
    for (let i = 0; i < 20; i++) { const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor'); const t = cfg.get('token'); const o = cfg.get('org'); if (t === 'ORG_TOKEN' && o === 'my-org') break; await new Promise(r => setTimeout(r, 40)); }
        api._test_setOctokitFactory(() => ({
            request: (route: string) => {
                if (route === 'GET /orgs/{org}/copilot/metrics') return { data: [] };
                if (route === 'GET /user') return { data: { login: 'tester' } };
                throw new Error('Unexpected route ' + route);
            }, paginate: () => []
        }));
        await api._test_refreshOrg();
        let err: string | undefined; const start = Date.now();
        while (Date.now() - start < 900) { err = api._test_getLastError(); if (!err) break; await new Promise(r => setTimeout(r, 30)); }
        assert.ok(!err, 'Org refresh success should clear last error');
    });

    void test('org refresh network error sets stale', async () => {
        const api = await activate();
        api._test_clearLastError?.();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', 'ORG_TOKEN2', vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('org', 'my-org', vscode.ConfigurationTarget.Global);
    // Wait for setting propagation (org + token) to become observable
    for (let i = 0; i < 20; i++) { const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor'); const t = cfg.get('token'); const o = cfg.get('org'); if (t === 'ORG_TOKEN2' && o === 'my-org') break; await new Promise(r => setTimeout(r, 40)); }
        api._test_setOctokitFactory(() => ({
            request: (route: string) => {
                if (route === 'GET /orgs/{org}/copilot/metrics') { const err: any = new Error('Network Unreachable'); err.message = 'Network Unreachable'; throw err; }
                if (route === 'GET /user') return { data: { login: 'tester' } };
                throw new Error('Unexpected route ' + route);
            }, paginate: () => []
        }));
        await api._test_refreshOrg();
        let err: string | undefined; const start = Date.now(); const timeoutMs = 2500; // extended for slower Linux CI disk/import times
        while (Date.now() - start < timeoutMs) { err = api._test_getLastError(); if (err) break; await new Promise(r => setTimeout(r, 40)); }
        assert.ok(err && (/org metrics/i.test(err) || /Network error/i.test(err) || /Network Unreachable/i.test(err)), 'Expected stored org metrics or network error message');
    });
});
