import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Relative time focus interval', () => {
    const EXT_ID = 'fail-safe.copilot-premium-usage-monitor';

    async function activate(env: Record<string, string> = {}) {
        Object.assign(process.env, env);
        const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
        await ext.activate();
        return ext.exports;
    }

    test('focus change adjusts relative time ticker cadence (smoke)', async () => {
        const api = await activate({ CPUM_TEST_DISABLE_TIMERS: '1' }); // disable auto to control manually
        // Force start ticker manually by simulating focus transitions
        api._test_simulateWindowFocus?.(true); // should set to fast interval
        // There is no direct public read; rely on status bar updates timing by injecting timestamps and waiting.
        api._test_setLastSyncTimestamp(Date.now() - 30_000);
        api._test_forceStatusBarUpdate();
        // Simulate blur -> back to 30s then focus -> 10s; we just assert no throw and status text remains accessible.
        api._test_simulateWindowFocus?.(false);
        api._test_simulateWindowFocus?.(true);
        const text = api._test_getStatusBarText();
        assert.ok(text && /%/.test(text), 'Expected status bar text with percent');
    });
});
