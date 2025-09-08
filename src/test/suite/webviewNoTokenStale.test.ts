import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { getTestGlobal, TestElement, TestDocument, TestWindow, TestVSCodeApi } from '../testGlobals';

// Minimal element / DOM stubs sufficient for webview.js logic
class Elem implements TestElement {
    id?: string;
    tag: string;
    style: any = {};
    children: Elem[] = [];
    parent?: Elem;
    textContent: string = '';
    innerHTML: string = '';
    _listeners: Record<string, (...args: any[]) => void> = {};
    classList = {
        _s: new Set<string>(),
        add: (c: string) => { this.classList._s.add(c); },
        remove: (c: string) => { this.classList._s.delete(c); },
        contains: (c: string) => this.classList._s.has(c)
    };
    constructor(tag: string) { this.tag = tag; }
    appendChild(e: Elem) { e.parent = this; this.children.push(e); if (e.id) register(e); return e; }
    prepend(e: Elem) { e.parent = this; this.children.unshift(e); if (e.id) register(e); return e; }
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); } }
    querySelector(selector: string): Elem | null {
        if (selector.startsWith('#')) return findById(selector.slice(1)) || null;
        if (selector.includes('.')) {
            // very naive: look for first child with all classes
            const classes = selector.split('.').filter(Boolean);
            return traverse(root, el => classes.every(c => el.classList._s.has(c))) || null;
        }
        return null;
    }
    addEventListener(ev: string, fn: (...args: any[]) => void) { this._listeners[ev] = fn; }
}

const elementsById = new Map<string, Elem>();
function register(el: Elem) { if (el.id) elementsById.set(el.id, el); }
function findById(id: string) { return elementsById.get(id); }
function traverse(node: Elem, pred: (e: Elem) => boolean): Elem | undefined {
    if (pred(node)) return node;
    for (const c of node.children) { const r = traverse(c, pred); if (r) return r; }
    return undefined;
}

const root = new Elem('body');
const summary = new Elem('div'); summary.id = 'summary'; register(summary); root.appendChild(summary);
const controls = new Elem('div'); controls.classList.add('controls'); root.appendChild(controls);
const rightGroup = new Elem('div'); rightGroup.classList.add('right-group'); controls.appendChild(rightGroup);
// Add elements expected by webview event listener wiring
const openSettings = new Elem('button'); openSettings.id = 'openSettings'; register(openSettings); controls.appendChild(openSettings);
const refreshBtn = new Elem('button'); refreshBtn.id = 'refresh'; register(refreshBtn); controls.appendChild(refreshBtn);
const helpBtn = new Elem('button'); helpBtn.id = 'help'; register(helpBtn); controls.appendChild(helpBtn);
const modeSelect = new Elem('select'); modeSelect.id = 'mode'; register(modeSelect); controls.appendChild(modeSelect);

// Global document stub
const documentStub: TestDocument = {
    createElement: (tag: string) => new Elem(tag),
    getElementById: (id: string) => findById(id),
    querySelector: (sel: string) => root.querySelector(sel),
    body: { prepend: (el: Elem) => root.prepend(el) }
};

// Capture registered message handler
let messageHandler: ((ev: any) => void) | undefined;
const windowStub: TestWindow = {
    addEventListener: (type: string, handler: any) => { if (type === 'message') messageHandler = handler; },
    removeEventListener: () => { /* noop */ }
};

const testGlobal = getTestGlobal();
testGlobal.document = documentStub;
testGlobal.window = windowStub;
testGlobal.console = console;
testGlobal.acquireVsCodeApi = (): TestVSCodeApi => ({ postMessage: () => { /* noop */ } });

suite('Webview stale state (no token)', () => {
    test('adds summary-error and unavailable message', () => {
        const webviewJsPath = path.resolve(__dirname, '../../../media/webview.js');
        const code = fs.readFileSync(webviewJsPath, 'utf8');
        // Evaluate webview script (registers message handler). Ensure fresh handler each run.
        messageHandler = undefined;
        eval(code);
        // Fallback to hook when addEventListener path is bypassed in Node test env
        if (!messageHandler && testGlobal.window && (testGlobal.window as any).__cpumMessageHandler) {
            messageHandler = (testGlobal.window as any).__cpumMessageHandler;
        }
        assert.ok(messageHandler, 'Expected message handler registered');
        const config = { mode: 'personal', org: '', hasSecurePat: false, residualPlaintext: false, noTokenStaleMessage: 'Awaiting secure token for personal spend updates.' };
        // Invoke as a window message event to mirror webview usage
        (messageHandler as any)({ data: { type: 'config', config } });
        const summaryEl = testGlobal.document!.getElementById('summary') as any;
        assert.ok(summaryEl && summaryEl.classList.contains('summary-error'), 'summary-error class expected on summary');
        const unavailable = (summaryEl.children || []).find((c: any) => c.id === 'summary-unavailable');
        assert.ok(unavailable, 'Expected summary-unavailable element');
        assert.match(unavailable.textContent, /Awaiting secure token/i, 'Expected awaiting token message');
    });
});
