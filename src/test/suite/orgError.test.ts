import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Org listing error', () => {
    test('configureOrg surfaces error path (forced)', async () => {
        process.env.CPUM_TEST_FORCE_ORG_ERROR = '1';
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id);
        assert.ok(ext, 'Extension not found');
        await ext.activate();
        // Execute command and ensure it does not throw (error handled internally)
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.configureOrg');
        // Nothing to assert directly (UI message). Just ensure extension still active.
        assert.strictEqual(ext.isActive, true, 'Extension should remain active after forced error');
    });
});
