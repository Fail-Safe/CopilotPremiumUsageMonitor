export type UsageCompleteData = {
    budget: number;
    spend: number;
    budgetPct: number;
    warnAt: number;
    dangerAt: number;
    progressColor: string;
    included: number;
    includedUsed: number;
    includedPct: number;
    usageHistory?: any | null;
};

export type LastBillingSnapshot = {
    pricePerPremiumRequest?: number;
} | undefined | null;

export type UsageViewModel = {
    // Budget
    budget: number;
    spend: number;
    budgetPct: number; // 0..100
    progressColor: string;
    warnAt: number;
    dangerAt: number;
    budgetColor: string;

    // Included usage
    included: number;
    includedUsed: number; // raw used (may exceed included)
    includedShown: number; // clamped for display: min(used, included)
    includedPct: number; // 0..100
    overageQty: number; // Math.max(0, used - included)
    overageCost?: number; // optional when price known
    includedColor: string;

    // Trends (optional)
    usageHistory?: any | null;
};

export function buildUsageViewModel(complete: UsageCompleteData, lastBilling?: LastBillingSnapshot): UsageViewModel {
    const included = Number(complete.included || 0);
    const used = Number(complete.includedUsed || 0);
    const shown = included > 0 ? Math.min(used, included) : 0;
    const pct = included > 0 ? Math.min(100, Math.max(0, Math.round((used / included) * 100))) : 0;
    const overageQty = Math.max(0, used - included);
    const price = lastBilling && typeof lastBilling.pricePerPremiumRequest === 'number' ? lastBilling.pricePerPremiumRequest : undefined;
    const overageCost = price !== undefined ? Number((overageQty * price).toFixed(2)) : undefined;
    const warn = Number(complete.warnAt || 0);
    const danger = Number(complete.dangerAt || 0);
    const budgetColor = thresholdColor(Number(complete.budgetPct || 0), warn, danger);
    const includedColor = thresholdColor(pct, warn, danger);

    return {
        budget: Number(complete.budget || 0),
        spend: Number(complete.spend || 0),
        budgetPct: Number(complete.budgetPct || 0),
        progressColor: complete.progressColor,
        warnAt: Number(complete.warnAt || 0),
        dangerAt: Number(complete.dangerAt || 0),
        budgetColor,
        included,
        includedUsed: used,
        includedShown: shown,
        includedPct: pct,
        overageQty,
        overageCost,
        includedColor,
        usageHistory: complete.usageHistory ?? null,
    };
}

export function thresholdColor(pct: number, warnAt: number, dangerAt: number, palette?: { ok: string; warn: string; danger: string; }): string {
    const pal = palette || { ok: '#2d7d46', warn: '#f0ad4e', danger: '#e51400' };
    if (typeof pct !== 'number' || !isFinite(pct)) return pal.ok;
    if (dangerAt > 0 && pct >= dangerAt) return pal.danger;
    if (warnAt > 0 && pct >= warnAt) return pal.warn;
    return pal.ok;
}
