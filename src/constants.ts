// Centralized default threshold values for warn and danger usage percentages.
// Dynamically read from the extension manifest (package.json) so the manifest is the single source of truth.
// Falls back to legacy values if manifest lookup fails (e.g., during certain test harness scenarios).
import * as vscode from 'vscode';

function readDefault(key: string, fallback: number): number {
    try {
        // Extension ID is <publisher>.<name>
        const ext = vscode.extensions.getExtension('fail-safe.copilot-premium-usage-monitor');
        const props = (ext?.packageJSON?.contributes?.configuration?.properties) || {};
        const node = (props)[key];
        const val = node?.default;
        const n = Number(val);
        return Number.isFinite(n) ? n : fallback;
    } catch {
        return fallback; // Safety in tests / early load
    }
}

export const DEFAULT_WARN_AT_PERCENT = readDefault('copilotPremiumUsageMonitor.warnAtPercent', 75);
export const DEFAULT_DANGER_AT_PERCENT = readDefault('copilotPremiumUsageMonitor.dangerAtPercent', 90);
// Recent data window for usage history analysis (in hours)
export const RECENT_DATA_WINDOW_HOURS = 48;
// Threshold for determining stable vs. changing usage trends (10% of hourly rate)
export const STABILITY_THRESHOLD = 0.1;
