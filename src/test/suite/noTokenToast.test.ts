import * as assert from 'assert';
import * as vscode from 'vscode';
import test from 'node:test';

const EXT_ID = 'fail-safe.copilot-premium-usage-monitor';

async function activateWithMode(mode: string, org?: string) {
    const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
    await cfg.update('mode', mode, vscode.ConfigurationTarget.Global);
    await cfg.update('org', org ?? '', vscode.ConfigurationTarget.Global);
    await cfg.update('token', '', vscode.ConfigurationTarget.Global); // ensure plaintext empty
    const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
    const api = await ext.activate();
    return { api, ext };
}

test.beforeEach(async () => {
    const ext = vscode.extensions.getExtension<any>(EXT_ID);
    if (ext && ext.isActive) {
        const api: any = ext.exports;
        await api?._test_clearSecretToken?.();
    }
});

// We cannot directly assert a toast; instead we verify the one-time flag stored in globalState is set when criteria met.

test('no-token activation hint appears after opening panel (mode=personal)', async () => {
    const { ext } = await activateWithMode('personal');
    const api: any = ext.exports;
    // Extra defensive clear in case secret existed from previous suites
    await api._test_clearSecretToken?.();
    api._test_resetPostedMessages?.();
    await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
    // request config to trigger hint post
    api._test_invokeWebviewMessage?.({ type: 'getConfig' });
    let hint: any | undefined; let attempts = 6;
    for (let i = 0; i < attempts; i++) {
        await new Promise(r => setTimeout(r, 120));
        const msgs = api._test_getPostedMessages?.() || [];
        hint = msgs.find((m: any) => m.type === 'setTokenHint' && /No secure token/i.test(m.message || ''));
        if (hint) break;
        // Re-invoke getConfig once mid-way to force resend if timing dropped initial
        if (i === 2) { api._test_invokeWebviewMessage?.({ type: 'getConfig' }); }
    }
    assert.ok(hint, 'Expected setTokenHint message when no token present in personal context');
});

// Edge case: auto mode with org configured should NOT show hint.

test('no-token activation does not hint in auto mode with org present', async () => {
    const { ext } = await activateWithMode('auto', 'someOrgName');
    const api: any = ext.exports;
    api._test_resetPostedMessages?.();
    await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
    api._test_invokeWebviewMessage?.({ type: 'getConfig' });
    await new Promise(r => setTimeout(r, 250));
    const msgs = api._test_getPostedMessages?.() || [];
    const hint = msgs.find((m: any) => m.type === 'setTokenHint' && /No secure token/i.test(m.message || ''));
    assert.ok(!hint, 'Did not expect setTokenHint in auto mode with org configured');
});
