import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Activation', () => {
    test('activates and registers key commands & status bar text pattern', async () => {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id);
        assert.ok(ext, 'Extension not found');
        await ext.activate();

        const commands = await vscode.commands.getCommands(true);
        const expected = [
            'copilotPremiumUsageMonitor.openPanel',
            'copilotPremiumUsageMonitor.signIn',
            'copilotPremiumUsageMonitor.configureOrg',
            'copilotPremiumUsageMonitor.manage',
            'copilotPremiumUsageMonitor.showLogs',
            'copilotPremiumUsageMonitor.enableFirstRunNotice'
        ];
        for (const c of expected) {
            assert.ok(commands.includes(c), `Missing command: ${c}`);
        }

        const api: any = ext.exports;
        // deterministically set spend & budget then update status bar
        await api._test_setSpendAndUpdate?.(2, 10);
        const text: string | undefined = api?._test_getStatusBarText?.();
        assert.ok(text, 'Status bar text still undefined after helper');
        assert.ok(/^\$\([a-z0-9-]+\) \d+% [▰▱]{10}(?: \[stale\])?$/.test(text), `Unexpected status bar text: ${text}`);
    });
});
