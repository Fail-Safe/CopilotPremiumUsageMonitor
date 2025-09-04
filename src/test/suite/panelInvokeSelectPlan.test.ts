import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Panel invoke select plan', () => {
    async function activate(): Promise<any> {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports;
    }

    test('webview invokeSelectPlan message triggers command without error', async () => {
        const api = await activate();
        api._test_resetPostedMessages?.();
        // Open panel and allow constructor async work
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        await new Promise(r => setTimeout(r, 120));
        // Stub QuickPick so the command selects the first plan
        const win: any = vscode.window as any;
        const originalQP = win.showQuickPick;
        win.showQuickPick = async (items: any[]) => ({ ...(items && items[0]), id: items?.[0]?.id || 'copilot-pro' });
        try {
            // Invoke the webview-message that should call the selectPlan command
            api._test_invokeWebviewMessage({ type: 'invokeSelectPlan' });
        } finally {
            win.showQuickPick = originalQP;
        }
        // Wait for any resulting config post (the command calls postFreshConfig at end)
        let sawConfig = false; const start = Date.now();
        while (Date.now() - start < 1500) {
            const msgs = api._test_getPostedMessages?.() || [];
            if (msgs.some((m: any) => m.type === 'config')) { sawConfig = true; break; }
            await new Promise(r => setTimeout(r, 60));
        }
        assert.ok(sawConfig, 'Expected a config message after invoking select plan');
    });
});
