import * as assert from 'assert';
import * as vscode from 'vscode';

// This test ensures that invoking the secure token set / clear commands while the panel
// is already open triggers an immediate webview refresh (config message posted) without
// needing to manually send a getConfig message. This validates the explicit panel.update()
// + postFreshConfig() calls added to the commands.

suite('Secure token indicator live refresh', () => {
    const EXT_ID = 'fail-safe.copilot-premium-usage-monitor';

    async function activate(): Promise<any> {
        const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
        await ext.activate();
        return ext.exports;
    }

    test('config message posts automatically after set & clear token commands', async () => {
        const api = await activate();
        // Ensure clean start: clear any secret/plaintext token
        await api._test_clearSecretToken?.();

        // Open panel (initial webview will request config itself). Wait a moment then reset messages
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        await new Promise(r => setTimeout(r, 250));
        api._test_resetPostedMessages?.();

        // Stub input box to provide a token for setTokenSecure
        const tokenValue = 'live_refresh_token_' + Date.now();
        const origInput = (vscode.window.showInputBox as any);
        (vscode.window.showInputBox as any) = async () => tokenValue;
        try {
            await vscode.commands.executeCommand('copilotPremiumUsageMonitor.setTokenSecure');
        } finally {
            (vscode.window.showInputBox as any) = origInput;
        }

        // Allow async postFreshConfig + update scheduling
        // Poll briefly for config message since update + postFreshConfig are async
        let configAfterSet: any | undefined;
        for (let i = 0; i < 10 && !configAfterSet; i++) {
            await new Promise(r => setTimeout(r, 80));
            const msgs: any[] = api._test_getPostedMessages?.() || [];
            configAfterSet = [...msgs].reverse().find(m => m.type === 'config');
        }
        assert.ok(configAfterSet, 'Expected a config message after setting secure token');
        assert.strictEqual(configAfterSet.config.hasSecurePat, true, 'Expected hasSecurePat true after setting token');
        assert.strictEqual(configAfterSet.config.securePatOnly, true, 'Expected securePatOnly true with no residual plaintext');

        // Now clear posted messages and invoke clearTokenSecure
        api._test_resetPostedMessages?.();
        const origQP = (vscode.window.showQuickPick as any);
        (vscode.window.showQuickPick as any) = async () => 'Yes, clear stored token';
        try {
            await vscode.commands.executeCommand('copilotPremiumUsageMonitor.clearTokenSecure');
        } finally {
            (vscode.window.showQuickPick as any) = origQP;
        }

        let configAfterClear: any | undefined;
        for (let i = 0; i < 10 && !configAfterClear; i++) {
            await new Promise(r => setTimeout(r, 80));
            const msgs2: any[] = api._test_getPostedMessages?.() || [];
            configAfterClear = [...msgs2].reverse().find(m => m.type === 'config');
        }
        assert.ok(configAfterClear, 'Expected a config message after clearing secure token');
        assert.strictEqual(configAfterClear.config.hasSecurePat, false, 'Expected hasSecurePat false after clearing token');
        assert.strictEqual(configAfterClear.config.residualPlaintext, false, 'Expected no residual plaintext after clearing token');

        // Cleanup just in case
        await api._test_clearSecretToken?.();
    });
});
