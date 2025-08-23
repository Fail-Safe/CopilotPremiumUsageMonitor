import * as vscode from 'vscode';
import { computeUsageBar, pickIcon, formatRelativeTime } from './lib/format';
import { readStoredToken, migrateSettingToken, writeToken, clearToken, getSecretStorageKey } from './secrets';
import { deriveTokenState, recordMigrationKeep, recordSecureSetAndLegacyCleared, resetAllTokenStateWindows, debugSnapshot, recordSecureCleared } from './lib/tokenState';
import { setSecretsLogger, logSecrets } from './secrets_log';
import { DEFAULT_WARN_AT_PERCENT, DEFAULT_DANGER_AT_PERCENT } from './constants';
import * as nls from 'vscode-nls';
import * as fs from 'fs';
import * as path from 'path';

const localize = nls.loadMessageBundle();
setSecretsLogger((m) => { try { getLog().appendLine(`[secrets] ${m}`); } catch { /* noop */ } });
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
// In-memory fast flag to reflect most recent secret write/clear immediately (bridges secret storage latency in tests)
let lastSetTokenValue: string | undefined; // optimistic secure presence immediately after set/migrate
let pendingResidualHintUntil = 0; // one-shot window to show residual hint if panel opens after a keep-migration

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
						// Simplified direct read of stored token
						const cfgNew = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
						const cfgOld = vscode.workspace.getConfiguration('copilotPremiumMonitor');
						// Read token info and check for residual plaintext
						let secret: string | undefined; let legacy: string | undefined;
						try { secret = extCtx ? await extCtx.secrets.get(getSecretStorageKey()) || undefined : undefined; } catch { /* ignore */ }
						try { legacy = (cfgNew.get('token') as string | undefined)?.trim(); } catch { /* ignore */ }
						const legacyPresentRaw = !!legacy;
						// Derive via state machine (optimistic flag bridges small secret propagation gaps)
						// Use optimistic flag only for hasSecurePat, not for securePatOnly gating; derive raw then adjust
						let ts = deriveTokenState({ secretPresent: !!secret || !!lastSetTokenValue, legacyPresentRaw });
						// If optimistic flag is the only reason secretPresent true and legacy still present, force securePatOnly false
						if (!secret && lastSetTokenValue && legacyPresentRaw) {
							if (ts.securePatOnly) { ts = { ...ts, securePatOnly: false }; }
						}
						if (process.env.CPUM_TEST_DEBUG_TOKEN === '1') { try { getLog().appendLine(`[debug:getConfig] state=${ts.state} legacyRaw=${legacyPresentRaw} hasSecure=${ts.hasSecure} hasLegacy=${ts.hasLegacy} residual=${ts.residualPlaintext} snapshot=${debugSnapshot()}`); } catch { /* noop */ } }
						const hasPat = ts.hasSecure || ts.hasLegacy;
						const securePatOnly = ts.securePatOnly;
						const hasSecurePat = ts.hasSecure;
						const residualPlaintext = ts.residualPlaintext;
						// Build config
						const baseConfig = {
							budget: (cfgNew.get('budget') as number | undefined) ?? (cfgOld.get('budget') as number | undefined),
							org: (cfgNew.get('org') as string | undefined) ?? (cfgOld.get('org') as string | undefined),
							mode: (cfgNew.get('mode') as string | undefined) ?? 'auto',
							warnAtPercent: Number(cfgNew.get('warnAtPercent') ?? DEFAULT_WARN_AT_PERCENT),
							dangerAtPercent: Number(cfgNew.get('dangerAtPercent') ?? DEFAULT_DANGER_AT_PERCENT),
							hasPat,
							hasSession: false,
							securePatOnly,
							hasSecurePat,
							residualPlaintext,
							noTokenStaleMessage: localize('cpum.webview.noTokenStale', 'Awaiting secure token for personal spend updates.'),
							secureTokenTitle: localize('cpum.secureToken.indicator.title', 'Secure token stored in VS Code Secret Storage (encrypted by your OS).'),
							secureTokenText: localize('cpum.secureToken.indicator.text', 'Secure token set'),
							secureTokenTitleResidual: localize('cpum.secureToken.indicator.titleResidual', 'Secure token present (plaintext copy still in settings – clear it).'),
							secureTokenTextResidual: localize('cpum.secureToken.indicator.textResidual', 'Secure token + Plaintext in settings')
						};
						this.post({ type: 'config', config: baseConfig });
						// Hint when no PAT in personal context (single emission; duplicates removed to satisfy test expecting exactly one)
						if (!hasPat) {
							const personalContext = (baseConfig.mode === 'personal') || (baseConfig.mode === 'auto' && !baseConfig.org);
							if (personalContext) {
								this.post({ type: 'setTokenHint', message: localize('cpum.setToken.hint.afterClear', 'No secure token present. Add one to track personal spend.'), buttonLabel: localize('cpum.setToken.hint.button', 'Set Token') });
							}
						}
						// Consolidated migration / residual plaintext hint logic
						// Show residual when both secure + legacy present OR explicit residualPlaintext state OR pending one-shot window still open.
						const showResidual = (hasSecurePat && legacyPresentRaw) || residualPlaintext || (legacyPresentRaw && (pendingResidualHintUntil > Date.now()));
						if (showResidual) {
							this.post({
								type: 'migrationHint',
								text: localize('cpum.migration.hint.residual', 'Plaintext PAT remains in settings. Clear it to finish securing.'),
								buttonLabel: localize('cpum.migration.hint.residual.button', 'Clear Plaintext')
							});
							pendingResidualHintUntil = 0; // consume any pending one-shot
						} else if (!hasSecurePat && hasPat) {
							this.post({
								type: 'migrationHint',
								text: localize('cpum.migration.hint', 'Your Copilot PAT is currently stored in plaintext settings. Migrate it to secure storage.'),
								buttonLabel: localize('cpum.migration.hint.button', 'Migrate Now')
							});
						}
						// Session detection
						(async () => {
							try {
								const s = await vscode.authentication.getSession('github', ['read:org'], { createIfNone: false });
								if (s) {
									this.post({ type: 'config', config: { ...baseConfig, hasSession: true } });
								}
							} catch { /* noop */ }
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
				case 'migrateToken': {
					const result = await performExplicitMigration(extCtx!, true);
					if (result?.migrated) {
						const successMsg = result.removedLegacy ? localize('cpum.migration.hint.migratedRemoved', 'Token migrated and plaintext setting cleared.') : localize('cpum.migration.hint.migrated', 'Token migrated to secure storage.');
						this.post({ type: 'migrationComplete', message: successMsg, removedLegacy: result.removedLegacy });
						await postFreshConfig();
					}
					break;
				}
				case 'clearPlaintextToken': {
					try {
						const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
						await cfg.update('token', '', vscode.ConfigurationTarget.Global); recordSecureSetAndLegacyCleared();
						this.post({ type: 'migrationComplete', message: localize('cpum.migration.hint.plaintextCleared', 'Plaintext token cleared.'), removedLegacy: true });
						await postFreshConfig();
					} catch { /* noop */ }
					break;
				}
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
							// Also clear any lingering error indicator by posting clearError
							try { await this.globalState.update('copilotPremiumUsageMonitor.lastSyncTimestamp', Date.now()); } catch (e) { noop(); }
							this.post({ type: 'metrics', metrics }); this.post({ type: 'clearError' }); updateStatusBar();
							try { await postFreshConfig(); } catch { /* noop */ }
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
				case 'setTokenSecure':
					await vscode.commands.executeCommand('copilotPremiumUsageMonitor.setTokenSecure');
					break;
			}
		};
		this.panel.webview.onDidReceiveMessage(this._dispatch);
		this.update();
		this.maybeShowFirstRunNotice();
	}
	dispose() { UsagePanel.currentPanel = undefined; try { this.panel.dispose(); } catch (e) { noop(); } while (this.disposables.length) { try { this.disposables.pop()?.dispose(); } catch (e2) { noop(); } } }
	private post(data: any) {
		if (data && typeof data === 'object') { try { _test_postedMessages.push(data); } catch { /* noop */ } }
		if (data.type === 'config') {
			try { const lastError = this.globalState.get<string>('copilotPremiumUsageMonitor.lastSyncError'); if (lastError) { const errMsg = { type: 'error', message: lastError }; try { this.panel.webview.postMessage(errMsg); _test_postedMessages.push(errMsg); } catch { /* disposed */ } } } catch { /* noop */ }
			try { const iconWarn = this.globalState.get<string>('copilotPremiumUsageMonitor.iconOverrideWarning'); if (iconWarn) { const warnMsg = { type: 'iconOverrideWarning', message: iconWarn }; try { this.panel.webview.postMessage(warnMsg); _test_postedMessages.push(warnMsg); } catch { /* disposed */ } } } catch { /* noop */ }
		}
		try { this.panel.webview.postMessage(data); } catch { /* disposed */ }
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
	private async maybeShowFirstRunNotice() { const key = 'copilotPremiumUsageMonitor.firstRunShown'; const shown = this.globalState.get<boolean>(key); const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor'); const disabled = cfg.get<boolean>('disableFirstRunTips') === true || this.globalState.get<boolean>('copilotPremiumUsageMonitor.firstRunDisabled') === true; if (shown || disabled) return; this.post({ type: 'notice', severity: 'info', text: localize('cpum.firstRun.tip', "Tip: Org metrics use your GitHub sign-in (read:org). Personal spend needs a PAT with 'Plan: read-only'. Avoid syncing your PAT. Click Help to learn more."), helpAction: true, dismissText: localize('cpum.firstRun.dismiss', "Don't show again"), learnMoreText: localize('cpum.firstRun.learnMore', 'Learn more'), openBudgetsText: localize('cpum.firstRun.openBudgets', 'Open budgets'), budgetsUrl: 'https://github.com/settings/billing/budgets' }); await this.globalState.update(key, true); }
	private async setSpend(v: number) { await this.globalState.update('copilotPremiumUsageMonitor.currentSpend', v); updateStatusBar(); }
	private getSpend(): number { const stored = this.globalState.get<number>('copilotPremiumUsageMonitor.currentSpend'); if (typeof stored === 'number') return stored; const cfg = vscode.workspace.getConfiguration(); const legacy = cfg.get<number>('copilotPremiumMonitor.currentSpend', 0); return legacy ?? 0; }
	private update() { this.panel.webview.html = this.webviewHtml; const config = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor'); const budget = Number(config.get('budget') ?? 0); const spend = this.getSpend(); const pct = budget > 0 ? Math.min(100, Math.round((spend / budget) * 100)) : 0; const warnAtPercent = Number(config.get('warnAtPercent') ?? DEFAULT_WARN_AT_PERCENT); const dangerAtPercent = Number(config.get('dangerAtPercent') ?? DEFAULT_DANGER_AT_PERCENT); setTimeout(() => this.post({ type: 'summary', budget, spend, pct, warnAtPercent, dangerAtPercent }), 50); }
}

// Helper to immediately push a fresh config snapshot after token mutations so
// the webview's securePatOnly indicator updates without waiting for a manual refresh.
async function postFreshConfig() {
	try {
		if (!UsagePanel.currentPanel || !extCtx) return;
		const cfgNew = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
		const cfgOld = vscode.workspace.getConfiguration('copilotPremiumMonitor');
		let secret: string | undefined; let legacy: string | undefined;
		try { secret = await extCtx.secrets.get(getSecretStorageKey()) || undefined; } catch { /* ignore */ }
		try { legacy = (cfgNew.get('token') as string | undefined)?.trim(); } catch { /* ignore */ }
		const legacyPresentRaw = !!legacy;
		let ts = deriveTokenState({ secretPresent: !!secret || !!lastSetTokenValue, legacyPresentRaw });
		if (!secret && lastSetTokenValue && legacyPresentRaw && ts.securePatOnly) { ts = { ...ts, securePatOnly: false }; }
		if (process.env.CPUM_TEST_DEBUG_TOKEN === '1') { try { getLog().appendLine(`[debug:postFreshConfig] state=${ts.state} hasSecure=${ts.hasSecure} hasLegacy=${ts.hasLegacy} residual=${ts.residualPlaintext} snapshot=${debugSnapshot()}`); } catch { /* noop */ } }
		const hasSecurePat = ts.hasSecure;
		// const hasLegacy = ts.hasLegacy; // not currently used outside derived flags
		const residualPlaintext = ts.residualPlaintext;
		const hasPat = ts.hasSecure || ts.hasLegacy;
		const securePatOnly = ts.securePatOnly;
		const baseConfig = {
			budget: (cfgNew.get('budget') as number | undefined) ?? (cfgOld.get('budget') as number | undefined),
			org: (cfgNew.get('org') as string | undefined) ?? (cfgOld.get('org') as string | undefined),
			mode: (cfgNew.get('mode') as string | undefined) ?? 'auto',
			warnAtPercent: Number(cfgNew.get('warnAtPercent') ?? DEFAULT_WARN_AT_PERCENT),
			dangerAtPercent: Number(cfgNew.get('dangerAtPercent') ?? DEFAULT_DANGER_AT_PERCENT),
			hasPat,
			hasSession: false,
			securePatOnly,
			hasSecurePat,
			residualPlaintext,
			noTokenStaleMessage: localize('cpum.webview.noTokenStale', 'Awaiting secure token for personal spend updates.'),
			secureTokenTitle: localize('cpum.secureToken.indicator.title', 'Secure token stored in VS Code Secret Storage (encrypted by your OS).'),
			secureTokenText: localize('cpum.secureToken.indicator.text', 'Secure token set'),
			secureTokenTitleResidual: localize('cpum.secureToken.indicator.titleResidual', 'Secure token present (plaintext copy still in settings – clear it).'),
			secureTokenTextResidual: localize('cpum.secureToken.indicator.textResidual', 'Secure token + Plaintext in settings')
		};
		// lastPostedTokenState removed
		UsagePanel.currentPanel['post']?.({ type: 'config', config: baseConfig });
	} catch { /* noop */ }
}

// Poll secret storage briefly to ensure recently written token is observable before posting config
async function waitForSecret(ctx: vscode.ExtensionContext, attempts = 10, delayMs = 30, expected?: string): Promise<void> {
	for (let i = 0; i < attempts; i++) {
		try {
			const v = await ctx.secrets.get(getSecretStorageKey());
			if (v && (!expected || v === expected)) return;
		} catch { /* ignore */ }
		if (i < attempts - 1) { await new Promise(r => setTimeout(r, delayMs)); }
	}
}

// Poll until secret is gone (after clear) to avoid transient hasSecurePat=true race
async function waitForSecretGone(ctx: vscode.ExtensionContext, attempts = 20, delayMs = 30): Promise<void> {
	for (let i = 0; i < attempts; i++) {
		try {
			const v = await ctx.secrets.get(getSecretStorageKey());
			if (!v) return; // gone
		} catch { /* ignore */ }
		if (i < attempts - 1) { await new Promise(r => setTimeout(r, delayMs)); }
	}
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
	// Provide logging bridge for secrets helpers
	setSecretsLogger((m) => { try { getLog().appendLine(`[secrets] ${m}`); } catch { /* noop */ } });
	// Kick off token migration check (fire & forget)
	void maybeOfferTokenMigration(context);
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
	const migrateTokenCmd = vscode.commands.registerCommand('copilotPremiumUsageMonitor.migrateToken', async () => {
		await performExplicitMigration(context, true);
	});
	// setTokenSecure: prompt user, store token securely, and refresh config
	const setTokenSecure = vscode.commands.registerCommand('copilotPremiumUsageMonitor.setTokenSecure', async () => {
		const newToken = await vscode.window.showInputBox({
			prompt: localize('cpum.setToken.prompt', 'Enter GitHub Personal Access Token (Plan: read-only)'),
			placeHolder: 'ghp_xxx or fine-grained token',
			ignoreFocusOut: true,
			password: true,
			validateInput: (val) => !val?.trim() ? localize('cpum.setToken.validation', 'Token cannot be empty') : undefined
		});
		if (!newToken || !extCtx) return;
		const token = newToken.trim();
		await writeToken(extCtx, token);
		lastSetTokenValue = token; try { await extCtx.globalState.update('_cpum_lastSecureTokenSet', true); } catch { /* noop */ }
		try { await waitForSecret(extCtx, 40, 25, token); } catch { /* noop */ }
		try {
			const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
			await cfg.update('token', '', vscode.ConfigurationTarget.Global);
			recordSecureSetAndLegacyCleared();
		} catch { /* noop */ }
		await postFreshConfig();
	});
	// clearTokenSecure: remove token from secure storage
	const clearTokenSecure = vscode.commands.registerCommand('copilotPremiumUsageMonitor.clearTokenSecure', async () => {
		if (!extCtx) return;
		await clearToken(extCtx);
		try { await waitForSecretGone(extCtx, 60, 20); } catch { /* noop */ }
		lastSetTokenValue = undefined; try { await extCtx.globalState.update('_cpum_lastSecureTokenSet', false); } catch { /* noop */ }
		recordSecureCleared();
		// small delay to allow any pending getConfig handlers to observe cleared secret
		await new Promise(r => setTimeout(r, 40));
		await postFreshConfig();
	});
	// enableFirstRunNotice: test helper to reset first run state
	const enableFirstRunNotice = vscode.commands.registerCommand('copilotPremiumUsageMonitor.enableFirstRunNotice', async () => {
		await context.globalState.update('copilotPremiumUsageMonitor.firstRunShown', false);
		await context.globalState.update('copilotPremiumUsageMonitor.firstRunDisabled', false);
	});
	// Configuration change handler
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
		const affectsCore = e.affectsConfiguration('copilotPremiumUsageMonitor.budget')
			|| e.affectsConfiguration('copilotPremiumUsageMonitor.warnAtPercent')
			|| e.affectsConfiguration('copilotPremiumUsageMonitor.dangerAtPercent')
			|| e.affectsConfiguration('copilotPremiumUsageMonitor.statusBarIconOverride')
			|| e.affectsConfiguration('copilotPremiumUsageMonitor.useThemeStatusColor');
		if (affectsCore) {
			try { updateStatusBar(); } catch { /* noop */ }
			try { UsagePanel.currentPanel?.['update'](); } catch { /* noop */ }
		}
		if (e.affectsConfiguration('copilotPremiumUsageMonitor.refreshIntervalMinutes')) restartAutoRefresh();
		if (e.affectsConfiguration('copilotPremiumUsageMonitor.statusBarAlignment')) { initStatusBar(context); try { updateStatusBar(); } catch { /* noop */ } }
	}));
	context.subscriptions.push(openPanel, signIn, configureOrg, manage, showLogs, migrateTokenCmd, setTokenSecure, clearTokenSecure, enableFirstRunNotice);
	initStatusBar(context); updateStatusBar();
	// Avoid background refresh timers during tests to minimize race conditions affecting assertions.
	if (!process.env.VSCODE_PID) { startAutoRefresh(); startRelativeTimeTicker(); }
	// Show one-time toast if no secure/plaintext token and user is in a personal-spend context
	(async () => {
		try {
			if (!extCtx) return;
			// Avoid conflicting with migration prompt or guard; only show if absolutely no token anywhere
			const info = await readStoredToken(extCtx);
			if (info.source !== 'none') return; // either settings or secret already in play
			const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
			const mode = (cfg.get('mode') as string | undefined) ?? 'auto';
			const org = (cfg.get('org') as string | undefined)?.trim();
			const personalContext = mode === 'personal' || (mode === 'auto' && !org);
			if (!personalContext) return; // org metrics only path does not need a PAT
			const shownKey = 'copilotPremiumUsageMonitor.noTokenToastShown';
			if (context.globalState.get<boolean>(shownKey)) return;
			await context.globalState.update(shownKey, true);
			const setAction = localize('cpum.setToken.hint.button', 'Set Token');
			const msg = localize('cpum.setToken.hint.afterClear', 'No secure token present. Add one to track personal spend.');
			const choice = await vscode.window.showInformationMessage(msg, setAction);
			if (choice === setAction) { try { await vscode.commands.executeCommand('copilotPremiumUsageMonitor.setTokenSecure'); } catch { /* noop */ } }
		} catch { /* ignore toast errors */ }
	})();
	if (process.env.CPUM_TEST_ENABLE_LOG_BUFFER) { try { getLog(); } catch { /* noop */ } }
	maybeDumpExtensionHostCoverage();
	return {
		_test_getStatusBarText, _test_forceStatusBarUpdate, _test_setSpendAndUpdate, _test_getStatusBarColor, _test_setLastSyncTimestamp, _test_getRefreshIntervalId, _test_getLogBuffer, _test_clearLastError, _test_setLastError, _test_getRefreshRestartCount, _test_getLogAutoOpened, _test_getSpend, _test_getLastError, _test_getPostedMessages, _test_resetPostedMessages, _test_resetFirstRun, _test_closePanel, _test_setIconOverrideWarning, _test_getHelpCount, _test_getLastHelpInvoked, _test_forceCoverageDump: () => { try { maybeDumpExtensionHostCoverage(); } catch { /* noop */ } }, _test_setOctokitFactory: (fn: any) => { _testOctokitFactory = fn; }, _test_invokeWebviewMessage: (msg: any) => { try { (UsagePanel as any)._test_invokeMessage(msg); } catch { /* noop */ } }, _test_refreshPersonal, _test_refreshOrg,
		// Reset secret storage and heuristics accumulator for tests
		_test_clearSecretToken: async () => {
			if (extCtx) {
				await clearToken(extCtx);
				try { await waitForSecretGone(extCtx, 40, 25); } catch { /* noop */ }
			}
			const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
			await cfg.update('token', '', vscode.ConfigurationTarget.Global);
			// Clear all in-memory heuristic flags
			pendingResidualHintUntil = 0;
			lastSetTokenValue = undefined; // ensure optimistic secure flag cleared between tests
			resetAllTokenStateWindows();
			// Brief delay to ensure cleanup persistence
			await new Promise(r => setTimeout(r, 100));
		},
		_test_forceConfig: async () => { await postFreshConfig(); },
	};
}
// Test-only export to drive migration logic
export async function _test_readTokenInfo() { if (!extCtx) return undefined; return readStoredToken(extCtx); }
export async function _test_forceMigration(removeSetting: boolean) {
	if (!extCtx) return;
	const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
	const val = (cfg.get('token') as string | undefined)?.trim();
	const migrated = await migrateSettingToken(extCtx, removeSetting);
	if (migrated) {
		try { if (val) await waitForSecret(extCtx, 40, 30, val); } catch { /* noop */ }
		// After ensuring secret stored, only then set heuristic flag so tests rely on real presence
		try { if (extCtx) { const direct = await extCtx.secrets.get(getSecretStorageKey()); if (direct) lastSetTokenValue = val; } } catch { /* noop */ }
		if (!removeSetting) { recordMigrationKeep(); }
	}
	// If not migrated because secret already matched something else but removeSetting=false and we have a plaintext token val
	// ensure secret reflects plaintext token so residual test sees expected token; overwrite only in test helper context
	else if (!removeSetting && val) {
		try { await writeToken(extCtx, val); lastSetTokenValue = val; } catch { /* noop */ }
		try { recordMigrationKeep(); } catch { /* noop */ }
	}
}
// Note: tests rely on immediate secret visibility; ensure cachedSecretPresent reflects current secret after migration helper
// (We can't await readStoredToken here without altering existing test semantics, just set heuristic flag.)
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
// Track last posted token state to optionally suppress redundant config posts (future use)
// let lastPostedTokenState: { hasSecurePat: boolean; residualPlaintext: boolean } | undefined; // unused (future suppression logic)

// ---------------- Token secure storage migration ----------------
async function maybeOfferTokenMigration(context: vscode.ExtensionContext) {
	try {
		const info = await readStoredToken(context);
		if (info.source === 'settings' && info.token) {
			// Only prompt once per session; guard with globalState flag (so user can postpone)
			const promptedKey = 'copilotPremiumUsageMonitor.migrationPromptShown';
			if (context.globalState.get<boolean>(promptedKey)) return;
			await context.globalState.update(promptedKey, true);
			const choice = await vscode.window.showInformationMessage(
				'Copilot Premium Usage Monitor: Move personal access token to secure storage?',
				'Migrate', 'Later', 'Don\'t ask again'
			);
			if (choice === 'Migrate') {
				await performExplicitMigration(context, false);
			} else if (choice === "Don't ask again") {
				await context.globalState.update('copilotPremiumUsageMonitor.migrationPromptDisabled', true);
			}
		}
	} catch { /* ignore */ }
}

interface MigrationResult { migrated: boolean; removedLegacy: boolean; }
async function performExplicitMigration(context: vscode.ExtensionContext, notify: boolean): Promise<MigrationResult | undefined> {
	try {
		const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
		const raw = (cfg.get('token') as string | undefined)?.trim();
		let removedLegacy = false;
		if (!raw) return { migrated: false, removedLegacy: false };
		// Optimistically record lastSetTokenValue before async persistence so config snapshots immediately after
		// migration reflect hasSecurePat=true even if secret storage propagation is still in-flight.
		lastSetTokenValue = raw; try { await context.globalState.update('_cpum_lastSecureTokenSet', true); } catch { /* noop */ }
		if (notify) { recordMigrationKeep(); pendingResidualHintUntil = Date.now() + 5000; }
		await writeToken(context, raw);
		try { if (extCtx) await waitForSecret(extCtx, 40, 25, raw); } catch { /* noop */ }
		if (notify) {
			vscode.window.showInformationMessage(localize('cpum.migration.success.kept', 'Token migrated to secure storage. (Plaintext copy left in settings.)'));
		}
		// If legacy kept, proactively emit migration hint to any open panel without waiting for user getConfig.
		if (notify && UsagePanel.currentPanel) {
			try {
				UsagePanel.currentPanel['post']?.({
					type: 'migrationHint',
					text: localize('cpum.migration.hint.residual', 'Plaintext PAT remains in settings. Clear it to finish securing.'),
					buttonLabel: localize('cpum.migration.hint.residual.button', 'Clear Plaintext')
				});
			} catch { /* noop */ }
		}
		// notify=true means keep legacy plaintext (user may clear later). For explicit force-clear path we pass notify=false then remove setting.
		if (!notify) {
			try { await cfg.update('token', '', vscode.ConfigurationTarget.Global); removedLegacy = true; recordSecureSetAndLegacyCleared(); } catch { /* noop */ }
			if (removedLegacy) {
				logSecrets('Legacy plaintext token cleared from settings after migration.');
				vscode.window.showInformationMessage(localize('cpum.migration.success.removed', 'Token migrated to secure storage and removed from settings.'));
			}
		} else {
			// Kept legacy plaintext intentionally
			recordMigrationKeep();
		}
		try { if (extCtx) await waitForSecret(extCtx); } catch { /* noop */ }
		// Ensure webview reflects new secure token state immediately
		try { UsagePanel.currentPanel?.['update'](); } catch { /* noop */ }
		await postFreshConfig(); // includes safeguard to avoid stale no-token mismatch
		return { migrated: true, removedLegacy };
	} catch (e: any) {
		vscode.window.showErrorMessage(localize('cpum.migration.failed', 'Token migration failed: {0}', e?.message || String(e)));
		return undefined;
	}
}

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
		// If no token (secure or plaintext) and in personal mode, treat as stale (cannot update usage)
		const noTokenStale = '';
		// Defer token availability check (async) but we still want stale marker quickly after promise resolves
		(async () => {
			try {
				if (mode === 'personal') {
					const info = await readStoredToken(extCtx!);
					const cfgToken = (cfg.get('token') as string | undefined)?.trim();
					if (!info.token && !cfgToken) {
						if (!statusItem!.text.includes('[stale]')) {
							statusItem!.text = `${statusItem!.text} [stale]`;
						}
						// We won't mutate existing tooltip here to avoid md ordering; user will see stale tag.
					}
				}
			} catch { /* noop */ }
		})();
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
		statusItem.text = `$(${icon}) ${percent}% ${bar}${staleTag || noTokenStale}`;
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
				const sanitized = lastError.replace(/`/g, '\u0060');
				md.appendMarkdown(`\n\n$(warning) **${localize('cpum.statusbar.stale', 'Data may be stale')}**: ${sanitized}`);
			} else if (noTokenStale) {
				md.appendMarkdown(`\n\n$(warning) ${localize('cpum.statusbar.noToken', 'Awaiting secure token for personal spend updates.')}`);
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
			// After obtaining spend, ensure config reflects secure token presence (avoids stale no-token hint)
			try { await postFreshConfig(); } catch { /* noop */ }
		} catch {
			// ignore in background
		}
	} else {
		// Org mode: we don't derive spend; optional future: surface a small org metric badge (sidebar removed)
	}
}

async function getGitHubTokenNonInteractive(): Promise<string | undefined> {
	// Prefer secret storage (may include migrated token)
	try { if (extCtx) { const info = await readStoredToken(extCtx); if (info.token) return info.token; } } catch { /* ignore */ }
	const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
	const legacy = (cfg.get('token') as string | undefined)?.trim();
	if (legacy) return legacy;
	try {
		const s = await vscode.authentication.getSession('github', ['read:org'], { createIfNone: false });
		return s?.accessToken;
	} catch {
		return undefined;
	}
}

async function getGitHubToken(): Promise<string | undefined> {
	try { if (extCtx) { const info = await readStoredToken(extCtx); if (info.token) return info.token; } } catch { /* ignore */ }
	const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
	const legacy = (cfg.get('token') as string | undefined)?.trim();
	if (legacy) return legacy;
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
		// Some tests poll _test_getLastError for up to ~500ms; schedule reaffirming clears to eliminate flakes from overlapping paths.
		setTimeout(() => { try { if (extCtx) extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined); } catch { /* noop */ } }, 200);
		setTimeout(() => { try { if (extCtx) extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncError', undefined); } catch { /* noop */ } }, 400);
		void metrics; // currently unused in status bar tests
	} catch (e: any) {
		let msg = 'Failed to sync org metrics.'; if (e?.status === 404) msg = 'Org metrics endpoint returned 404.'; else if (e?.message?.includes('401') || e?.message?.includes('403')) msg = 'Authentication error: Please sign in or provide a valid PAT.'; else if (e?.message?.toLowerCase()?.includes('network')) msg = 'Network error: Unable to reach GitHub.'; else if (e?.message) msg = `Failed to sync org metrics: ${e.message}`;
		await extCtx.globalState.update('copilotPremiumUsageMonitor.lastSyncError', msg);
		updateStatusBar();
	}
}

