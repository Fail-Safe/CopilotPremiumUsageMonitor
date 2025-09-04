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
        const shownNumerator = Math.min(total, included);
        let summary = `Included Premium Requests: ${shownNumerator}/${included}`;
        if (overage > 0) {
            summary += ` • Overage: ${overage} (${(overage * price).toFixed(2)} USD)`;
        }
        return summary;
    } catch {
        return '';
    }
}

export default computeIncludedOverageSummary;
