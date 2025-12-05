import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

const DEFAULT_USAGE_FRACTION_DIGITS = 3;

/**
 * Normalize a numeric usage quantity by constraining it to a sane number of fractional digits.
 * Helps prevent floating point artifacts (e.g. 406.59000000000003) from leaking into the UI.
 */
export function normalizeUsageQuantity(value: unknown, fractionDigits = DEFAULT_USAGE_FRACTION_DIGITS): number {
    const num = Number(value);
    if (!isFinite(num)) {
        return 0;
    }
    const digits = Math.max(0, Math.min(10, Math.floor(fractionDigits)));
    const factor = Math.pow(10, digits);
    return Math.round(num * factor) / factor;
}

export type BillingUsageItem = {
    date: string;
    product: string; // e.g., 'Copilot', 'Actions'
    sku: string;
    quantity: number;
    unitType: string;
    pricePerUnit: number;
    grossAmount: number;
    discountAmount: number;
    netAmount: number;
    repositoryName?: string;
};

/**
 * Calculate the total included quantity from Copilot billing items.
 * Derives included units from discountAmount / pricePerUnit per item (guards against division by zero).
 * Rounds per-item included quantities to nearest whole unit since requests are integer counts.
 */
export function calculateIncludedQuantity(copilotItems: BillingUsageItem[]): number {
    return copilotItems.reduce((sum, i) => {
        const price = Number(i.pricePerUnit) || 0;
        const discount = Number(i.discountAmount) || 0;
        if (price <= 0) return sum;
        const included = Math.round(discount / price);
        return sum + included;
    }, 0);
}

export function computeIncludedOverageSummary(lastBilling: any, includedOverride?: number) {
    try {
        if (!lastBilling) return '';
        const total = normalizeUsageQuantity(lastBilling.totalQuantity);
        // Prefer an explicit included override (from selected plan or user-configured setting)
        // otherwise fall back to the billing-provided included quantity.
        const included = normalizeUsageQuantity(
            typeof includedOverride === 'number' ? includedOverride : lastBilling.totalIncludedQuantity
        );
        const overage = normalizeUsageQuantity(Math.max(0, total - included));
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
