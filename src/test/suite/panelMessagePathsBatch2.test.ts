import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Panel message paths batch2', () => {
    async function activate(): Promise<any> {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports;
    }

    test('help path increments help invocation counter', async () => {
        const api = await activate();
        const before = api._test_getHelpCount?.() || 0;
        api._test_closePanel?.();
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        await new Promise(r => setTimeout(r, 50));
        api._test_invokeWebviewMessage({ type: 'help' });
        await new Promise(r => setTimeout(r, 120));
        const after = api._test_getHelpCount?.();
        assert.ok(typeof after === 'number' && after === before + 1, `Expected help count to increment (before=${before}, after=${after})`);
        assert.ok(api._test_getLastHelpInvoked?.() > 0, 'Expected last help invoked timestamp set');
    });

    test('openSettings message triggers VS Code settings command', async () => {
        const api = await activate();
        const origExec = vscode.commands.executeCommand;
        let invoked = false;
        (vscode.commands as any).executeCommand = async (cmd: string, ...args: any[]) => {
            if (cmd === 'workbench.action.openSettings' && args[0] === 'copilotPremiumUsageMonitor') invoked = true;
            return origExec.apply(vscode.commands, [cmd, ...args]);
        };
        try {
            await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
            api._test_invokeWebviewMessage({ type: 'openSettings' });
            await new Promise(r => setTimeout(r, 80));
            assert.ok(invoked, 'Expected workbench.action.openSettings call');
        } finally {
            (vscode.commands as any).executeCommand = origExec;
        }
    });

    test('icon override warning replay on getConfig', async () => {
        const api = await activate();
        await api._test_setIconOverrideWarning('Icon override changed');
        api._test_resetPostedMessages();
        api._test_closePanel?.();
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        api._test_invokeWebviewMessage({ type: 'getConfig' });
        await new Promise(r => setTimeout(r, 180));
        const msgs = api._test_getPostedMessages();
        const warn = msgs.find((m: any) => m.type === 'iconOverrideWarning');
        assert.ok(warn && /override/i.test(warn.message), 'Expected icon override warning replay');
    });

    test('auto-refresh background quietly skips without token', async () => {
        const api = await activate();
        // Ensure no token and no session: token setting cleared
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', undefined, vscode.ConfigurationTarget.Global);
        // Force a quick restart to schedule timer then manually invoke internal function via interval id existence
        const baseline = api._test_getSpend();
        // Wait a short time (auto refresh immediate call may attempt sessionless skip)
        await new Promise(r => setTimeout(r, 150));
        const after = api._test_getSpend();
        // Spend should remain unchanged (undefined or same) because no token => skip
        if (baseline === undefined) {
            assert.strictEqual(after, undefined, 'Spend should remain unset without token');
        } else {
            assert.strictEqual(after, baseline, 'Spend should not change without token');
        }
    });
});
