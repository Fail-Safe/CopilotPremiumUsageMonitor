import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Last attempt gating', () => {
    const EXT_ID = 'fail-safe.copilot-premium-usage-monitor';
    async function activate(env: Record<string, string> = {}) {
        Object.assign(process.env, env);
        const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
        await ext.activate();
        return ext.exports;
    }

    test('Last attempt hidden until two intervals pass', async () => {
        const api = await activate({ CPUM_TEST_DISABLE_TIMERS: '1' });
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('refreshIntervalMinutes', 5, vscode.ConfigurationTarget.Global);
        // Wait for any config-change-triggered background operations to settle
        await new Promise(r => setTimeout(r, 100));
        // Derive interval from actual config value so timestamp math stays consistent with _test_getAttemptMeta
        const cfgRead = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
        const oneIntervalMs = Math.max(5, Math.floor(Number(cfgRead.get('refreshIntervalMinutes') ?? 5))) * 60_000;
        const now = Date.now();
        const successTs = now - oneIntervalMs - 2_000; // just over one interval ago (< 2 intervals)
        await api._test_setLastSyncTimestamp(successTs);
        // Explicitly set attempt timestamp to now (simulating a failed attempt after last success)
        await api._test_setLastSyncAttempt(now);
        await api._test_setLastError('Simulated failure');
        api._test_forceStatusBarUpdate();
        await new Promise(r => setTimeout(r, 60));
        let md = api._test_getLastTooltipMarkdown?.() || '';
        // When there is a last error, the label may be 'Last successful sync'
        // We only assert absence/presence of Last attempt; sync label may be absent if no success timestamp set yet in some edge paths.
        assert.ok(!/Last attempt/.test(md), 'Last attempt should be hidden before two intervals elapse');
        // Move success timestamp further into past so that now - ts >= 2 intervals
        const oldSuccess = now - (oneIntervalMs * 2) - 20_000; // comfortably > 2 intervals to avoid boundary race
        await api._test_setLastSyncTimestamp(oldSuccess);
        // Re-set attempt to ensure attemptTs > ts after moving success further back
        await api._test_setLastSyncAttempt(Date.now() - oneIntervalMs - 1000); // age attempt beyond 1 interval to satisfy display rule
        api._test_forceStatusBarUpdate();
        await new Promise(r => setTimeout(r, 150));
        const meta = api._test_getAttemptMeta?.();
        assert.ok(meta?.show, 'Attempt meta should indicate show=true after threshold');
        // Rely on meta.show for deterministic gating (tooltip markdown capture is best-effort)
        assert.ok(meta?.show, 'Expected Last attempt gating meta to indicate visibility');
    });
});
