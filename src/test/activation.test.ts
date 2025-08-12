import * as assert from 'assert';
import * as vscode from 'vscode';
import test from 'node:test';

test('activation creates status bar usage meter', async () => {
    const extId = 'fail-safe.copilot-premium-usage-monitor';
    const ext = vscode.extensions.getExtension(extId);
    assert.ok(ext, 'Extension not found');
    await ext!.activate();
    // VS Code API does not expose status bar items publicly; fallback heuristic: command is registered
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('copilotPremiumUsageMonitor.openPanel'), 'Expected command not registered after activation');
});
