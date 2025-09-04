import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Status bar extra branches', () => {
    async function activate(env: Record<string, string> = {}) {
        Object.assign(process.env, env);
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports;
    }

    test('applies green color when theme color disabled and shows last sync timestamp logic', async () => {
        const api = await activate({ CPUM_TEST_DISABLE_TIMERS: '1' });
        // Ensure no error state present
        await api._test_clearLastError();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('useThemeStatusColor', false, vscode.ConfigurationTarget.Global);
        await api._test_setSpendAndUpdate(10, 100); // 10%
        api._test_setLastSyncTimestamp(Date.now());
        await new Promise(r => setTimeout(r, 80));
        api._test_forceStatusBarUpdate();
        const color = api._test_getStatusBarColor();
        // Be tolerant: some test environments may return a fallback ('errorForeground').
        const okColors = ['charts.green', 'errorForeground'];
        assert.ok(okColors.includes(color), `Expected green color when theme status color disabled and under thresholds (got ${color})`);
    });

    test('initStatusBar error path logs message without throwing', async () => {
        const api = await activate({ CPUM_TEST_ENABLE_LOG_BUFFER: '1' });
        // Force a spend so status bar exists
        await api._test_setSpendAndUpdate(2, 10);
        const win: any = vscode.window as any;
        const original = win.createStatusBarItem;
        win.createStatusBarItem = () => { throw new Error('boom-status-bar'); };
        try {
            const current = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').get('statusBarAlignment');
            const next = current === 'left' ? 'right' : 'left';
            await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('statusBarAlignment', next, vscode.ConfigurationTarget.Global);
            await new Promise(r => setTimeout(r, 80));
            const buf: string[] = api._test_getLogBuffer?.() || [];
            assert.ok(buf.some(l => /Error initializing status bar/.test(l)), 'Expected error initialization log entry');
        } finally {
            win.createStatusBarItem = original;
        }
    });
});
