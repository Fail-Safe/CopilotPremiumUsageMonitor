import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Minimal DOM stubs for evaluating webview.js
class Elem { id?: string; tag: string; style: any = {}; children: Elem[] = []; parent?: Elem; textContent = ''; innerHTML = ''; classList = { _s: new Set<string>(), add: (c: string) => this.classList._s.add(c), remove: (c: string) => this.classList._s.delete(c), contains: (c: string) => this.classList._s.has(c) }; constructor(tag: string) { this.tag = tag; } appendChild(e: Elem) { e.parent = this; this.children.push(e); if (e.id) byId.set(e.id, e); return e; } querySelector(sel: string): Elem | null { if (sel.startsWith('#')) return (byId.get(sel.slice(1)) || null) as any; if (sel.includes('.')) { const cls = sel.split('.').filter(Boolean); return walk(root, el => cls.every(c => el.classList._s.has(c))) || null; } return null; } remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); } }
const byId = new Map<string, Elem>();
const root = new Elem('body');
const controls = new Elem('div'); controls.classList.add('controls'); root.appendChild(controls);
const rightGroup = new Elem('div'); rightGroup.classList.add('right-group'); controls.appendChild(rightGroup);
const documentStub = { createElement: (tag: string) => new Elem(tag), getElementById: (id: string) => byId.get(id), querySelector: (sel: string) => root.querySelector(sel), body: { prepend: (_: Elem) => { } } } as any;
function walk(n: Elem, pred: (e: Elem) => boolean): Elem | null { if (pred(n)) return n; for (const c of n.children) { const r = walk(c, pred); if (r) return r; } return null; }

suite('Limit source states and sidebar suppression', () => {
    async function activate(): Promise<any> { const id = 'fail-safe.copilot-premium-usage-monitor'; const ext = vscode.extensions.getExtension(id)!; await ext.activate(); return ext.exports; }

    test('status tooltip shows Limit source states (Custom / GitHub plan / Billing)', async () => {
        const api = await activate();
        const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
        // Case 1: Custom value
        await cfg.update('includedPremiumRequests', 123, vscode.ConfigurationTarget.Global);
        await cfg.update('selectedPlanId', '', vscode.ConfigurationTarget.Global);
        api._test_forceStatusBarUpdate?.();
        let md = api._test_getLastTooltipMarkdown?.() || '';
        assert.ok(/Limit source:\s*Custom value/i.test(md), `Expected 'Limit source: Custom value' in tooltip, got: ${md}`);

        // Case 2: GitHub plan
        await cfg.update('includedPremiumRequests', 0, vscode.ConfigurationTarget.Global);
        await cfg.update('selectedPlanId', 'copilot-pro', vscode.ConfigurationTarget.Global);
        api._test_forceStatusBarUpdate?.();
        md = api._test_getLastTooltipMarkdown?.() || '';
        assert.ok(/Limit source:\s*GitHub plan/i.test(md), `Expected 'Limit source: GitHub plan' in tooltip, got: ${md}`);

        // Case 3: Billing
        await cfg.update('selectedPlanId', '', vscode.ConfigurationTarget.Global);
        api._test_forceStatusBarUpdate?.();
        md = api._test_getLastTooltipMarkdown?.() || '';
        assert.ok(/Limit source:\s*Billing data/i.test(md), `Expected 'Limit source: Billing data' in tooltip, got: ${md}`);
    });

    test('webview shows Included limit source line with Billing when neither custom nor plan', () => {
        // Prepare DOM and evaluate webview.js
        (global as any).document = documentStub; (global as any).window = { addEventListener: (t: string, h: any) => { if (t === 'message') msgHandler = h; } } as any;
        (global as any).acquireVsCodeApi = () => ({ postMessage: (_: any) => { } });
        const webviewJsPath = path.resolve(__dirname, '../../../media/webview.js');
        const code = fs.readFileSync(webviewJsPath, 'utf8');
        eval(code);
        assert.ok(msgHandler, 'Expected message handler to be registered');
        // Send config with no custom included and no selected plan
        msgHandler!({ data: { type: 'config', config: { includedPremiumRequests: 0, selectedPlanId: '', generatedPlans: { plans: [] } } } });
        const src = root.querySelector('#limit-source') as Elem | null;
        assert.ok(src && /Included limit:\s*Billing data/i.test(src.textContent), `Expected Billing data line in webview, got: ${src?.textContent}`);
    });

    test('sidebar hides plan label when custom included override is active', async () => {
        const api = await activate();
        const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
        await cfg.update('selectedPlanId', 'copilot-pro', vscode.ConfigurationTarget.Global);
        await cfg.update('includedPremiumRequests', 222, vscode.ConfigurationTarget.Global);
        // Open sidebar view by executing activation code path; then request an update and inspect posted message via API where possible
        // We can't directly read the sidebar DOM here, so validate the computed mode string indirectly through the provider logic:
        const providerModule = await import('../../sidebarProvider');
        const prov: any = new (providerModule as any).CopilotUsageSidebarProvider(vscode.Uri.file('/'), (vscode.extensions.getExtension('fail-safe.copilot-premium-usage-monitor')!.exports as any)._context || { globalState: { get: () => 0 } });
        // Shim a fake webview to capture the payload
        const posts: any[] = [];
        const webviewView: any = { webview: { options: {}, html: '', onDidReceiveMessage: () => { }, postMessage: (m: any) => { posts.push(m); return Promise.resolve(true); } }, visible: true, onDidChangeVisibility: () => { } };
        await (prov as any).updateView(webviewView);
        // Find the update message and inspect mode string
        const upd = posts.find(m => m?.type === 'update');
        assert.ok(upd, 'Expected an update message from sidebar');
        const modeText = upd.data?.mode as string;
        assert.ok(!/copilot\s*pro/i.test(modeText), `Sidebar mode should suppress plan name when custom included override is active; got: ${modeText}`);
    });
});

let msgHandler: ((ev: any) => void) | undefined;