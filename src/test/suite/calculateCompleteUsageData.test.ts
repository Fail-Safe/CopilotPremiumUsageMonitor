import * as assert from 'assert';
import * as vscode from 'vscode';

suite('calculateCompleteUsageData', () => {
    test('returns base data merged with usageHistory (trend, snapshots, dataSize)', async () => {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id);
        assert.ok(ext, 'Extension not found');
        await ext!.activate();
        const api: any = ext!.exports;

        // Ensure plan/included overrides are neutral so billing drives 'included'
        const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
        await cfg.update('selectedPlanId', '', vscode.ConfigurationTarget.Global);
        await cfg.update('includedPremiumRequests', 0, vscode.ConfigurationTarget.Global);

        // Seed base state and allow a brief settle to avoid cross-test races
        await api._test_setSpendAndUpdate?.(3, 10); // spend=3, budget=10
        await new Promise(r => setTimeout(r, 60));
        await api._test_setLastBilling?.({ totalQuantity: 100, totalIncludedQuantity: 200, pricePerPremiumRequest: 0.04 });

        // Stub usage history manager methods
        const mgr = api.getUsageHistoryManager?.();
        assert.ok(mgr, 'UsageHistoryManager not available');
        const original = {
            calculateTrend: mgr.calculateTrend?.bind(mgr),
            getRecentSnapshots: mgr.getRecentSnapshots?.bind(mgr),
            getDataSize: mgr.getDataSize?.bind(mgr)
        };
        try {
            mgr.calculateTrend = async () => ({
                hourlyRate: 5,
                dailyProjection: 120,
                weeklyProjection: 840,
                monthlyProjection: 3600,
                trend: 'increasing',
                confidence: 'high'
            });
            const now = Date.now();
            mgr.getRecentSnapshots = async (_hours: number = 48) => ([
                { timestamp: now - 3600_000, totalQuantity: 90, includedUsed: 50, spend: 2.0, included: 200 },
                { timestamp: now, totalQuantity: 100, includedUsed: 60, spend: 3.0, included: 200 }
            ]);
            mgr.getDataSize = async () => ({ snapshots: 2, estimatedKB: 0.5 });

            const data = await api.calculateCompleteUsageData?.();
            assert.ok(data, 'calculateCompleteUsageData returned null');
            // Base assertions
            assert.equal(data.budget, 10);
            assert.equal(data.spend, 3);
            assert.equal(data.budgetPct, 30);
            assert.equal(data.totalQuantity, 100);
            assert.equal(data.included, 200);
            assert.equal(data.includedUsed, 100); // equals totalQuantity (not capped by included)
            assert.equal(data.includedPct, 50);

            // History assertions
            assert.ok(data.usageHistory, 'usageHistory missing');
            assert.ok(data.usageHistory.trend, 'trend missing');
            assert.equal(data.usageHistory.trend.trend, 'increasing');
            assert.equal(data.usageHistory.trend.confidence, 'high');
            assert.ok(Array.isArray(data.usageHistory.recentSnapshots));
            assert.ok(data.usageHistory.recentSnapshots.length >= 2);
            assert.ok(data.usageHistory.dataSize);
            assert.equal(data.usageHistory.dataSize.snapshots, 2);
        } finally {
            // Restore originals to avoid side-effects across tests
            if (original.calculateTrend) mgr.calculateTrend = original.calculateTrend;
            if (original.getRecentSnapshots) mgr.getRecentSnapshots = original.getRecentSnapshots;
            if (original.getDataSize) mgr.getDataSize = original.getDataSize;
        }
    });
});
