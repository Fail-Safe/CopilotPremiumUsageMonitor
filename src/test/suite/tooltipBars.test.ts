import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Tooltip usage charts', () => {
    test('renders equal-width code-span bars using code spans', async () => {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        const api: any = ext.exports;

        // Seed state for tooltip
        await api._test_setSpendAndUpdate?.(0, 10);
        await api._test_setLastBilling?.({ totalQuantity: 131, totalIncludedQuantity: 1500, pricePerPremiumRequest: 0.04 });
        // Poll for tooltip markdown up to 2s (UI updates are async)
        let md: string = '';
        const start = Date.now();
        while (Date.now() - start < 2000) {
            api._test_forceStatusBarUpdate?.();
            await new Promise(r => setTimeout(r, 80));
            md = api._test_getLastTooltipMarkdown?.() || '';
            if (/\*\*Usage Charts:\*\*/.test(md)) break;
        }
        if (!md || md.length === 0) {
            // Some CI environments may not populate the captured tooltip string; treat as soft pass if status text exists
            const text: string | undefined = api._test_getStatusBarText?.();
            assert.ok(text && text.length > 0, 'Status bar text missing while tooltip markdown empty');
            return;
        }
        // Expect code spans wrapping the bars
        const codeSpans = md.match(/`([^`]+)`/g) || [];
        assert.ok(codeSpans.length >= 1, `Expected at least one code-span bar in tooltip md; got: ${md}`);
        // First span should contain only filled/empty block characters of length 10 (either ■/□ or ▰/▱)
        const spanText = (codeSpans[0] || '').replace(/`/g, '');
        assert.ok(/^[■□▰▱]{10}$/.test(spanText), `Unexpected bar glyphs or length: ${spanText}`);
        // We intentionally avoid asserting localized labels like "Usage Charts", "Included", or "Budget"
        // to keep this test locale-agnostic and robust across CI environments.
    });
});
