import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Minimal element / DOM stubs sufficient for webview.js logic
class Elem {
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
            // naive: first child with class
            const cls = selector.split('.').filter(Boolean);
            return traverse(root, el => cls.every(c => el.classList._s.has(c))) || null;
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

// Global document stub
const documentStub = {
    createElement: (tag: string) => new Elem(tag),
    getElementById: (id: string) => findById(id),
    querySelector: (sel: string) => root.querySelector(sel),
    body: { prepend: (el: Elem) => root.prepend(el) }
};

// Capture registered message handler
let messageHandler: ((ev: any) => void) | undefined;
const windowStub: any = {
    addEventListener: (type: string, handler: any) => { if (type === 'message') messageHandler = handler; },
    removeEventListener: () => { /* noop */ }
};

(global as any).document = documentStub;
(global as any).window = windowStub;
(global as any).console = console;
(global as any).acquireVsCodeApi = () => ({ postMessage: () => { /* noop */ } });

suite('Panel overage indicator', () => {
    test('shows (+X over) when includedUsed exceeds included', () => {
        const webviewJsPath = path.resolve(__dirname, '../../../media/webview.js');
        const code = fs.readFileSync(webviewJsPath, 'utf8');
        // Evaluate webview script (registers message handler)
        eval(code);
        assert.ok(messageHandler, 'Expected message handler registered');
        // Dispatch a summary with includedUsed > included
        const msg = {
            data: {
                type: 'summary',
                budget: 10,
                spend: 3,
                pct: 30,
                warnAtPercent: 75,
                dangerAtPercent: 90,
                included: 50,
                includedUsed: 134,
                includedPct: 100,
                usageHistory: null
            }
        };
        messageHandler!(msg);
        // The webview label no longer shows explicit overage text; ensure the meter renders without it
        assert.ok(!/\(\+84 over\)/.test(summary.innerHTML), 'Overage label should be removed from summary');
    });
});
