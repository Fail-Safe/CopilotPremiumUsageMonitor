import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { loadGeneratedPlans } from '../../lib/planUtils';

suite('Plan selection persistence', () => {
    async function activate(): Promise<any> {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports;
    }

    test('planSelected message persists selectedPlanId and appears in config', async () => {
        const api = await activate();
        // Prepare a temporary generated plans file so tests are deterministic.
        const generatedDir = path.join(process.cwd(), 'media', 'generated');
        const generatedPath = path.join(generatedDir, 'copilot-plans.json');
        let originalRaw: string | null = null;
        try {
            if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true });
            if (fs.existsSync(generatedPath)) originalRaw = fs.readFileSync(generatedPath, 'utf8');
            const fake = {
                sourceUrl: 'test://local',
                fetchedAt: new Date().toISOString(),
                pricePerPremiumRequest: 0.042,
                plans: [{ id: 'copilot-pro', name: 'Copilot Pro', included: 300 }]
            };
            fs.writeFileSync(generatedPath, JSON.stringify(fake), 'utf8');

            // Ensure no selectedPlanId initially
            await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('selectedPlanId', '', vscode.ConfigurationTarget.Global);
            // Reset posted messages capture
            try { api._test_resetPostedMessages(); } catch { }
            // Simulate webview message handler invocation for planSelected
            const testPlanId = 'copilot-pro';
            // Invoke message handler directly
            try { (api as any)._test_invokeWebviewMessage?.({ type: 'planSelected', planId: testPlanId }); } catch { }
            // Wait briefly for async config write
            await new Promise(r => setTimeout(r, 160));
            const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
            const stored = cfg.get('selectedPlanId');
            assert.strictEqual(stored, testPlanId, 'selectedPlanId should be persisted to settings');

            // Ensure pricePerPremiumRequest was populated when default present; includedPremiumRequests remains 0 (use plan/billing)
            const gen = loadGeneratedPlans();
            const plan = gen?.plans.find(p => p.id === testPlanId) as any;
            // If generated plans are not available tests should still be robust; skip stricter checks then
            if (plan) {
                const included = Number(cfg.get('includedPremiumRequests') ?? 0) || 0;
                const price = Number(cfg.get('pricePerPremiumRequest') ?? 0.04) || 0.04;
                // New behavior: selecting a plan does NOT write included into the override; 0 means "use plan/billing".
                assert.strictEqual(included, 0, 'includedPremiumRequests should remain 0 unless user overrides');
                if (typeof gen?.pricePerPremiumRequest === 'number') {
                    assert.strictEqual(price, gen!.pricePerPremiumRequest, 'pricePerPremiumRequest should be populated from generated file when default');
                }
            }

            // Now trigger a fresh config emission and assert the posted config contains the selectedPlanId
            try { api._test_forceConfig?.(); } catch { }
            // Wait for posted messages
            await new Promise(r => setTimeout(r, 120));
            const posts = api._test_getPostedMessages?.() || [];
            const cfgMsg = posts.find((p: any) => p.type === 'config');
            assert.ok(cfgMsg && cfgMsg.config && cfgMsg.config.selectedPlanId === testPlanId, 'Config message should include selectedPlanId');
        } finally {
            // restore original generated file if present, otherwise remove the temp file
            try {
                if (originalRaw !== null) fs.writeFileSync(generatedPath, originalRaw, 'utf8');
                else if (fs.existsSync(generatedPath)) fs.unlinkSync(generatedPath);
            } catch { /* best-effort cleanup */ }
        }
    });
});
