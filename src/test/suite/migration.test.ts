import * as assert from 'assert';
import * as vscode from 'vscode';
import test from 'node:test';

const EXT_ID = 'fail-safe.copilot-premium-usage-monitor';

// Helper function to dynamically import the extension module
async function getExtensionModule() {
    return await import('../../extension');
}

async function activateWithConfig(pairs: Record<string, any>) {
    const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
    for (const [k, v] of Object.entries(pairs)) {
        await cfg.update(k, v, vscode.ConfigurationTarget.Global);
    }
    const ext = vscode.extensions.getExtension<any>(EXT_ID);
    assert.ok(ext, 'Extension not found');
    const api = await ext.activate();
    return { api, ext };
}

async function cleanupAll() {
    const ext = vscode.extensions.getExtension<any>(EXT_ID);
    if (ext && ext.isActive) {
        const api: any = ext.exports;
        await api?._test_clearSecretToken?.();
    }
    // Ensure plaintext cleared
    await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', '', vscode.ConfigurationTarget.Global);
}

void test.beforeEach(async () => {
    await cleanupAll();
});

void test('token migration writes secret storage copy (keeps legacy)', async () => {
    const testToken = 'test_pat_123';
    await activateWithConfig({ token: testToken });
    const mod = await getExtensionModule();
    const info = await (mod as any)._test_readTokenInfo();
    assert.ok(info, 'No token info');
    assert.strictEqual(info.token, testToken, 'Token mismatch');
    assert.ok(['settings', 'secretStorage'].includes(info.source), 'Unexpected source');
});

void test('forced migration removes legacy when requested', async () => {
    const testToken = 'test_pat_remove';
    await activateWithConfig({ token: testToken });
    const mod = await getExtensionModule();
    await (mod as any)._test_forceMigration(true);
    const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
    const legacyVal = cfg.get('token');
    const legacy = typeof legacyVal === 'string' ? legacyVal.trim() : legacyVal;
    assert.ok(!legacy, 'Legacy token should have been cleared');
    const info = await (mod as any)._test_readTokenInfo();
    assert.strictEqual(info.token, testToken, 'Secret storage value missing');
});

void test('setTokenSecure command stores token in secret storage and clears legacy', async () => {
    await Promise.resolve();
    const legacy = 'legacy_token_keep';
    await activateWithConfig({ token: legacy });
    const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
    await ext.activate();
    // simulate user input by stubbing showInputBox
    const orig = (vscode.window.showInputBox as any);
    (vscode.window.showInputBox as any) = () => Promise.resolve('new_secure_token_ABC');
    try {
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.setTokenSecure');
    } finally {
        (vscode.window.showInputBox as any) = orig;
    }
    const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
    const legacyAfterVal = cfg.get('token');
    const legacyAfter = typeof legacyAfterVal === 'string' ? legacyAfterVal.trim() : legacyAfterVal;
    assert.ok(!legacyAfter, 'Legacy token should be cleared by setTokenSecure');
    const mod = await getExtensionModule();
    const info = await (mod as any)._test_readTokenInfo();
    assert.strictEqual(info.token, 'new_secure_token_ABC');
    assert.strictEqual(info.source, 'secretStorage');
});

void test('clearTokenSecure command removes secure token', async () => {
    await Promise.resolve();
    const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
    await ext.activate();
    // first set token
    const orig = (vscode.window.showInputBox as any);
    (vscode.window.showInputBox as any) = () => Promise.resolve('temp_token_123');
    try {
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.setTokenSecure');
    } finally {
        (vscode.window.showInputBox as any) = orig;
    }
    // stub quick pick confirmation
    const origQP = (vscode.window.showQuickPick as any);
    (vscode.window.showQuickPick as any) = () => Promise.resolve('Yes, clear stored token');
    try {
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.clearTokenSecure');
    } finally {
        (vscode.window.showQuickPick as any) = origQP;
    }
    const mod = await getExtensionModule();
    const info = await (mod as any)._test_readTokenInfo();
    assert.ok(!info || !info.token, 'Token should be cleared');
});

void test('residual plaintext hint appears when secret and settings both have token', async () => {
    await Promise.resolve();
    const plain = 'plain_token_residual_123';
    await activateWithConfig({ token: plain });
    const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
    const api = await ext.activate();
    const extensionMod = await getExtensionModule();
    await (extensionMod as any)._test_forceMigration(false);
    // Poll for secret presence before proceeding to panel open (reduce flakiness)
    for (let i = 0; i < 20; i++) {
        const extensionMod = await getExtensionModule();
        const info1 = await (extensionMod as any)._test_readTokenInfo();
        if (info1.token === plain) break;
        await new Promise(r => setTimeout(r, 50));
    }
    await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
    api._test_resetPostedMessages();
    // Poll for migration hint up to ~1.2s
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
        api._test_invokeWebviewMessage({ type: 'getConfig' });
        await new Promise(r => setTimeout(r, 100));
        const msgs = api._test_getPostedMessages();
        found = msgs.some((m: any) => m.type === 'migrationHint' && (/Plaintext PAT remains/i.test(m.text || m.message || '') || /Clear Plaintext/i.test(m.buttonLabel || '')));
    }
    assert.ok(found, 'Expected residual plaintext migrationHint with Clear Plaintext action');
});
