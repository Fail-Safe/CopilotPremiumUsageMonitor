import * as assert from 'assert';
import * as vscode from 'vscode';

suite('No token stale state', () => {
    const EXT_ID = 'fail-safe.copilot-premium-usage-monitor';

    async function activate(): Promise<any> {
        const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
        await ext.activate();
        return ext.exports;
    }

    test('status bar shows [stale] when no token in personal context', async () => {
        const api = await activate();
        // Ensure personal mode (auto with no org or explicit personal)
        const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
        await cfg.update('mode', 'personal', vscode.ConfigurationTarget.Global);
        await cfg.update('org', '', vscode.ConfigurationTarget.Global);
        await cfg.update('token', '', vscode.ConfigurationTarget.Global);
        // Clear any existing secure token via test hook
        await api._test_clearSecretToken?.();
        // Force status bar update
        api._test_forceStatusBarUpdate?.();
        const text = api._test_getStatusBarText?.() || '';
        assert.ok(/\[stale\]/i.test(text), `Expected status bar to include [stale] when no token present, got: ${text}`);
    });
});
