import * as vscode from 'vscode';
// Octokit will be loaded lazily to reduce activation overhead
import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();

// Lazy Octokit cache
type OctokitModule = typeof import('@octokit/rest');
let _octokitModule: OctokitModule | undefined;
async function getOctokit(auth?: string) {
	if (!_octokitModule) {
		_octokitModule = await import('@octokit/rest');
	}
	const { Octokit } = _octokitModule;
	return new Octokit({ auth, request: { headers: { 'X-GitHub-Api-Version': '2022-11-28' } } });
}

export function activate(context: vscode.ExtensionContext) {
	// Make context available for status bar updates
	extCtx = context;
	// Always initialize and show status bar meter
	initStatusBar(context);
	updateStatusBar();
	statusItem?.show();
	const openPanel = vscode.commands.registerCommand('copilotPremiumUsageMonitor.openPanel', () => {
		UsagePanel.createOrShow(context);
	});

	const signIn = vscode.commands.registerCommand('copilotPremiumUsageMonitor.signIn', async () => {
		await UsagePanel.ensureGitHubSession();
		vscode.window.showInformationMessage('GitHub sign-in completed (if required).');
	});

	const configureOrg = vscode.commands.registerCommand('copilotPremiumUsageMonitor.configureOrg', async () => {
		const token = await getGitHubToken();
		if (!token) {
			vscode.window.showInformationMessage('Sign in to GitHub or set a token in settings first.');
			return;
		}
		try {
			const octokit = await getOctokit(token);
			const orgs = await octokit.paginate('GET /user/orgs', { per_page: 100 });
			if (!orgs.length) {
				vscode.window.showInformationMessage('No organizations found for your account.');
				return;
			}
			const pick = await vscode.window.showQuickPick(orgs.map((o: any) => ({ label: o.login as string, description: o.description || '' })), { placeHolder: 'Select an organization' });
			if (pick && typeof pick.label === 'string') {
				await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('org', pick.label, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage(`Organization set to ${pick.label}`);
			}
		} catch (e: any) {
			vscode.window.showErrorMessage(`Failed to list organizations: ${e?.message ?? e}`);
			maybeAutoOpenLog();
		}
	});

	context.subscriptions.push(openPanel, signIn, configureOrg);

	const manage = vscode.commands.registerCommand('copilotPremiumUsageMonitor.manage', async () => {
		try {
			await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:fail-safe.copilot-premium-usage-monitor copilotPremiumUsageMonitor');
		} catch {
			await vscode.commands.executeCommand('workbench.action.openSettings', 'copilotPremiumUsageMonitor');
		}
	});
	context.subscriptions.push(manage);

	const showLogs = vscode.commands.registerCommand('copilotPremiumUsageMonitor.showLogs', () => {
		const log = getLog();
		log.show(true);
		log.appendLine('[User] Opened log channel');
	});
	context.subscriptions.push(showLogs);

	const enableFirstRun = vscode.commands.registerCommand('copilotPremiumUsageMonitor.enableFirstRunNotice', async () => {
		await context.globalState.update('copilotPremiumUsageMonitor.firstRunDisabled', false);
		await context.globalState.update('copilotPremiumUsageMonitor.firstRunShown', false);
		await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('disableFirstRunTips', false, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(localize('cpum.enableFirstRun.restored', 'Help banner will show again next time you open the panel.'));
	});

	context.subscriptions.push(enableFirstRun);

	// Init status bar meter
	initStatusBar(context);
	updateStatusBar();

	// Sidebar removed in v0.2.0

	// React to budget changes
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (
			e.affectsConfiguration('copilotPremiumUsageMonitor.budget') ||
			e.affectsConfiguration('copilotPremiumUsageMonitor.mode') ||
			e.affectsConfiguration('copilotPremiumUsageMonitor.org') ||
			e.affectsConfiguration('copilotPremiumUsageMonitor.warnAtPercent') ||
			e.affectsConfiguration('copilotPremiumUsageMonitor.dangerAtPercent')
		) {
			updateStatusBar();
		}
		if (e.affectsConfiguration('copilotPremiumUsageMonitor.refreshIntervalMinutes')) {
			restartAutoRefresh();
		}
		if (e.affectsConfiguration('copilotPremiumUsageMonitor.statusBarAlignment')) {
			initStatusBar(context); // recreate with new alignment
			updateStatusBar();
		}
	}));

	// Start auto-refresh
	startAutoRefresh();
	startRelativeTimeTicker();
}
// applySidebarContext removed with sidebar feature.

export function deactivate() {
	stopRelativeTimeTicker();
}

class UsagePanel {
	public static currentPanel: UsagePanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private readonly globalState: vscode.Memento;
	private disposables: vscode.Disposable[] = [];
	private static _session: vscode.AuthenticationSession | undefined;

	static async ensureGitHubSession(): Promise<vscode.AuthenticationSession | undefined> {
		// Use token from settings first if provided
		const cfgNew = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
		const token = (cfgNew.get('token') as string | undefined)?.trim();
		if (token) {
			return undefined; // direct token usage, no session required
		}
		// Otherwise, request a GitHub auth session
		try {
			// Request only scopes needed for org metrics
			this._session = await vscode.authentication.getSession('github', ['read:org'], { createIfNone: true });
			return this._session;
		} catch (err) {
			vscode.window.showErrorMessage('GitHub sign-in failed or was cancelled.');
			maybeAutoOpenLog();
			return undefined;
		}
	}

	static createOrShow(context: vscode.ExtensionContext) {
		const column = vscode.window.activeTextEditor?.viewColumn;
		if (UsagePanel.currentPanel) {
			UsagePanel.currentPanel.panel.reveal(column);
			UsagePanel.currentPanel.update();
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'copilotPremiumUsageMonitor',
			'Copilot Premium Usage Monitor',
			column ?? vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			}
		);

		UsagePanel.currentPanel = new UsagePanel(panel, context.extensionUri, context);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.globalState = context.globalState;

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		this.panel.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'getConfig': {
					const cfgNew = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
					const cfgOld = vscode.workspace.getConfiguration('copilotPremiumMonitor');
					let hasSession = false;
					try {
						const s = await vscode.authentication.getSession('github', ['read:org'], { createIfNone: false });
						hasSession = !!s;
					} catch { }
					const hasPat = !!((cfgNew.get('token') as string | undefined)?.trim());
					this.post({
						type: 'config',
						config: {
							budget: (cfgNew.get('budget') as number | undefined) ?? (cfgOld.get('budget') as number | undefined),
							org: (cfgNew.get('org') as string | undefined) ?? (cfgOld.get('org') as string | undefined),
							mode: (cfgNew.get('mode') as string | undefined) ?? 'auto',
							warnAtPercent: Number(cfgNew.get('warnAtPercent') ?? 80),
							dangerAtPercent: Number(cfgNew.get('dangerAtPercent') ?? 100),
							hasPat,
							hasSession,
						},
					});
					break;
				}
				case 'openSettings': {
					await vscode.commands.executeCommand('workbench.action.openSettings', 'copilotPremiumUsageMonitor');
					break;
				}
				case 'help': {
					const readme = vscode.Uri.joinPath(this.extensionUri, 'README.md');
					try {
						await vscode.commands.executeCommand('markdown.showPreview', readme);
					} catch {
						try { await vscode.window.showTextDocument(readme); } catch { }
					}
					break;
				}
				case 'dismissFirstRun': {
					await this.globalState.update('copilotPremiumUsageMonitor.firstRunDisabled', true);
					try { await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('disableFirstRunTips', true, vscode.ConfigurationTarget.Global); } catch { }
					break;
				}
				case 'refresh': {
					const token = await getGitHubToken();
					if (!token) {
						const errorMsg = 'Authentication error: Please sign in or provide a valid PAT.';
						this.post({
							type: 'error',
							message: errorMsg
						});
						await this.globalState.update('copilotPremiumUsageMonitor.lastSyncError', errorMsg);
						vscode.window.showErrorMessage(errorMsg);
						maybeAutoOpenLog();
						updateStatusBar(); // reflect stale state immediately
						break;
					}
					const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
					const org = (cfg.get('org') as string | undefined)?.trim();
					const incomingMode = (message.mode as string | undefined) ?? (cfg.get('mode') as string | undefined) ?? 'auto';
					const mode = incomingMode === 'personal' || incomingMode === 'org' ? incomingMode : 'auto';
					const effectiveMode = mode === 'auto' ? (org ? 'org' : 'personal') : mode;
					if (effectiveMode === 'personal') {
						try {
							const octokit = await getOctokit(token);
							const me = await octokit.request('GET /user');
							const login = me.data?.login as string | undefined;
							if (!login) throw new Error('Cannot determine authenticated username.');
							const now = new Date();
							const year = now.getUTCFullYear();
							const month = now.getUTCMonth() + 1;
							const billing = await fetchUserBillingUsage(login, token, { year, month });
							// Clear stored last error BEFORE updating spend so status bar removes stale tag
							try { await this.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined); } catch { }
							try { await this.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', Date.now()); } catch { }
							await this.setSpend(billing.totalNetAmount); // triggers status bar update
							this.post({ type: 'billing', billing });
							// Clear previous error state if any (webview)
							this.post({ type: 'clearError' });
							// Update panel HTML/content after state changes
							this.update();
						} catch (e: any) {
							let message = 'Failed to sync usage.';
							if (e?.status === 404) {
								// 404 here generally means the enhanced billing usage endpoint is not available for this user context.
								message = 'Personal billing usage endpoint returned 404. Common causes: (1) Enhanced Billing / detailed usage not enabled for your account yet, (2) the PAT lacks required Plan read access (generate a classic token with `read:org` is NOT enough; ensure Plan: read-only entitlement), (3) you have no Copilot Premium usage recorded this period, or (4) the feature is still propagating (just enabled – retry later). You can try Org mode if you only have organization usage. Open budgets: https://github.com/settings/billing/budgets';
							} else if (e?.status === 403) {
								message = 'Authentication error: Permission denied. Ensure your token or session has Enhanced Billing Plan read access.';
							} else if (e?.message?.includes('401') || e?.message?.includes('403')) {
								message = 'Authentication error: Please sign in or provide a valid PAT.';
							} else if (e?.message?.includes('network')) {
								message = 'Network error: Unable to reach GitHub.';
							} else if (e?.message) {
								message = `Failed to sync usage: ${e.message}`;
							}
							this.post({ type: 'error', message });
							await this.globalState.update('copilotPremiumUsageMonitor.lastSyncError', message);
							vscode.window.showErrorMessage(message);
							maybeAutoOpenLog();
							updateStatusBar(); // show stale icon/tag
							// Do NOT call update here; let the error banner remain visible
						}
						break;
					}
					try {
						const metrics = await fetchOrgCopilotMetrics(org!, token, {});
						// Clear error first so status bar update (below) reflects non-stale state
						try { await this.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined); } catch { }
						try { await this.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', Date.now()); } catch { }
						this.post({ type: 'metrics', metrics });
						this.post({ type: 'clearError' });
						updateStatusBar(); // spend may not change, but remove stale tag/icon
					} catch (e: any) {
						let message = 'Failed to sync org metrics.';
						// Provide clearer, user-actionable guidance for common status codes
						if (e?.status === 404) {
							// 404 typically means metrics are not available for this org / user context.
							message = 'Org metrics endpoint returned 404. This usually means Copilot metrics are not available for this organization. Common causes: (1) Copilot not enabled or no active seats, (2) your account is not an org owner / billing manager, (3) metrics are still propagating (newly enabled – try again later), or (4) the organization name is incorrect. You can switch the Mode to Personal if you only need personal spend. Docs: https://docs.github.com/rest/copilot/copilot-metrics#get-copilot-metrics-for-an-organization';
						} else if (e?.message?.includes('401') || e?.message?.includes('403')) {
							message = 'Authentication error: Please sign in or provide a valid PAT.';
						} else if (e?.message?.toLowerCase()?.includes('network')) {
							message = 'Network error: Unable to reach GitHub.';
						} else if (e?.message) {
							message = `Failed to sync org metrics: ${e.message}`;
						}
						this.post({ type: 'error', message });
						await this.globalState.update('copilotPremiumUsageMonitor.lastSyncError', message);
						vscode.window.showErrorMessage(message);
						maybeAutoOpenLog();
						updateStatusBar();
					}
					// Do NOT call update here; let the error banner remain visible
					break;
				}
				case 'signIn': {
					await UsagePanel.ensureGitHubSession();
					break;
				}
				case 'openExternal': {
					if (typeof message.url === 'string' && message.url.startsWith('http')) {
						try { await vscode.env.openExternal(vscode.Uri.parse(message.url)); } catch { }
					}
					break;
				}
			}
		});

		this.update();
		this.maybeShowFirstRunNotice();
	}

	public dispose() {
		UsagePanel.currentPanel = undefined;
		this.panel.dispose();
		while (this.disposables.length) {
			const d = this.disposables.pop();
			try { d?.dispose(); } catch { }
		}
	}

	private post(data: any) {
		// If posting config, also send last error state
		if (data.type === 'config') {
			const lastError = this.globalState.get<string>('copilotPremiumUsageMonitor.lastSyncError');
			if (lastError) {
				this.panel.webview.postMessage({ type: 'error', message: lastError });
			}
		}
		this.panel.webview.postMessage(data);
	}

	private get webviewHtml(): string {
		const webview = this.panel.webview;
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.css'));
		const nonce = getNonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${styleUri}" rel="stylesheet" />
<title>Copilot Premium Usage Monitor</title>
</head>
<body>
	<div id="error-banner-container"></div>
	<div id="app">
		<h2>${localize('cpum.title', 'Copilot Premium Usage Monitor')}</h2>
		<div id="summary"></div>
			<div class="controls controls-row">
				<div class="btn-group">
					<button class="btn" id="refresh">${localize('cpum.refresh', 'Refresh')}</button>
					<button class="btn" id="signIn">${localize('cpum.signIn', 'Sign in to GitHub')}</button>
					<button class="btn" id="openSettings">${localize('cpum.settings', 'Settings')}</button>
					<button class="btn" id="help" title="${localize('cpum.help.tooltip', 'Open documentation and setup guidance')}">${localize('cpum.help', 'Help')}</button>
				</div>
				<div class="right-group">
					<label id="modeRow">${localize('cpum.mode', 'Mode')}:
						<select id="mode">
							<option value="auto" selected>${localize('cpum.mode.auto', 'Auto')}</option>
							<option value="personal">${localize('cpum.mode.personal', 'Personal')}</option>
							<option value="org">${localize('cpum.mode.org', 'Organization')}</option>
						</select>
					</label>
				</div>
			</div>
	</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	private async maybeShowFirstRunNotice() {
		const key = 'copilotPremiumUsageMonitor.firstRunShown';
		const shown = this.globalState.get<boolean>(key);
		const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
		const permanentlyDisabled = cfg.get<boolean>('disableFirstRunTips') === true || this.globalState.get<boolean>('copilotPremiumUsageMonitor.firstRunDisabled') === true;
		if (shown || permanentlyDisabled) return;
		this.post({
			type: 'notice',
			severity: 'info',
			text: localize('cpum.firstRun.tip', "Tip: Org metrics use your GitHub sign-in (read:org). Personal spend needs a PAT with 'Plan: read-only'. Avoid syncing your PAT. Click Help to learn more."),
			helpAction: true,
			dismissText: localize('cpum.firstRun.dismiss', "Don't show again"),
			learnMoreText: localize('cpum.firstRun.learnMore', 'Learn more'),
			openBudgetsText: localize('cpum.firstRun.openBudgets', 'Open budgets'),
			budgetsUrl: 'https://github.com/settings/billing/budgets'
		});
		await this.globalState.update(key, true);
	}


	private async setSpend(value: number) {
		await this.globalState.update('copilotPremiumUsageMonitor.currentSpend', value);
		updateStatusBar();
	}

	private getSpend(): number {
		const stored = this.globalState.get<number>('copilotPremiumUsageMonitor.currentSpend');
		if (typeof stored === 'number') return stored;
		// Back-compat: read legacy setting if present
		const cfg = vscode.workspace.getConfiguration();
		const legacy = cfg.get<number>('copilotPremiumMonitor.currentSpend', 0);
		return legacy ?? 0;
	}

	private update() {
		this.panel.webview.html = this.webviewHtml;
		const config = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
		const budget = Number(config.get('budget') ?? 0);
		const spend = this.getSpend();
		const pct = budget > 0 ? Math.min(100, Math.round((spend / budget) * 100)) : 0;
		const warnAtPercent = Number(config.get('warnAtPercent') ?? 80);
		const dangerAtPercent = Number(config.get('dangerAtPercent') ?? 100);
		setTimeout(() => this.post({ type: 'summary', budget, spend, pct, warnAtPercent, dangerAtPercent }), 50);
	}
}

// ---------------- Status bar meter ----------------
let extCtx: vscode.ExtensionContext;
let statusItem: vscode.StatusBarItem | undefined;
let statusBarMissingWarned = false; // one-time gate for missing status bar warning
let _logChannel: vscode.OutputChannel | undefined;
let logAutoOpened = false; // track automatic log opening per session
function getLog(): vscode.OutputChannel {
	if (!_logChannel) {
		_logChannel = vscode.window.createOutputChannel('Copilot Premium Usage');
	}
	return _logChannel;
}
function maybeAutoOpenLog() {
	try {
		if (logAutoOpened) return;
		const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
		if (!cfg.get<boolean>('showLogOnError')) return;
		logAutoOpened = true;
		const log = getLog();
		log.show(true);
		log.appendLine('[AutoOpen] Log channel opened due to first error (showLogOnError=true).');
	} catch { }
}
// Sidebar feature removed in v0.2.0 (sidebarProvider eliminated)
let autoRefreshTimer: NodeJS.Timeout | undefined;
let relativeTimeTimer: NodeJS.Timeout | undefined;

function initStatusBar(context: vscode.ExtensionContext) {
	try {
		const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
		const alignSetting = (cfg.get<string>('statusBarAlignment') || 'left').toLowerCase();
		const desiredAlignment = alignSetting === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
		// Recreate if alignment changed
		if (statusItem && statusItem.alignment !== desiredAlignment) {
			try { statusItem.dispose(); } catch { }
			statusItem = undefined;
		}
		if (!statusItem) {
			statusItem = vscode.window.createStatusBarItem(desiredAlignment, 100);
			statusItem.name = 'Copilot Premium Usage';
			statusItem.command = 'copilotPremiumUsageMonitor.openPanel';
			context.subscriptions.push(statusItem);
		}
	} catch (err) {
		getLog().appendLine(`[CopilotPremiumUsageMonitor] Error initializing status bar: ${err instanceof Error ? err.stack || err.message : String(err)}`);
		vscode.window.showErrorMessage('Error initializing Copilot Premium Usage status bar. See Output channel for details.');
		maybeAutoOpenLog();
	}
}

function updateStatusBar() {
	try {
		if (!statusItem || !extCtx) {
			if (!statusBarMissingWarned) {
				getLog().appendLine('[CopilotPremiumUsageMonitor] Status bar item or extension context missing.');
				statusBarMissingWarned = true;
			}
			return;
		}
		const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
		const budget = Number(cfg.get('budget') ?? 0);
		const spend = extCtx.globalState.get<number>('copilotPremiumUsageMonitor.currentSpend') ?? 0;
		const pct = budget > 0 ? Math.max(0, Math.min(1, spend / budget)) : 0;
		const percent = Math.round(pct * 100);
		const segments = 10;
		const filled = Math.round(pct * segments);
		const bar = '▰'.repeat(filled) + '▱'.repeat(Math.max(0, segments - filled));
		const warnAt = Number(cfg.get('warnAtPercent') ?? 80);
		const dangerAt = Number(cfg.get('dangerAtPercent') ?? 100);
		// Determine stale/error state from last stored sync error
		const lastError = extCtx.globalState.get<string>('copilotPremiumUsageMonitor.lastSyncError');
		let icon = 'organization';
		let forcedColor: vscode.ThemeColor | undefined;
		let staleTag = '';
		if (lastError) {
			const lower = lastError.toLowerCase();
			if (lower.includes('404')) icon = 'question';
			else if (lower.includes('401') || lower.includes('403') || lower.includes('permission')) icon = 'key';
			else if (lower.includes('network')) icon = 'cloud-offline';
			else icon = 'warning';
			staleTag = ' [stale]';
			// Softer color default: charts.yellow; switch to errorForeground if severe (auth/perms)
			if (icon === 'key' || icon === 'warning') {
				forcedColor = new vscode.ThemeColor('errorForeground');
			} else {
				forcedColor = new vscode.ThemeColor('charts.yellow');
			}
		}
		const normalColor = percent >= dangerAt
			? new vscode.ThemeColor('charts.red')
			: percent >= warnAt
				? new vscode.ThemeColor('charts.yellow')
				: new vscode.ThemeColor('charts.green');
		statusItem.text = `$(${icon}) ${percent}% ${bar}${staleTag}`;
		statusItem.color = forcedColor ?? normalColor;
		const md = new vscode.MarkdownString(undefined, true);
		md.isTrusted = true;
		md.appendMarkdown(`**${localize('cpum.statusbar.title', 'Copilot Premium Usage')}**\n\n`);
		md.appendMarkdown(`${localize('cpum.statusbar.budget', 'Budget')}: $${budget.toFixed(2)}  |  ${localize('cpum.statusbar.spend', 'Spend')}: $${spend.toFixed(2)}  |  ${localize('cpum.statusbar.used', 'Used')}: ${percent}%`);
		// Show last (successful) sync timestamp even when stale
		{
			const ts = extCtx.globalState.get<number>('copilotPremiumUsageMonitor.lastSyncTimestamp');
			if (ts) {
				try {
					const dt = new Date(ts);
					const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
					const offsetMin = dt.getTimezoneOffset();
					const absMin = Math.abs(offsetMin);
					const offH = String(Math.floor(absMin / 60)).padStart(2, '0');
					const offM = String(absMin % 60).padStart(2, '0');
					const sign = offsetMin <= 0 ? '+' : '-';
					const offsetStr = `UTC${sign}${offH}:${offM}`;
					const formatted = new Intl.DateTimeFormat(undefined, {
						year: 'numeric', month: '2-digit', day: '2-digit',
						hour: '2-digit', minute: '2-digit', second: '2-digit'
					}).format(dt);
					let rel = '';
					try {
						const diffMs = Date.now() - dt.getTime();
						if (diffMs >= 0) {
							const sec = Math.floor(diffMs / 1000);
							if (sec < 1) rel = 'just now';
							else if (sec < 45) rel = `${sec}s ago`;
							else if (sec < 90) rel = '1m ago';
							else {
								const min = Math.floor(sec / 60);
								if (min < 60) rel = `${min}m ago`;
								else {
									const hr = Math.floor(min / 60);
									const remMin = min % 60;
									if (hr < 24) rel = remMin ? `${hr}h ${remMin}m ago` : `${hr}h ago`;
									else {
										const day = Math.floor(hr / 24);
										if (day < 7) rel = `${day}d ago`;
										else {
											const wk = Math.floor(day / 7);
											if (wk < 4) rel = `${wk}w ago`;
											else {
												const mo = Math.floor(day / 30);
												if (mo < 12) rel = `${mo}mo ago`;
												else {
													const yr = Math.floor(day / 365);
													rel = `${yr}y ago`;
												}
											}
										}
									}
								}
							}
						} else {
							rel = 'just now';
						}
					} catch { }
					const label = lastError ? localize('cpum.statusbar.lastSuccessfulSync', 'Last successful sync') : localize('cpum.statusbar.lastSync', 'Last sync');
					md.appendMarkdown(`\n\n$(sync) ${label}: ${formatted} ${rel ? ` • ${rel}` : ''}`);
				} catch { }
			}
		}
		md.appendMarkdown(`\n\n$(gear) ${localize('cpum.statusbar.manageHint', 'Run "Copilot Premium Usage Monitor: Manage" to configure.')}`);
		// If the last sync produced an error, surface a stale data notice
		try {
			const lastError = extCtx?.globalState.get<string>('copilotPremiumUsageMonitor.lastSyncError');
			if (lastError) {
				// Light sanitization: escape markdown code fences/backticks to avoid breaking formatting
				const sanitized = lastError.replace(/`/g, '\u0060');
				md.appendMarkdown(`\n\n$(warning) **${localize('cpum.statusbar.stale', 'Data may be stale')}**: ${sanitized}`);
			}
		} catch { /* ignore tooltip error enrichment */ }
		statusItem.tooltip = md;
		statusItem.show();
	} catch (err) {
		getLog().appendLine(`[CopilotPremiumUsageMonitor] Error updating status bar: ${err instanceof Error ? err.stack || err.message : String(err)}`);
		vscode.window.showErrorMessage('Error updating Copilot Premium Usage status bar. See Output channel for details.');
		maybeAutoOpenLog();
	}
}

// Sidebar view removed.

function getBudgetSpendAndMode() {
	const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
	const budget = Number(cfg.get('budget') ?? 0);
	const spend = extCtx?.globalState.get<number>('copilotPremiumUsageMonitor.currentSpend') ?? 0;
	const pct = budget > 0 ? Math.max(0, Math.min(1, spend / budget)) : 0;
	const percent = Math.round(pct * 100);
	const incomingMode = (cfg.get('mode') as string | undefined) ?? 'auto';
	const org = (cfg.get('org') as string | undefined)?.trim();
	const mode = incomingMode === 'auto' ? (org ? 'org' : 'personal') : (incomingMode === 'org' || incomingMode === 'personal' ? incomingMode : 'auto');
	return { budget, spend, pct, percent, mode };
}

// ---------------- Auto refresh ----------------
function startAutoRefresh() {
	stopAutoRefresh();
	const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
	let minutes = Number(cfg.get('refreshIntervalMinutes') ?? 15);
	if (!isFinite(minutes) || minutes <= 0) minutes = 15;
	const ms = Math.max(5, Math.floor(minutes)) * 60 * 1000; // minimum 5 minutes
	autoRefreshTimer = setInterval(() => performAutoRefresh().catch(() => { }), ms);
	// Also perform one immediate refresh attempt non-interactively
	performAutoRefresh().catch(() => { });
}

function restartAutoRefresh() {
	startAutoRefresh();
}

function stopAutoRefresh() {
	if (autoRefreshTimer) {
		clearInterval(autoRefreshTimer);
		autoRefreshTimer = undefined;
	}
}

function startRelativeTimeTicker() {
	stopRelativeTimeTicker();
	relativeTimeTimer = setInterval(() => {
		try {
			if (!extCtx) return;
			const ts = extCtx.globalState.get<number>('copilotPremiumUsageMonitor.lastSyncTimestamp');
			if (ts) updateStatusBar();
		} catch { }
	}, 30000); // 30s cadence
}

function stopRelativeTimeTicker() {
	if (relativeTimeTimer) {
		clearInterval(relativeTimeTimer);
		relativeTimeTimer = undefined;
	}
}

async function performAutoRefresh() {
	// Try non-interactive token acquisition to avoid prompting
	const token = await getGitHubTokenNonInteractive();
	if (!token) return; // quietly skip
	const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
	const org = (cfg.get('org') as string | undefined)?.trim();
	const incomingMode = (cfg.get('mode') as string | undefined) ?? 'auto';
	const mode = incomingMode === 'auto' ? (org ? 'org' : 'personal') : incomingMode;
	if (mode === 'personal') {
		try {
			const octokit = await getOctokit(token);
			const me = await octokit.request('GET /user');
			const login = me.data?.login as string | undefined;
			if (!login) return;
			const now = new Date();
			const year = now.getUTCFullYear();
			const month = now.getUTCMonth() + 1;
			const billing = await fetchUserBillingUsage(login, token, { year, month });
			try { await extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined); } catch { }
			try { await extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', Date.now()); } catch { }
			await extCtx.globalState.update('copilotPremiumUsageMonitor.currentSpend', billing.totalNetAmount);
			updateStatusBar(); // will drop stale tag if present
		} catch {
			// ignore in background
		}
	} else {
		// Org mode: we don't derive spend; optional future: surface a small org metric badge (sidebar removed)
	}
}

async function getGitHubTokenNonInteractive(): Promise<string | undefined> {
	const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
	const directToken = (cfg.get('token') as string | undefined)?.trim();
	if (directToken) return directToken;
	try {
		const s = await vscode.authentication.getSession('github', ['read:org'], { createIfNone: false });
		return s?.accessToken;
	} catch {
		return undefined;
	}
}

async function getGitHubToken(): Promise<string | undefined> {
	const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
	const directToken = (cfg.get('token') as string | undefined)?.trim();
	if (directToken) return directToken;
	try {
		const s = await vscode.authentication.getSession('github', ['read:org'], { createIfNone: true });
		return s?.accessToken;
	} catch {
		return undefined;
	}
}

type OrgMetricsDay = {
	date: string;
	total_active_users: number;
	total_engaged_users: number;
	// We won't type the entire response; keep the surface small for now
	copilot_ide_code_completions?: any;
	copilot_ide_chat?: any;
	copilot_dotcom_chat?: any;
	copilot_dotcom_pull_requests?: any;
};

async function fetchOrgCopilotMetrics(org: string, token: string, opts?: { since?: Date; until?: Date; }): Promise<{ days: number; since: string; until: string; engagedUsersSum: number; codeSuggestionsSum: number; }> {
	const octokit = await getOctokit(token);
	const until = opts?.until ?? new Date();
	const since = opts?.since ?? new Date(until.getTime() - 27 * 24 * 60 * 60 * 1000); // 28 days window
	const sinceIso = since.toISOString().slice(0, 19) + 'Z';
	const untilIso = until.toISOString().slice(0, 19) + 'Z';
	const res = await octokit.request('GET /orgs/{org}/copilot/metrics', {
		org,
		since: sinceIso,
		until: untilIso,
		per_page: 28,
	});
	const data = (res.data as any[]) as OrgMetricsDay[];
	let engagedUsersSum = 0;
	let codeSuggestionsSum = 0;
	for (const day of data) {
		engagedUsersSum += Number(day.total_engaged_users || 0);
		const completions = day.copilot_ide_code_completions;
		if (completions?.editors) {
			for (const ed of completions.editors) {
				for (const model of ed.models ?? []) {
					for (const lang of model.languages ?? []) {
						codeSuggestionsSum += Number(lang.total_code_suggestions || 0);
					}
				}
			}
		}
	}
	return { days: data.length, since: sinceIso, until: untilIso, engagedUsersSum, codeSuggestionsSum };
}

type BillingUsageItem = {
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

async function fetchUserBillingUsage(username: string, token: string, opts: { year?: number; month?: number; day?: number; hour?: number; }) {
	const octokit = await getOctokit(token);
	const res = await octokit.request('GET /users/{username}/settings/billing/usage', {
		username,
		year: opts.year,
		month: opts.month,
		day: opts.day,
		hour: opts.hour,
	});
	const usageItems = (res.data as any).usageItems as BillingUsageItem[] | undefined;
	const items = usageItems ?? [];
	const copilotItems = items.filter((i) => i.product?.toLowerCase() === 'copilot');
	const totalNetAmount = copilotItems.reduce((sum, i) => sum + (Number(i.netAmount) || 0), 0);
	const totalQuantity = copilotItems.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
	return { items: copilotItems, totalNetAmount, totalQuantity };
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
