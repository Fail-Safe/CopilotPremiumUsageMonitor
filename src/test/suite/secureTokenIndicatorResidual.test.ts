import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Secure token indicator (residual plaintext)', () => {
    const EXT_ID = 'fail-safe.copilot-premium-usage-monitor';

    async function activate(): Promise<any> {
        const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
        await ext.activate();
        return ext.exports;
    }

    test('indicator shows with warning style when secure + plaintext present', async () => {
        const api = await activate();
        // Ensure clean start
        await api._test_clearSecretToken?.();
        api._test_closePanel?.();
        // Seed plaintext token setting (legacy)
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', 'legacy_plain_token', vscode.ConfigurationTarget.Global);
        // Stub quick pick for migration (choose No / keep plaintext copy)
        const origQP = (vscode.window.showQuickPick as any);
        (vscode.window.showQuickPick as any) = async () => 'No (keep for now)';
        try {
            await vscode.commands.executeCommand('copilotPremiumUsageMonitor.migrateToken');
        } finally {
            (vscode.window.showQuickPick as any) = origQP;
        }
        // Open panel and request config
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        api._test_resetPostedMessages?.();
        api._test_invokeWebviewMessage?.({ type: 'getConfig' });
        await new Promise(r => setTimeout(r, 300));
        const msgs = api._test_getPostedMessages?.() || [];
        const cfgMsg = [...msgs].reverse().find((m: any) => m.type === 'config');
        assert.ok(cfgMsg, 'Expected config message');
        assert.strictEqual(cfgMsg.config.hasSecurePat, true, 'Expected hasSecurePat true');
        assert.strictEqual(cfgMsg.config.securePatOnly, false, 'Expected securePatOnly false (residual plaintext present)');
        assert.strictEqual(cfgMsg.config.residualPlaintext, true, 'Expected residualPlaintext true');
        assert.ok(/Plaintext in settings/i.test(cfgMsg.config.secureTokenTextResidual), 'Expected residual secureTokenTextResidual localized string');
        assert.ok(/plaintext copy still in settings/i.test(cfgMsg.config.secureTokenTitleResidual), 'Expected residual secureTokenTitleResidual localized string');
        // Cleanup: clear both secure + plaintext
        await api._test_clearSecretToken?.();
    });
});
