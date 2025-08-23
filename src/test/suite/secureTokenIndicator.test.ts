import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Secure token indicator', () => {
    const EXT_ID = 'fail-safe.copilot-premium-usage-monitor';

    async function activate(): Promise<any> {
        const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
        await ext.activate();
        return ext.exports;
    }

    test('indicator shows when secure token set and plaintext cleared', async () => {
        const api = await activate();
        // Ensure clean start
        await api._test_clearSecretToken?.();
        // Ensure no prior panel
        api._test_closePanel?.();
        // Stub input for secure token command
        const orig = (vscode.window.showInputBox as any);
        (vscode.window.showInputBox as any) = () => Promise.resolve('indicator_token_123');
        try {
            await vscode.commands.executeCommand('copilotPremiumUsageMonitor.setTokenSecure');
        } finally {
            (vscode.window.showInputBox as any) = orig;
        }
        // Open panel and request config
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        api._test_resetPostedMessages?.();
        // Poll (tolerate possible transient legacy detection until suppress window applied)
        let cfg: any | undefined; let attempts = 0;
        while (attempts < 18) { // up to ~1.1s (18 * ~60ms)
            api._test_invokeWebviewMessage?.({ type: 'getConfig' });
            await new Promise(r => setTimeout(r, 60));
            const msgs = api._test_getPostedMessages?.() || [];
            cfg = msgs.slice().reverse().find((m: any) => m.type === 'config' && m.config?.securePatOnly !== undefined);
            if (cfg?.config?.securePatOnly === true) break;
            attempts++;
        }
        assert.ok(cfg, 'Expected config message');
        assert.strictEqual(cfg.config.securePatOnly, true, 'Expected securePatOnly true after propagation window');
        assert.strictEqual(typeof cfg.config.secureTokenText, 'string');
        assert.ok(/Secure token set/i.test(cfg.config.secureTokenText), 'Expected localized secureTokenText default');
        assert.strictEqual(typeof cfg.config.secureTokenTitle, 'string');
        assert.ok(/Secure token stored/i.test(cfg.config.secureTokenTitle), 'Expected localized secureTokenTitle');
        // Cleanup secret to avoid contaminating later tests
        await api._test_clearSecretToken?.();
    });
});