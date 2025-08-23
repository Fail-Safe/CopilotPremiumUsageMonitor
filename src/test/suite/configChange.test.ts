import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Config reactions', () => {
    test('updates status bar on budget + icon override change', async () => {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id);
        assert.ok(ext, 'Extension not found');
        await ext.activate();
        const api: any = ext.exports;
        await api._test_setSpendAndUpdate?.(1, 10);
        // Ensure no residual error state which would suppress override icon
        try { api._test_clearLastError?.(); } catch { /* noop */ }
        const original = api._test_getStatusBarText?.();
        assert.ok(original);
        // Apply icon override
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('statusBarIconOverride', 'rocket', vscode.ConfigurationTarget.Global);
        // Force status bar update via public helper
        await new Promise(r => setTimeout(r, 50));
        api._test_forceStatusBarUpdate?.();
        const withOverride = api._test_getStatusBarText?.();
        assert.ok(withOverride && withOverride.includes('$(rocket)'), 'Icon override not applied in status bar text');
        // Revert override
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('statusBarIconOverride', '', vscode.ConfigurationTarget.Global);
    });

    test('recreates status bar on alignment change', async () => {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id);
        assert.ok(ext, 'Extension not found');
        await ext.activate();
        const api: any = ext.exports;
        await api._test_setSpendAndUpdate?.(2, 10);
        const before = api._test_getStatusBarText?.();
        assert.ok(before);
        const current = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').get('statusBarAlignment');
        const next = current === 'left' ? 'right' : 'left';
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('statusBarAlignment', next, vscode.ConfigurationTarget.Global);
        await new Promise(r => setTimeout(r, 50));
        api._test_forceStatusBarUpdate?.();
        const after = api._test_getStatusBarText?.();
        assert.ok(after && after !== '', 'Status bar text missing after alignment change');
    });
});
