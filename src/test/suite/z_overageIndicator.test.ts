import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Panel overage indicator', () => {
    test('shows (+X over) when includedUsed exceeds included', () => {
        // Preserve globals and install minimal stubs
        const originalDocument = (global as any).document;
        const originalWindow = (global as any).window;
        const originalAcquire = (global as any).acquireVsCodeApi;

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
                return null;
            }
            addEventListener(ev: string, fn: (...args: any[]) => void) { this._listeners[ev] = fn; }
        }
        const elementsById = new Map<string, Elem>();
        function register(el: Elem) { if (el.id) elementsById.set(el.id, el); }
        function findById(id: string) { return elementsById.get(id); }

        const root = new Elem('body');
        const summary = new Elem('div'); summary.id = 'summary'; register(summary); root.appendChild(summary);
        const controls = new Elem('div'); controls.classList.add('controls'); root.appendChild(controls);

        const documentStub = {
            createElement: (tag: string) => new Elem(tag),
            getElementById: (id: string) => findById(id),
            querySelector: (_sel: string) => null,
            body: { prepend: (el: Elem) => root.prepend(el) }
        };
        let messageHandler: ((ev: any) => void) | undefined;
        const windowStub: any = {
            addEventListener: (type: string, handler: any) => { if (type === 'message') messageHandler = handler; },
            removeEventListener: () => { /* noop */ }
        };

        (global as any).document = documentStub;
        (global as any).window = windowStub;
        (global as any).console = console;
        (global as any).acquireVsCodeApi = () => ({ postMessage: () => { /* noop */ } });

        try {
            const webviewJsPath = path.resolve(__dirname, '../../../media/webview.js');
            const code = fs.readFileSync(webviewJsPath, 'utf8');
            eval(code);
            assert.ok(messageHandler, 'Expected message handler registered');
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
            assert.ok(/\(\+84 over\)/.test(summary.innerHTML), 'Expected overage text (+84 over) in summary');
        } finally {
            // Restore globals
            (global as any).document = originalDocument;
            (global as any).window = originalWindow;
            (global as any).acquireVsCodeApi = originalAcquire;
        }
    });
});
