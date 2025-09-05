import * as vscode from 'vscode';
import { formatRelativeTime } from './lib/format';
import { performAutoRefresh, getUsageHistoryManager, calculateCompleteUsageData } from './extension';
import { findPlanById } from './lib/planUtils';

export class CopilotUsageSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'copilotPremiumUsage.sidebarView';

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.type) {
                case 'refresh':
                    // Show refreshing state
                    webviewView.webview.postMessage({ type: 'refreshing' });

                    // Trigger a data refresh and update the sidebar
                    performAutoRefresh().then(() => {
                        this.updateView(webviewView);
                        // Show success feedback
                        webviewView.webview.postMessage({ type: 'refreshComplete', success: true });
                    }).catch(() => {
                        // Even if refresh fails, update the view to show current state
                        this.updateView(webviewView);
                        // Show failure feedback
                        webviewView.webview.postMessage({ type: 'refreshComplete', success: false });
                    });
                    break;
                case 'openPanel':
                    vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'copilotPremiumUsageMonitor');
                    break;
            }
        });

        // Update with current data
        this.updateView(webviewView);

        // Update when view is shown again after being hidden/collapsed
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                // Push a quick status message so UI feels alive
                webviewView.webview.postMessage({ type: 'refreshing' });
                // Try a background refresh, then update the view with latest data
                void performAutoRefresh().finally(() => {
                    void this.updateView(webviewView).then(() => {
                        webviewView.webview.postMessage({ type: 'refreshComplete', success: true });
                    });
                });
            }
        });

        // Listen for configuration changes to update the view
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('copilotPremiumUsageMonitor')) {
                this.updateView(webviewView);
            }
        });
    }

    private async updateView(webviewView: vscode.WebviewView) {
        // Use centralized data calculation to ensure consistency with trends
        const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
        const trendsEnabled = !!cfg.get('enableExperimentalTrends');
        const completeData = await calculateCompleteUsageData();
        if (!completeData) return;

        const { budget, spend, budgetPct: percentage, progressColor, warnAt, dangerAt,
            included, includedUsed, usageHistory } = completeData;

        const config = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
        const mode = config.get<string>('mode', 'auto');
        const org = config.get<string>('org', '');

        // Determine effective mode for display
        const effectiveMode = mode === 'auto' ? (org ? 'Organization' : 'Personal') :
            mode === 'org' ? 'Organization' : 'Personal';

        // Check if a specific plan is selected and modify the mode display accordingly
        const selectedPlanId = config.get<string>('selectedPlanId', '');
        const customIncluded = Number(config.get('includedPremiumRequests', 0)) > 0;
        let modeDisplay = `${effectiveMode} Mode`;

        // Show plan name only when no custom included override is active
        if (selectedPlanId && !customIncluded) {
            const plan = findPlanById(selectedPlanId);
            const planDisplayName = plan?.name || selectedPlanId; // Fallback to ID if name not found
            modeDisplay = `${effectiveMode} Mode: ${planDisplayName}`;
        }

        // Get last sync info
        const lastSync = this.context.globalState.get('copilotPremiumUsageMonitor.lastSyncTimestamp') as number ?? 0;
        const lastSyncText = lastSync > 0 ? formatRelativeTime(lastSync) : 'Never';

        // Extract trend data from centralized calculation
        const trendData = (trendsEnabled ? usageHistory?.trend : null) || null;

        // Debug: Log trend data for sidebar
        if (trendData) {
            console.log('Sidebar trend data:', {
                hourlyRate: trendData.hourlyRate,
                dailyProjection: trendData.dailyProjection,
                weeklyProjection: trendData.weeklyProjection,
                trend: trendData.trend,
                confidence: trendData.confidence
            });
        }

        webviewView.webview.postMessage({
            type: 'update',
            data: {
                budget: budget.toFixed(2),
                spend: spend.toFixed(2),
                percentage,
                progressColor,
                lastSync: lastSyncText,
                mode: modeDisplay,
                included,
                // Use actual used count for display (can exceed included), percent will be clamped below
                includedUsed: Math.min(includedUsed, included),
                trend: trendData,
                thresholds: {
                    warn: warnAt,
                    danger: dangerAt
                }
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Copilot Usage</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background-color: var(--vscode-sideBar-background);
			margin: 0;
			padding: 16px;
		}

		.usage-container {
			display: flex;
			flex-direction: column;
			gap: 16px;
		}

		.chart-section {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 8px;
			margin-bottom: 16px;
		}

		.chart-title {
			font-size: 12px;
			font-weight: 600;
			color: var(--vscode-foreground);
			margin: 0 0 8px 0;
			text-align: center;
		}

		.donut-chart {
			position: relative;
			width: 180px;
			height: 180px;
		}

		.donut-svg {
			width: 100%;
			height: 100%;
			transform: rotate(-90deg);
		}

		.donut-center {
			position: absolute;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			text-align: center;
		}

		.donut-percentage {
			font-size: 24px;
			font-weight: 600;
			line-height: 1;
		}

		.donut-label {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		.donut-sublabel {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			margin-top: 2px;
		}

		.legend {
			display: flex;
			justify-content: center;
			gap: 16px;
			flex-wrap: wrap;
		}

		.legend-item {
			display: flex;
			align-items: center;
			gap: 4px;
			font-size: 11px;
		}

		.legend-color {
			width: 12px;
			height: 12px;
			border-radius: 50%;
		}

		.stat-grid {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 8px;
		}

		.stat-card {
			background: var(--vscode-sideBar-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			padding: 8px;
			text-align: center;
		}

		.stat-value {
			font-weight: 600;
			font-size: 14px;
		}

		.stat-label {
			font-size: 10px;
			color: var(--vscode-descriptionForeground);
			margin-top: 2px;
		}

		.trend-indicator {
			display: inline-flex;
			align-items: center;
			gap: 2px;
			font-size: 10px;
		}

		.trend-up { color: #e51400; }
		.trend-down { color: #2d7d46; }
		.trend-stable { color: var(--vscode-descriptionForeground); }

		.quick-actions {
			display: flex;
			gap: 8px;
		}

		.action-btn {
			flex: 1;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none;
			padding: 6px;
			border-radius: 2px;
			cursor: pointer;
			font-size: 11px;
		}

		.action-btn:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}

		.mode-indicator {
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			font-size: 10px;
			padding: 2px 6px;
			border-radius: 10px;
			text-align: center;
		}

		.threshold-warning {
			background: var(--vscode-inputValidation-warningBackground);
			color: var(--vscode-inputValidation-warningForeground);
			border: 1px solid var(--vscode-inputValidation-warningBorder);
			padding: 6px;
			border-radius: 4px;
			font-size: 11px;
			margin: 8px 0;
		}

		.usage-trend {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
			padding: 8px;
			margin: 8px 0;
		}

		.trend-title {
			font-size: 11px;
			font-weight: 600;
			margin-bottom: 4px;
			color: var(--vscode-foreground);
		}

		.trend-info {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-bottom: 6px;
		}

		.trend-rate {
			font-size: 12px;
			font-weight: 500;
		}

		.trend-projections {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.projection-item {
			display: flex;
			justify-content: space-between;
			font-size: 10px;
		}

		.projection-label {
			color: var(--vscode-descriptionForeground);
		}

		.projection-value {
			font-weight: 500;
		}		.last-sync {
			font-size: 10px;
			color: var(--vscode-descriptionForeground);
			text-align: center;
			margin-top: 8px;
		}
	</style>
</head>
<body>
	<div class="usage-container">
		<!-- Mode indicator -->
		<div class="mode-indicator" id="mode-indicator">Personal Mode</div>

		<!-- First Chart: Included Requests Usage -->
		<div class="chart-section">
			<h3 class="chart-title">Included Requests</h3>
			<div class="donut-chart">
				<svg class="donut-svg" viewBox="0 0 42 42">
					<!-- Background circle -->
					<circle cx="21" cy="21" r="15.5" fill="transparent" stroke="var(--vscode-progressBar-background)" stroke-width="3"></circle>
					<!-- Progress circle for included requests -->
					<circle id="included-circle" cx="21" cy="21" r="15.5" fill="transparent" stroke="#2d7d46" stroke-width="3"
							stroke-dasharray="0 97.4" stroke-linecap="round"></circle>
				</svg>
				<div class="donut-center">
					<div class="donut-percentage" id="included-percentage">0%</div>
					<div class="donut-label">Used</div>
					<div class="donut-sublabel" id="included-count">0/0</div>
				</div>
			</div>
		</div>

		<!-- Second Chart: Budget Usage -->
		<div class="chart-section">
			<h3 class="chart-title">Budget Usage</h3>
			<div class="donut-chart">
				<svg class="donut-svg" viewBox="0 0 42 42">
					<!-- Background circle -->
					<circle cx="21" cy="21" r="15.5" fill="transparent" stroke="var(--vscode-progressBar-background)" stroke-width="3"></circle>
					<!-- Progress circle for budget -->
					<circle id="budget-circle" cx="21" cy="21" r="15.5" fill="transparent" stroke="#f0ad4e" stroke-width="3"
							stroke-dasharray="0 97.4" stroke-linecap="round"></circle>
				</svg>
				<div class="donut-center">
					<div class="donut-percentage" id="budget-percentage">0%</div>
					<div class="donut-label">Spent</div>
					<div class="donut-sublabel" id="budget-amount">$0/$0</div>
				</div>
			</div>
		</div>

		<!-- Stats Grid -->
		<div class="stat-grid">
			<div class="stat-card">
				<div class="stat-value" id="included-requests-value">0</div>
				<div class="stat-label">Included Used</div>
			</div>
			<div class="stat-card">
				<div class="stat-value" id="budget-remaining-value">$0.00</div>
				<div class="stat-label">Budget Left</div>
			</div>
		</div>

		<!-- Usage Trend -->
		<div class="usage-trend" id="usage-trend" style="display: none;">
			<div class="trend-title">Usage Trend</div>
			<div class="trend-info">
				<div class="trend-rate" id="trend-rate">0 req/hr</div>
				<div class="trend-indicator" id="trend-direction"></div>
			</div>
			<div class="trend-projections">
				<div class="projection-item">
					<span class="projection-label">Daily:</span>
					<span class="projection-value" id="daily-projection">0</span>
				</div>
				<div class="projection-item">
					<span class="projection-label">Weekly:</span>
					<span class="projection-value" id="weekly-projection">0</span>
				</div>
			</div>
		</div>

		<!-- Threshold Warning -->
		<div class="threshold-warning" id="threshold-warning" style="display: none;">
			⚠️ Approaching budget limit
		</div>

		<!-- Quick Actions -->
		<div class="quick-actions">
			<button class="action-btn" id="refresh-btn">↻ Refresh</button>
			<button class="action-btn" id="panel-btn">📊 Details</button>
		</div>

		<div class="last-sync" id="last-sync">Last sync: Never</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();

		function renderUpdate(data) {
			const { budget, spend, percentage, progressColor, lastSync, mode, included, includedUsed, trend, thresholds, view } = data;

			// Calculate included requests usage
			const spendValue = parseFloat(spend);
			const budgetValue = parseFloat(budget);
			const includedTotal = (view?.included ?? included) || 0;
			const includedUsedValue = (view?.includedUsed ?? includedUsed) || 0;

			// For included requests: use the passed includedUsed value from extension
			const includedPercentage = typeof view?.includedPct === 'number'
				? Math.max(0, Math.min(100, Math.round(view.includedPct)))
				: (includedTotal > 0 ? Math.min(100, Math.round((includedUsedValue / includedTotal) * 100)) : 0);

			// Update values (clamp numerator for display so it never exceeds denominator)
			const includedShownValue = typeof view?.includedShown === 'number' ? view.includedShown : Math.min(includedUsedValue, includedTotal);
			document.getElementById('included-requests-value').textContent = includedShownValue.toString();
			document.getElementById('budget-remaining-value').textContent = '$' + (budgetValue - spendValue).toFixed(2);
			document.getElementById('last-sync').textContent = 'Last sync: ' + lastSync;
			document.getElementById('mode-indicator').textContent = mode || 'Auto Mode';

			// Update both donut charts (pass clamped numerator for label)
			updateDonutChart(percentage, includedPercentage, spendValue.toFixed(2), budgetValue.toFixed(2), includedShownValue, includedTotal);

			// Update threshold warning - only show if budget is set, percentage is meaningful, and warnings are enabled (warnAt > 0)
			const warning = document.getElementById('threshold-warning');
			if (thresholds && budgetValue > 0 && thresholds.warn > 0 && percentage >= thresholds.warn) {
				warning.style.display = 'block';
				warning.textContent = percentage >= thresholds.danger ?
					'🚨 Budget limit exceeded!' :
					'⚠️ Approaching budget limit';
			} else {
				warning.style.display = 'none';
			}

			// Update trend section
			const trendSection = document.getElementById('usage-trend');
			if (trend && trend.hourlyRate !== undefined) {
				trendSection.style.display = 'block';

				// Format hourly rate
				const hourlyRate = trend.hourlyRate.toFixed(1);
				document.getElementById('trend-rate').textContent = hourlyRate + ' req/hr';

				// Update trend direction indicator
				const directionElement = document.getElementById('trend-direction');
				if (trend.trend === 'increasing') {
					directionElement.className = 'trend-indicator trend-up';
					directionElement.innerHTML = '<span>↗</span> Increasing';
				} else if (trend.trend === 'decreasing') {
					directionElement.className = 'trend-indicator trend-down';
					directionElement.innerHTML = '<span>↘</span> Decreasing';
				} else {
					directionElement.className = 'trend-indicator trend-stable';
					directionElement.innerHTML = '<span>→</span> Stable';
				}

				// Update projections
				document.getElementById('daily-projection').textContent = Math.round(trend.dailyProjection) + ' req';
				document.getElementById('weekly-projection').textContent = Math.round(trend.weeklyProjection) + ' req';
			} else {
				trendSection.style.display = 'none';
			}
		}

		// Restore last known state immediately on load (fast UI)
		try {
			const saved = vscode.getState();
			if (saved && saved.data) {
				renderUpdate(saved.data);
			}
		} catch (e) {
			// ignore state restore errors
		}

		function updateDonutChart(budgetPercentage, includedPercentage, budgetSpent, budgetTotal, includedUsed, includedTotal) {
			const circumference = 97.4; // 2 * π * 15.5

			// Update included requests chart
			const includedOffset = circumference - (includedPercentage / 100) * circumference;
			document.getElementById('included-circle').style.strokeDasharray =
				\`\${circumference - includedOffset} \${includedOffset}\`;
			document.getElementById('included-percentage').textContent = \`\${includedPercentage}%\`;
			document.getElementById('included-count').textContent = \`\${includedUsed}/\${includedTotal}\`;

			// Update budget chart
			const budgetOffset = circumference - (budgetPercentage / 100) * circumference;
			document.getElementById('budget-circle').style.strokeDasharray =
				\`\${circumference - budgetOffset} \${budgetOffset}\`;
			document.getElementById('budget-percentage').textContent = \`\${budgetPercentage}%\`;
			document.getElementById('budget-amount').textContent = \`$\${budgetSpent}/$\${budgetTotal}\`;

			// Update colors based on centralized threshold palette (fallback to legacy if not provided)
			const includedColor = (view && view.includedColor) ? view.includedColor : (includedPercentage >= 90 ? '#e51400' : includedPercentage >= 75 ? '#f0ad4e' : '#2d7d46');
			const budgetColor = (view && view.budgetColor) ? view.budgetColor : (budgetPercentage >= 90 ? '#e51400' : budgetPercentage >= 75 ? '#f0ad4e' : '#f0ad4e');

			document.getElementById('included-circle').style.stroke = includedColor;
			document.getElementById('budget-circle').style.stroke = budgetColor;
		}

		window.addEventListener('message', event => {
			const message = event.data;

			if (message.type === 'refreshing') {
				// Update refresh button to show loading state
				const refreshBtn = document.getElementById('refresh-btn');
				refreshBtn.textContent = '⟳ Refreshing...';
				refreshBtn.disabled = true;
			} else if (message.type === 'refreshComplete') {
				// Update refresh button to show completion state
				const refreshBtn = document.getElementById('refresh-btn');
				refreshBtn.disabled = false;

				if (message.success) {
					refreshBtn.textContent = '✓ Synced';
					// Reset to original text after 2 seconds
					setTimeout(() => {
						refreshBtn.textContent = '↻ Refresh';
					}, 2000);
				} else {
					refreshBtn.textContent = '✗ Failed';
					// Reset to original text after 2 seconds
					setTimeout(() => {
						refreshBtn.textContent = '↻ Refresh';
					}, 2000);
				}
			} else if (message.type === 'update') {
				renderUpdate(message.data);
				try { vscode.setState({ data: message.data }); } catch (e) { /* ignore */ }
			}
		});

		// Event listeners
		document.getElementById('refresh-btn').addEventListener('click', () => {
			vscode.postMessage({ type: 'refresh' });
		});

		document.getElementById('panel-btn').addEventListener('click', () => {
			vscode.postMessage({ type: 'openPanel' });
		});
	</script>
</body>
</html>`;
    }
}
