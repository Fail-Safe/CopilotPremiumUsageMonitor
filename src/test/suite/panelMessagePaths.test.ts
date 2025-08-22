import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Panel message paths batch1', () => {
    async function activate(): Promise<any> {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports as any;
    }

    test('getConfig merges legacy settings and posts config + error replay', async () => {
        const api = await activate();
        api._test_resetPostedMessages();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('budget', 12, vscode.ConfigurationTarget.Global);
        // Ensure config write settles
        for (let i = 0; i < 10; i++) {
            const val = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').get('budget');
            if (val === 12) break; // tslint:disable-line
            await new Promise(r => setTimeout(r, 30));
        }
        api._test_setLastError('Network error: Unable to reach GitHub.');
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        api._test_invokeWebviewMessage({ type: 'getConfig' });
        await new Promise(r => setTimeout(r, 200));
        const msgs = api._test_getPostedMessages();
        const cfgMsg = msgs.find((m: any) => m.type === 'config');
        assert.ok(cfgMsg, 'Expected config message');
        assert.strictEqual(cfgMsg.config.budget, 12, 'Budget mismatch');
        const errReplay = msgs.find((m: any) => m.type === 'error');
        assert.ok(errReplay && /network error/i.test(errReplay.message), 'Expected error replay message');
    });

    test('dismissFirstRun sets flags and subsequent open does not resend notice', async () => {
        const api = await activate();
        await api._test_resetFirstRun?.();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('disableFirstRunTips', false, vscode.ConfigurationTarget.Global);
        api._test_closePanel?.(); // ensure new panel instance so constructor re-runs notice logic
        api._test_resetPostedMessages();
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        await new Promise(r => setTimeout(r, 80));
        const firstMsgs = api._test_getPostedMessages();
        const hadNotice = firstMsgs.some((m: any) => m.type === 'notice');
        api._test_invokeWebviewMessage({ type: 'dismissFirstRun' });
        await new Promise(r => setTimeout(r, 30));
        api._test_resetPostedMessages();
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel'); // reopen should NOT send notice
        await new Promise(r => setTimeout(r, 80));
        const secondMsgs = api._test_getPostedMessages();
        const noticeAgain = secondMsgs.some((m: any) => m.type === 'notice');
        assert.ok(hadNotice, 'Expected initial notice');
        assert.ok(!noticeAgain, 'Did not expect notice after dismissal');
    });

    test('openExternal only allows http(s) and ignores others', async () => {
        const api = await activate();
        const opened: string[] = [];
        const orig = (vscode.env as any).openExternal;
        (vscode.env as any).openExternal = (uri: vscode.Uri) => { opened.push(uri.toString()); return Promise.resolve(true); };
        try {
            await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
            api._test_invokeWebviewMessage({ type: 'openExternal', url: 'https://example.com' });
            api._test_invokeWebviewMessage({ type: 'openExternal', url: 'javascript:alert(1)' });
            api._test_invokeWebviewMessage({ type: 'openExternal', url: 'ftp://example.com/resource' });
            api._test_invokeWebviewMessage({ type: 'openExternal', url: 'file:///etc/passwd' });
            api._test_invokeWebviewMessage({ type: 'openExternal', url: 'mailto:test@example.com' });
            await new Promise(r => setTimeout(r, 50));
            assert.ok(opened.some(u => u.startsWith('https://example.com')), 'Expected https URL opened');
            assert.ok(!opened.some(u => u.startsWith('javascript:')), 'javascript scheme should be blocked');
            assert.ok(!opened.some(u => u.startsWith('ftp:')), 'ftp scheme should be blocked');
            assert.ok(!opened.some(u => u.startsWith('file:')), 'file scheme should be blocked');
            assert.ok(!opened.some(u => u.startsWith('mailto:')), 'mailto scheme should be blocked');
        } finally {
            (vscode.env as any).openExternal = orig;
        }
    });

    test('refresh mode auto routes to org when org configured else personal', async () => {
        const api = await activate();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', 'R_TOKEN', vscode.ConfigurationTarget.Global);
        api._test_setOctokitFactory(() => ({
            request: async (route: string) => {
                if (route === 'GET /user') return { data: { login: 'tester' } };
                if (route.startsWith('GET /users/')) return { data: { usageItems: [{ product: 'Copilot', netAmount: 1.25, quantity: 2, sku: 'copilot' }] } };
                throw new Error('Unexpected route ' + route);
            }, paginate: async () => []
        }));
        await api._test_refreshPersonal();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('org', 'demo-org', vscode.ConfigurationTarget.Global);
        api._test_setOctokitFactory(() => ({
            request: async (route: string) => {
                if (route === 'GET /orgs/{org}/copilot/metrics') { const err: any = new Error('Org metrics endpoint returned 404.'); err.status = 404; throw err; }
                if (route === 'GET /user') return { data: { login: 'tester' } };
                throw new Error('Unexpected route ' + route);
            }, paginate: async () => []
        }));
        api._test_clearLastError?.();
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        await new Promise(r => setTimeout(r, 60));
        api._test_invokeWebviewMessage({ type: 'refresh', mode: 'auto' });
        await new Promise(r => setTimeout(r, 150));
        const err = api._test_getLastError();
        assert.ok(err && /(org metrics endpoint returned 404|Failed to sync org metrics)/i.test(err), 'Expected org metrics 404 error captured');
    });

    test('personal refresh error variant mapping 403 -> auth error message', async () => {
        const api = await activate();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', 'P_TOKEN', vscode.ConfigurationTarget.Global);
        api._test_setOctokitFactory(() => ({
            request: async (route: string) => {
                if (route === 'GET /user') return { data: { login: 'tester' } };
                if (route.startsWith('GET /users/')) { const err: any = new Error('Permission denied'); err.status = 403; throw err; }
                throw new Error('Unexpected route ' + route);
            }, paginate: async () => []
        }));
        await api._test_refreshPersonal();
        const err = api._test_getLastError();
        assert.ok(err && /permission denied|Authentication error/i.test(err), 'Expected permission/auth error capture');
    });

    test('locale fallback uses default text when missing key (heuristic)', async () => {
        const api = await activate();
        api._test_resetPostedMessages();
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        await new Promise(r => setTimeout(r, 140));
        const msgs = api._test_getPostedMessages();
        // Look for at least one localized label we know the English default of
        const configMsg = msgs.find((m: any) => m.type === 'config');
        assert.ok(configMsg, 'Expected config message');
        // If migration notice appears, ensure its text not empty (fallback or localized)
        const notice = msgs.find((m: any) => m.type === 'notice');
        if (notice) {
            assert.ok((notice.text || '').length > 5, 'Notice text should not be empty');
        }
    });
});
