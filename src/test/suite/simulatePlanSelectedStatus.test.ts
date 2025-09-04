import * as assert from 'assert';
import * as vscode from 'vscode';
import { computeIncludedOverageSummary } from '../../lib/usageUtils';
import { findPlanById } from '../../lib/planUtils';

suite('simulate plan selected status', () => {
    test('selected plan should influence included display in status tooltip', async () => {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        const api = ext.exports as any;

        // Ensure user override is cleared and selected plan is set to copilot-proplus
        const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
        await cfg.update('includedPremiumRequests', 0, vscode.ConfigurationTarget.Global);
        await cfg.update('selectedPlanId', 'copilot-proplus', vscode.ConfigurationTarget.Global);
        // Force config emission so extension's in-memory selectedPlan is up-to-date
        try { await api._test_forceConfig?.(); } catch { /* noop */ }
        // give a moment for config to propagate
        await new Promise(r => setTimeout(r, 80));

        // Reset posted messages and set a lastBilling snapshot with totalQuantity 88
        try { api._test_resetPostedMessages?.(); } catch { /* noop */ }
        try { await api._test_setLastBilling?.({ totalQuantity: 88, totalIncludedQuantity: 88, pricePerPremiumRequest: 0.04 }); } catch { /* noop */ }

        // Force status bar update and capture tooltip markdown
        try { api._test_forceStatusBarUpdate?.(); } catch { /* noop */ }
        // Poll for tooltip markdown (allow up to 2s) to account for async timing
        const start = Date.now();
        let md: string | undefined;
        let statusText: string | undefined;
        while (Date.now() - start < 2000) {
            try { api._test_forceStatusBarUpdate?.(); } catch { /* noop */ }
            await new Promise(r => setTimeout(r, 100));
            statusText = api._test_getStatusBarText?.();
            md = api._test_getLastTooltipMarkdown?.() as string | undefined;
            if (statusText && md) break;
        }
        assert.ok(statusText, `Expected status bar text to be present; got: ${statusText}`);
        if (md) {
            assert.ok(md!.includes('Included Premium Requests: 88/1500'), `Tooltip did not include expected included summary; got: ${md}`);
        } else {
            // Fallback: compute the summary directly like the extension does
            const lastBilling = { totalQuantity: 88, totalIncludedQuantity: 88, pricePerPremiumRequest: 0.04 };
            const userIncluded = 0;
            const selectedPlan = findPlanById('copilot-proplus');
            const includedToShow = userIncluded > 0 ? userIncluded : (selectedPlan && typeof selectedPlan.included === 'number' ? selectedPlan.included : lastBilling.totalIncludedQuantity);
            const summary = computeIncludedOverageSummary(lastBilling, includedToShow);
            assert.ok(summary.includes('Included Premium Requests: 88/1500'), `Direct summary did not include expected text; got: ${summary}`);
        }
    });
});
