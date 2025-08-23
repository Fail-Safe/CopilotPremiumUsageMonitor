import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Last attempt error classification', () => {
  const EXT_ID = 'fail-safe.copilot-premium-usage-monitor';
  async function activate(env: Record<string,string> = {}) {
    Object.assign(process.env, env);
    const ext = vscode.extensions.getExtension<any>(EXT_ID)!;
    await ext.activate();
    return ext.exports;
  }

  test('Adds network error classification to Last attempt line when no prior success', async () => {
    const api = await activate({ CPUM_TEST_DISABLE_TIMERS: '1' });
  // Reset any prior error state from earlier tests
  await api._test_clearLastError();
  // Ensure no prior success
  await api._test_setLastSyncTimestamp(0 as any); // clear success marker (falsy -> treated as no success)
  const now = Date.now() - 60_000; // ensure some relative time
  await api._test_setLastSyncAttempt(now);
    await api._test_setLastError('Network error: Unable to reach GitHub.');
    api._test_forceStatusBarUpdate();
  await new Promise(r => setTimeout(r, 250));
  const meta = api._test_getAttemptMeta?.();
  assert.ok(meta?.show, 'Attempt meta should indicate show=true when no prior success');
  const md = api._test_getLastTooltipMarkdown?.() || '';
  // Tooltip capture is optional; assert classification via meta for determinism
  if (!/network error/i.test(meta?.classificationText || '')) {
    // eslint-disable-next-line no-console
    console.log('DEBUG meta after network error set:', meta, 'rawErr=', meta?.err);
  }
  assert.ok(/network error/i.test(meta?.classificationText || ''), 'Expected network error classification in meta');
  });
});
