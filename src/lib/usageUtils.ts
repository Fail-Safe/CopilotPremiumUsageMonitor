import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

export function computeIncludedOverageSummary(lastBilling: any, includedOverride?: number) {
    try {
        if (!lastBilling) return '';
        const total = Number(lastBilling.totalQuantity || 0);
        // Prefer an explicit included override (from selected plan or user-configured setting)
        // otherwise fall back to the billing-provided included quantity.
        const included = typeof includedOverride === 'number' ? Number(includedOverride) : Number(lastBilling.totalIncludedQuantity || 0) || 0;
        const overage = Math.max(0, total - included);
        const price = Number(lastBilling.pricePerPremiumRequest || 0.04) || 0.04;
        // Use GitHub nomenclature.
        const includedLabel = localize('cpum.statusbar.included', 'Included Premium Requests');
        const pct = included > 0 ? Math.min(100, Math.round((total / included) * 100)) : 0;
        // Show used/included to match tooltip expectations (e.g., 88/1500)
        const main = included > 0 ? `${total}/${included}` : `${included}`;
        let summary = `${includedLabel}: ${main}` + (included > 0 ? ` (${pct}%)` : '');
        if (overage > 0) {
            const overageLabel = localize('cpum.statusbar.overage', 'Overage');
            summary += ` • ${overageLabel}: ${overage} ($${(overage * price).toFixed(2)} USD)`;
        }
        return summary;
    } catch {
        return '';
    }
}

export default computeIncludedOverageSummary;
