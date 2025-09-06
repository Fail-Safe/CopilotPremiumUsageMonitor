import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Experimental trends gating (panel summary payload)', () => {
    async function activate(): Promise<any> {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports;
    }

    test('usageHistory is null when disabled, object when enabled', async () => {
        const api = await activate();

        // Start with feature disabled
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor')
            .update('enableExperimentalTrends', false, vscode.ConfigurationTarget.Global);

        // Open panel fresh and capture initial summary
        api._test_resetPostedMessages?.();
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        await new Promise(r => setTimeout(r, 140)); // allow webview init + delayed summary post

        const msgsDisabled: any[] = api._test_getPostedMessages?.() || [];
        const summaryDisabled = [...msgsDisabled].reverse().find(m => m?.type === 'summary');
        assert.ok(summaryDisabled, 'Expected a summary message when disabled');
        assert.strictEqual(summaryDisabled.usageHistory, null, 'usageHistory should be null when experimental trends disabled');

        // Enable feature and reopen panel to force a new summary reflecting the flag
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor')
            .update('enableExperimentalTrends', true, vscode.ConfigurationTarget.Global);

        api._test_resetPostedMessages?.();
        await api._test_closePanel?.();
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        await new Promise(r => setTimeout(r, 140));

        const msgsEnabled: any[] = api._test_getPostedMessages?.() || [];
        const summaryEnabled = [...msgsEnabled].reverse().find(m => m?.type === 'summary');
        assert.ok(summaryEnabled, 'Expected a summary message when enabled');
        assert.ok(summaryEnabled.usageHistory && typeof summaryEnabled.usageHistory === 'object', 'usageHistory should be an object when experimental trends enabled');
    });
});
