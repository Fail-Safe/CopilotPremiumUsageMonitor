import * as vscode from 'vscode';
import { computeUsageBar, pickIcon, formatRelativeTime } from './lib/format';
import { DEFAULT_WARN_AT_PERCENT, DEFAULT_DANGER_AT_PERCENT } from './constants';
import * as nls from 'vscode-nls';
import * as fs from 'fs';
import * as path from 'path';

const localize = nls.loadMessageBundle();

// ---------- Globals ----------
let extCtx: vscode.ExtensionContext | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let statusBarMissingWarned = false; // one-time gate for missing status bar warning
let _logChannel: vscode.OutputChannel | undefined;
let logAutoOpened = false; // track automatic log opening per session
// (Removed unused lastIconOverrideWarningMessage to satisfy lint)
let _test_lastStatusBarText: string | undefined; // test cache
let _test_postedMessages: any[] = []; // test capture of webview postMessage payloads
let _test_helpCount = 0; // test: number of help invocations
let _test_lastHelpInvoked: number | undefined; // test: timestamp of last help invocation

// Getter helpers (declared early so they are in scope for activation return object)
function _test_getHelpCount() { return _test_helpCount; }
function _test_getLastHelpInvoked() { return _test_lastHelpInvoked; }

// Lazy Octokit cache & test override
type OctokitModule = typeof import('@octokit/rest');
let _octokitModule: OctokitModule | undefined;
let _testOctokitFactory: ((auth?: string) => any) | undefined;
const noop = () => { /* intentional */ };
async function getOctokit(auth?: string) {
	if (_testOctokitFactory) { try { return _testOctokitFactory(auth); } catch (e) { noop(); } }
	if (!_octokitModule) { _octokitModule = await import('@octokit/rest'); }
	const { Octokit } = _octokitModule;
	return new Octokit({ auth, request: { headers: { 'X-GitHub-Api-Version': '2022-11-28' } } });
}

// ---------- Panel ----------
class UsagePanel {
	public static currentPanel: UsagePanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private readonly globalState: vscode.Memento;
	private disposables: vscode.Disposable[] = [];
	private _dispatch?: (msg: any) => void; // test hook

	static async ensureGitHubSession(): Promise<vscode.AuthenticationSession | undefined> {
		const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
		const token = (cfg.get('token') as string | undefined)?.trim();
		if (token) return undefined; // PAT present
		try { return await vscode.authentication.getSession('github', ['read:org'], { createIfNone: true }); } catch { vscode.window.showErrorMessage('GitHub sign-in failed or was cancelled.'); maybeAutoOpenLog(); return undefined; }
	}

	static createOrShow(context: vscode.ExtensionContext) {
		const column = vscode.window.activeTextEditor?.viewColumn;
		if (UsagePanel.currentPanel) { UsagePanel.currentPanel.panel.reveal(column); UsagePanel.currentPanel.update(); return; }
		const panel = vscode.window.createWebviewPanel('copilotPremiumUsageMonitor', 'Copilot Premium Usage Monitor', column ?? vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
		UsagePanel.currentPanel = new UsagePanel(panel, context.extensionUri, context);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
		this.panel = panel; this.extensionUri = extensionUri; this.globalState = context.globalState;
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this._dispatch = async (message: any) => {
			switch (message.type) {
				case 'getConfig': {
					try {
						const cfgNew = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
						const cfgOld = vscode.workspace.getConfiguration('copilotPremiumMonitor');
						const hasPat = !!((cfgNew.get('token') as string | undefined)?.trim());
						// Post immediately (assume no session yet) to avoid test timing flake
						const baseConfig = { budget: (cfgNew.get('budget') as number | undefined) ?? (cfgOld.get('budget') as number | undefined), org: (cfgNew.get('org') as string | undefined) ?? (cfgOld.get('org') as string | undefined), mode: (cfgNew.get('mode') as string | undefined) ?? 'auto', warnAtPercent: Number(cfgNew.get('warnAtPercent') ?? DEFAULT_WARN_AT_PERCENT), dangerAtPercent: Number(cfgNew.get('dangerAtPercent') ?? DEFAULT_DANGER_AT_PERCENT), hasPat, hasSession: false };
						this.post({ type: 'config', config: baseConfig });
						// Fire-and-forget session detection; if found, send updated config
						(async () => {
							try {
								const s = await vscode.authentication.getSession('github', ['read:org'], { createIfNone: false });
								if (s) {
									this.post({ type: 'config', config: { ...baseConfig, hasSession: true } });
								}
							} catch (e2) { noop(); }
						})();
					} catch (e) {
						// Guaranteed fallback config so tests relying on config message never fail silently
						this.post({ type: 'config', config: { budget: 0, org: undefined, mode: 'auto', warnAtPercent: DEFAULT_WARN_AT_PERCENT, dangerAtPercent: DEFAULT_DANGER_AT_PERCENT, hasPat: false, hasSession: false }, error: true });
						noop();
					}
					break;
				}
				case 'openSettings': { await vscode.commands.executeCommand('workbench.action.openSettings', 'copilotPremiumUsageMonitor'); break; }
				case 'help': { _test_helpCount++; _test_lastHelpInvoked = Date.now(); const readme = vscode.Uri.joinPath(this.extensionUri, 'README.md'); try { await vscode.commands.executeCommand('markdown.showPreview', readme); } catch (e) { try { await vscode.window.showTextDocument(readme); } catch (e2) { noop(); } } break; }
				case 'dismissFirstRun': { await this.globalState.update('copilotPremiumUsageMonitor.firstRunDisabled', true); try { await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('disableFirstRunTips', true, vscode.ConfigurationTarget.Global); } catch (e) { noop(); } break; }
				case 'refresh': {
					const token = await getGitHubToken();
					if (!token) { const m = 'Authentication error: Please sign in or provide a valid PAT.'; this.post({ type: 'error', message: m }); await this.globalState.update('copilotPremiumUsageMonitor.lastSyncError', m); vscode.window.showErrorMessage(m); maybeAutoOpenLog(); updateStatusBar(); break; }
					const cfgR = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor'); const org = (cfgR.get('org') as string | undefined)?.trim();
					const incomingMode = (message.mode as string | undefined) ?? (cfgR.get('mode') as string | undefined) ?? 'auto';
					const mode = incomingMode === 'personal' || incomingMode === 'org' ? incomingMode : 'auto';
					const effectiveMode = mode === 'auto' ? (org ? 'org' : 'personal') : mode;
					if (effectiveMode === 'org') {
						let allowFallback = mode === 'auto';
						try {
							const metrics = await fetchOrgCopilotMetrics(org!, token, {});
							try { await this.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined); } catch (e) { noop(); }
							try { await this.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', Date.now()); } catch (e) { noop(); }
							this.post({ type: 'metrics', metrics }); this.post({ type: 'clearError' }); updateStatusBar();
							break;
						} catch (e: any) {
							let msg = 'Failed to sync org metrics.';
							if (e?.status === 404) { msg = 'Org metrics endpoint returned 404.'; allowFallback = false; }
							else if (e?.message?.includes('401') || e?.message?.includes('403')) { msg = 'Authentication error: Please sign in or provide a valid PAT.'; allowFallback = false; }
							else if (e?.message?.toLowerCase()?.includes('network')) { msg = 'Network error: Unable to reach GitHub.'; }
							else if (e?.message) { msg = `Failed to sync org metrics: ${e.message}`; }
							if (!allowFallback) {
								this.post({ type: 'error', message: msg }); await this.globalState.update('copilotPremiumUsageMonitor.lastSyncError', msg); vscode.window.showErrorMessage(msg); maybeAutoOpenLog(); updateStatusBar();
								break;
							}
						}
					}
					if (effectiveMode === 'personal' || mode === 'auto') {
						try {
							const octokit = await getOctokit(token); const me = await octokit.request('GET /user'); const login = me.data?.login as string | undefined; if (!login) throw new Error('Cannot determine authenticated username.');
							const now = new Date(); const year = now.getUTCFullYear(); const month = now.getUTCMonth() + 1; const billing = await fetchUserBillingUsage(login, token, { year, month });
							try { await this.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined); } catch (e) { noop(); }
							try { await this.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', Date.now()); } catch (e) { noop(); }
							await this.setSpend(billing.totalNetAmount); this.post({ type: 'billing', billing }); this.post({ type: 'clearError' }); this.update();
						} catch (e: any) {
							let msg = 'Failed to sync usage.';
							if (e?.status === 404) msg = 'Personal billing usage endpoint returned 404.';
							else if (e?.status === 403) msg = 'Authentication error: Permission denied.';
							else if (e?.message?.includes('401') || e?.message?.includes('403')) msg = 'Authentication error: Please sign in or provide a valid PAT.';
							else if (e?.message?.toLowerCase()?.includes('network')) msg = 'Network error: Unable to reach GitHub.';
							else if (e?.message) msg = `Failed to sync usage: ${e.message}`;
							this.post({ type: 'error', message: msg }); await this.globalState.update('copilotPremiumUsageMonitor.lastSyncError', msg); vscode.window.showErrorMessage(msg); maybeAutoOpenLog(); updateStatusBar();
						}
					}
					break;
				}
				case 'signIn': { await UsagePanel.ensureGitHubSession(); break; }
				case 'openExternal': { if (typeof message.url === 'string' && message.url.startsWith('http')) { try { await vscode.env.openExternal(vscode.Uri.parse(message.url)); } catch { /* noop */ } } break; }
			}
		};
		this.panel.webview.onDidReceiveMessage(this._dispatch);
		this.update();
		this.maybeShowFirstRunNotice();
	}
	dispose() { UsagePanel.currentPanel = undefined; try { this.panel.dispose(); } catch (e) { noop(); } while (this.disposables.length) { try { this.disposables.pop()?.dispose(); } catch (e2) { noop(); } } }
	private post(data: any) { if (data && typeof data === 'object') { try { _test_postedMessages.push(data); } catch (e) { noop(); } } if (data.type === 'config') { const lastError = this.globalState.get<string>('copilotPremiumUsageMonitor.lastSyncError'); if (lastError) { const errMsg = { type: 'error', message: lastError }; this.panel.webview.postMessage(errMsg); try { _test_postedMessages.push(errMsg); } catch (e) { noop(); } } const iconWarn = this.globalState.get<string>('copilotPremiumUsageMonitor.iconOverrideWarning'); if (iconWarn) { const warnMsg = { type: 'iconOverrideWarning', message: iconWarn }; this.panel.webview.postMessage(warnMsg); try { _test_postedMessages.push(warnMsg); } catch (e) { noop(); } } } this.panel.webview.postMessage(data); }
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
	private async maybeShowFirstRunNotice() { const key = 'copilotPremiumUsageMonitor.firstRunShown'; const shown = this.globalState.get<boolean>(key); const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor'); const disabled = cfg.get<boolean>('disableFirstRunTips') === true || this.globalState.get<boolean>('copilotPremiumUsageMonitor.firstRunDisabled') === true; if (shown || disabled) return; this.post({ type: 'notice', severity: 'info', text: localize('cpum.firstRun.tip', "Tip: Org metrics use your GitHub sign-in (read:org). Personal spend needs a PAT with 'Plan: read-only'. Avoid syncing your PAT. Click Help to learn more."), helpAction: true, dismissText: localize('cpum.firstRun.dismiss', "Don't show again"), learnMoreText: localize('cpum.firstRun.learnMore', 'Learn more'), openBudgetsText: localize('cpum.firstRun.openBudgets', 'Open budgets'), budgetsUrl: 'https://github.com/settings/billing/budgets' }); await this.globalState.update(key, true); }
	private async setSpend(v: number) { await this.globalState.update('copilotPremiumUsageMonitor.currentSpend', v); updateStatusBar(); }
	private getSpend(): number { const stored = this.globalState.get<number>('copilotPremiumUsageMonitor.currentSpend'); if (typeof stored === 'number') return stored; const cfg = vscode.workspace.getConfiguration(); const legacy = cfg.get<number>('copilotPremiumMonitor.currentSpend', 0); return legacy ?? 0; }
	private update() { this.panel.webview.html = this.webviewHtml; const config = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor'); const budget = Number(config.get('budget') ?? 0); const spend = this.getSpend(); const pct = budget > 0 ? Math.min(100, Math.round((spend / budget) * 100)) : 0; const warnAtPercent = Number(config.get('warnAtPercent') ?? DEFAULT_WARN_AT_PERCENT); const dangerAtPercent = Number(config.get('dangerAtPercent') ?? DEFAULT_DANGER_AT_PERCENT); setTimeout(() => this.post({ type: 'summary', budget, spend, pct, warnAtPercent, dangerAtPercent }), 50); }
}

// Test hook to drive message handler without an actual webview post
(UsagePanel as any)._test_invokeMessage = (msg: any) => { try { const p = UsagePanel.currentPanel as any; p?._dispatch && p._dispatch(msg); } catch { /* noop */ } };

function maybeDumpExtensionHostCoverage() {
	try {
		const dir = process.env.CPUM_COVERAGE_DIR;
		const cov: any = (globalThis as any).__coverage__;
		if (dir && cov) {
			const file = path.join(dir, 'extension-host-final.json');
			fs.writeFileSync(file, JSON.stringify(cov), 'utf8');
		}
	} catch (e) { noop(); }
}

export function activate(context: vscode.ExtensionContext) {
	extCtx = context;
	const openPanel = vscode.commands.registerCommand('copilotPremiumUsageMonitor.openPanel', () => UsagePanel.createOrShow(context));
	const signIn = vscode.commands.registerCommand('copilotPremiumUsageMonitor.signIn', async () => { await UsagePanel.ensureGitHubSession(); vscode.window.showInformationMessage('GitHub sign-in completed (if required).'); });
	const configureOrg = vscode.commands.registerCommand('copilotPremiumUsageMonitor.configureOrg', async () => {
		try {
			if (process.env.CPUM_TEST_FORCE_ORG_ERROR) throw new Error('Forced test org list error');
			const token = await getGitHubToken();
			if (!token) { vscode.window.showInformationMessage('Sign in to GitHub or set a token in settings first.'); return; }
			const octokit = await getOctokit(token);
			const orgs: any[] = await octokit.paginate('GET /user/orgs', { per_page: 100 });
			if (!orgs.length) { vscode.window.showInformationMessage('No organizations found for your account.'); return; }
			const items: vscode.QuickPickItem[] = orgs.map(o => ({ label: String(o.login || ''), description: o.description || '' }));
			const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select an organization' });
			if (pick && pick.label) {
				await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('org', pick.label, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage(`Organization set to ${pick.label}`);
			}
		} catch (e: any) {
			try { getLog().appendLine(`[configureOrg] Error: ${e?.message ?? e}`); } catch { /* noop */ }
			vscode.window.showErrorMessage(`Failed to list organizations: ${e?.message ?? e}`);
			maybeAutoOpenLog();
		}
	});
	const manage = vscode.commands.registerCommand('copilotPremiumUsageMonitor.manage', async () => { try { await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:fail-safe.copilot-premium-usage-monitor copilotPremiumUsageMonitor'); } catch { await vscode.commands.executeCommand('workbench.action.openSettings', 'copilotPremiumUsageMonitor'); } });
	const showLogs = vscode.commands.registerCommand('copilotPremiumUsageMonitor.showLogs', () => { const log = getLog(); log.show(true); log.appendLine('[User] Opened log channel'); });
	const enableFirstRun = vscode.commands.registerCommand('copilotPremiumUsageMonitor.enableFirstRunNotice', async () => { await context.globalState.update('copilotPremiumUsageMonitor.firstRunDisabled', false); await context.globalState.update('copilotPremiumUsageMonitor.firstRunShown', false); await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('disableFirstRunTips', false, vscode.ConfigurationTarget.Global); vscode.window.showInformationMessage(localize('cpum.enableFirstRun.restored', 'Help banner will show again next time you open the panel.')); });
	context.subscriptions.push(openPanel, signIn, configureOrg, manage, showLogs, enableFirstRun);
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		const affectsCore = e.affectsConfiguration('copilotPremiumUsageMonitor.budget')
			|| e.affectsConfiguration('copilotPremiumUsageMonitor.mode')
			|| e.affectsConfiguration('copilotPremiumUsageMonitor.org')
			|| e.affectsConfiguration('copilotPremiumUsageMonitor.warnAtPercent')
			|| e.affectsConfiguration('copilotPremiumUsageMonitor.dangerAtPercent')
			|| e.affectsConfiguration('copilotPremiumUsageMonitor.statusBarIconOverride')
			|| e.affectsConfiguration('copilotPremiumUsageMonitor.useThemeStatusColor');
		if (affectsCore) {
			try { updateStatusBar(); } catch { /* noop */ }
			// Force panel summary refresh to pick up threshold color logic changes immediately
			try { UsagePanel.currentPanel?.['update'](); } catch { /* noop */ }
		}
		if (e.affectsConfiguration('copilotPremiumUsageMonitor.refreshIntervalMinutes')) restartAutoRefresh();
		if (e.affectsConfiguration('copilotPremiumUsageMonitor.statusBarAlignment')) { initStatusBar(context); try { updateStatusBar(); } catch { /* noop */ } }
	}));
	initStatusBar(context); updateStatusBar();
	startAutoRefresh(); startRelativeTimeTicker();
	if (process.env.CPUM_TEST_ENABLE_LOG_BUFFER) { try { getLog(); } catch { /* noop */ } }
	maybeDumpExtensionHostCoverage();
	return { _test_getStatusBarText, _test_forceStatusBarUpdate, _test_setSpendAndUpdate, _test_getStatusBarColor, _test_setLastSyncTimestamp, _test_getRefreshIntervalId, _test_getLogBuffer, _test_clearLastError, _test_setLastError, _test_getRefreshRestartCount, _test_getLogAutoOpened, _test_getSpend, _test_getLastError, _test_getPostedMessages, _test_resetPostedMessages, _test_resetFirstRun, _test_closePanel, _test_setIconOverrideWarning, _test_getHelpCount, _test_getLastHelpInvoked, _test_forceCoverageDump: () => { try { maybeDumpExtensionHostCoverage(); } catch { /* noop */ } }, _test_setOctokitFactory: (fn: any) => { _testOctokitFactory = fn; }, _test_invokeWebviewMessage: (msg: any) => { try { (UsagePanel as any)._test_invokeMessage(msg); } catch { /* noop */ } }, _test_refreshPersonal, _test_refreshOrg };
}
function getLog(): vscode.OutputChannel {
	if (!_logChannel) {
		_logChannel = vscode.window.createOutputChannel('Copilot Premium Usage');
		if (process.env.CPUM_TEST_ENABLE_LOG_BUFFER) {
			// Wrap appendLine to capture messages for tests
			const orig = _logChannel.appendLine.bind(_logChannel);
			(_logChannel as any)._buffer = [] as string[];
			(_logChannel as any).appendLine = (msg: string) => { try { (_logChannel as any)._buffer.push(msg); } catch { /* noop */ } orig(msg); };
		}
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
	} catch { /* noop */ }
}
// Sidebar feature removed in v0.2.0 (sidebarProvider eliminated)
let autoRefreshTimer: NodeJS.Timeout | undefined;
let autoRefreshRestartCount = 0; // test helper counter
let relativeTimeTimer: NodeJS.Timeout | undefined;

function initStatusBar(context: vscode.ExtensionContext) {
	try {
		const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
		const alignSetting = (cfg.get<string>('statusBarAlignment') || 'left').toLowerCase();
		const desiredAlignment = alignSetting === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
		// Recreate if alignment changed
		if (statusItem && statusItem.alignment !== desiredAlignment) {
			try { statusItem.dispose(); } catch { /* noop */ }
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
		const bar = computeUsageBar(percent);
		const warnAtRaw = Number(cfg.get('warnAtPercent') ?? DEFAULT_WARN_AT_PERCENT);
		const dangerAtRaw = Number(cfg.get('dangerAtPercent') ?? DEFAULT_DANGER_AT_PERCENT);
		// Allow users to disable thresholds by setting them to 0
		const warnAt = warnAtRaw > 0 ? warnAtRaw : Infinity;
		const dangerAt = dangerAtRaw > 0 ? dangerAtRaw : Infinity;
		const { mode } = getBudgetSpendAndMode();
		const lastError = extCtx.globalState.get<string>('copilotPremiumUsageMonitor.lastSyncError');
		const overrideRaw = (cfg.get('statusBarIconOverride') as string | undefined)?.trim() || undefined;
		const { icon, forcedColor: forcedColorKey, staleTag } = pickIcon({ percent, warnAt, dangerAt, error: lastError, mode: mode as any, override: lastError ? undefined : overrideRaw });
		let forcedColor: vscode.ThemeColor | undefined;
		if (forcedColorKey === 'errorForeground') forcedColor = new vscode.ThemeColor('errorForeground');
		else if (forcedColorKey === 'charts.yellow') forcedColor = new vscode.ThemeColor('charts.yellow');
		const useThemeDefault = cfg.get<boolean>('useThemeStatusColor') !== false; // default true
		let derivedColor: vscode.ThemeColor | undefined;
		if (forcedColor) {
			derivedColor = forcedColor; // error / stale overrides
		} else if (percent >= dangerAt) {
			derivedColor = new vscode.ThemeColor('charts.red');
		} else if (percent >= warnAt) {
			derivedColor = new vscode.ThemeColor('charts.yellow');
		} else if (!useThemeDefault) {
			// Only apply the green usage color when user opts out of theme default contrast mode
			derivedColor = new vscode.ThemeColor('charts.green');
		} else {
			// leave undefined to inherit theme's status bar foreground
			derivedColor = undefined;
		}
		statusItem.text = `$(${icon}) ${percent}% ${bar}${staleTag}`;
		// Store for tests
		_test_lastStatusBarText = statusItem.text;
		statusItem.color = derivedColor;
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
					try { rel = formatRelativeTime(dt.getTime()); } catch { /* noop */ }
					const label = lastError ? localize('cpum.statusbar.lastSuccessfulSync', 'Last successful sync') : localize('cpum.statusbar.lastSync', 'Last sync');
					// Include timezone offset + IANA zone for clarity (uses tz & offsetStr to avoid unused vars)
					const tzDisplay = tz ? ` ${tz}` : '';
					md.appendMarkdown(`\n\n$(sync) ${label}: ${formatted} ${rel ? ` • ${rel}` : ''} (${offsetStr}${tzDisplay})`);
				} catch { /* noop */ }
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
		} catch { /* noop */ }
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
	const wasRunning = !!autoRefreshTimer;
	stopAutoRefresh();
	const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
	let minutes = Number(cfg.get('refreshIntervalMinutes') ?? 15);
	if (!isFinite(minutes) || minutes <= 0) minutes = 15;
	const ms = Math.max(5, Math.floor(minutes)) * 60 * 1000; // minimum 5 minutes
	autoRefreshTimer = setInterval(() => performAutoRefresh().catch(() => { /* noop */ }), ms);
	if (wasRunning) autoRefreshRestartCount++; // count restarts only (not initial start)
	// Also perform one immediate refresh attempt non-interactively
	performAutoRefresh().catch(() => { /* noop */ });
}

function restartAutoRefresh() { startAutoRefresh(); }

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
		} catch { /* noop */ }
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
			try { await extCtx!.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined); } catch { /* noop */ }
			try { await extCtx!.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', Date.now()); } catch { /* noop */ }
			await extCtx!.globalState.update('copilotPremiumUsageMonitor.currentSpend', billing.totalNetAmount);
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

export function _test_getStatusBarText(): string | undefined { return _test_lastStatusBarText ?? statusItem?.text; }
export function _test_getStatusBarColor(): string | undefined {
	try { const c: any = (statusItem as any)?.color; return c?.id || c?._id || (typeof c === 'string' ? c : undefined); } catch { return undefined; }
}
export function _test_forceStatusBarUpdate() {
	try {
		if (extCtx && !statusItem) {
			initStatusBar(extCtx);
		}
		updateStatusBar();
	} catch { /* noop */ }
}
export async function _test_setSpendAndUpdate(spend: number, budget?: number) {
	if (!extCtx) return;
	try {
		await extCtx.globalState.update('copilotPremiumUsageMonitor.currentSpend', spend);
		if (typeof budget === 'number') {
			await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('budget', budget, vscode.ConfigurationTarget.Global);
		}
		updateStatusBar();
	} catch { /* noop */ }
}
export function _test_setLastSyncTimestamp(ts: number) { try { extCtx?.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', ts); } catch { /* noop */ } }
export function _test_getRefreshIntervalId(): any { return autoRefreshTimer; }
export function _test_getLogBuffer(): string[] | undefined { try { getLog(); return (_logChannel as any)?._buffer; } catch { return undefined; } }
export function _test_clearLastError() { try { extCtx?.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined); extCtx?.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', Date.now()); updateStatusBar(); } catch { /* noop */ } }
export function _test_setLastError(msg: string) { try { extCtx?.globalState.update('copilotPremiumUsageMonitor.lastSyncError', msg); updateStatusBar(); } catch { /* noop */ } }
export function _test_getRefreshRestartCount() { return autoRefreshRestartCount; }
export function _test_getLogAutoOpened() { return logAutoOpened; }
export function _test_getSpend() { try { return extCtx?.globalState.get<number>('copilotPremiumUsageMonitor.currentSpend'); } catch { return undefined; } }
export function _test_getLastError() { try { return extCtx?.globalState.get<string>('copilotPremiumUsageMonitor.lastSyncError'); } catch { return undefined; } }
export function _test_getPostedMessages() { return _test_postedMessages.slice(); }
export function _test_resetPostedMessages() { _test_postedMessages = []; }
export async function _test_resetFirstRun() { try { await extCtx?.globalState.update('copilotPremiumUsageMonitor.firstRunShown', false); await extCtx?.globalState.update('copilotPremiumUsageMonitor.firstRunDisabled', false); } catch { /* noop */ } }
export function _test_closePanel() { try { (UsagePanel as any).currentPanel?.dispose(); } catch { /* noop */ } }
export async function _test_setIconOverrideWarning(msg: string | undefined) { try { await extCtx?.globalState.update('copilotPremiumUsageMonitor.iconOverrideWarning', msg); } catch { /* noop */ } }

// Internal test-only helpers to drive refresh logic directly (bypassing webview message path)
export async function _test_refreshPersonal() {
	const token = await getGitHubToken();
	if (!token || !extCtx) return;
	try {
		const octokit = await getOctokit(token);
		const me = await octokit.request('GET /user');
		const login = me.data?.login as string | undefined; if (!login) throw new Error('Cannot determine authenticated username.');
		const now = new Date(); const year = now.getUTCFullYear(); const month = now.getUTCMonth() + 1;
		const billing = await fetchUserBillingUsage(login, token, { year, month });
		await extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined);
		await extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', Date.now());
		await extCtx.globalState.update('copilotPremiumUsageMonitor.currentSpend', billing.totalNetAmount);
		updateStatusBar();
	} catch (e: any) {
		let msg = 'Failed to sync usage.'; if (e?.status === 404) msg = 'Personal billing usage endpoint returned 404.'; else if (e?.status === 403) msg = 'Authentication error: Permission denied.'; else if (e?.message?.includes('401') || e?.message?.includes('403')) msg = 'Authentication error: Please sign in or provide a valid PAT.'; else if (e?.message?.toLowerCase()?.includes('network')) msg = 'Network error: Unable to reach GitHub.'; else if (e?.message) msg = `Failed to sync usage: ${e.message}`;
		await extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncError', msg);
		updateStatusBar();
	}
}

export async function _test_refreshOrg() {
	const token = await getGitHubToken();
	const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
	const org = (cfg.get('org') as string | undefined)?.trim();
	if (!token || !org || !extCtx) return;
	try {
		const metrics = await fetchOrgCopilotMetrics(org, token, {});
		await extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined);
		await extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', Date.now());
		updateStatusBar();
		void metrics; // currently unused in status bar tests
	} catch (e: any) {
		let msg = 'Failed to sync org metrics.'; if (e?.status === 404) msg = 'Org metrics endpoint returned 404.'; else if (e?.message?.includes('401') || e?.message?.includes('403')) msg = 'Authentication error: Please sign in or provide a valid PAT.'; else if (e?.message?.toLowerCase()?.includes('network')) msg = 'Network error: Unable to reach GitHub.'; else if (e?.message) msg = `Failed to sync org metrics: ${e.message}`;
		await extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncError', msg);
		updateStatusBar();
	}
}

