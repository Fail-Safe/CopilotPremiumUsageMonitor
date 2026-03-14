import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { getTestGlobal, backupGlobals, restoreGlobals, GlobalsBackup, TestElement, TestDocument, TestWindow, TestVSCodeApi } from '../testGlobals';

// Minimal DOM stubs for evaluating webview.js in-process
class Elem implements TestElement {
    id?: string; tag: string; style: any = {}; children: Elem[] = []; parent?: Elem;
    textContent = ''; innerHTML = '';
    dataset: Record<string, string | undefined> = {};
    value: string = '';
    _listeners: Record<string, (...args: any[]) => void> = {};
    _attrs: Record<string, string> = {};
    classList = { _s: new Set<string>(), add: (c: string) => this.classList._s.add(c), remove: (c: string) => this.classList._s.delete(c), contains: (c: string) => this.classList._s.has(c) };
    constructor(tag: string) { this.tag = tag; }
    appendChild(e: Elem) { e.parent = this; this.children.push(e); if (e.id) byId.set(e.id, e); return e; }
    prepend(e: Elem) { e.parent = this; this.children.unshift(e); if (e.id) byId.set(e.id, e); return e; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
    querySelector(sel: string): Elem | null { if (sel.startsWith('#')) return (byId.get(sel.slice(1)) || null) as any; if (sel.includes('.')) { const cls = sel.split('.').filter(Boolean); return walk(root, el => cls.every(c => el.classList._s.has(c))) || null; } return null; }
    addEventListener(ev: string, fn: (...args: any[]) => void) { this._listeners[ev] = fn; }
    setAttribute(name: string, value: string) { this._attrs[name] = String(value); }
    getAttribute(name: string) { return this._attrs[name] ?? null; }
}

const byId = new Map<string, Elem>();
const root = new Elem('body');
const controls = new Elem('div'); controls.classList.add('controls'); root.appendChild(controls);
const rightGroup = new Elem('div'); rightGroup.classList.add('right-group'); controls.appendChild(rightGroup);
function walk(n: Elem, pred: (e: Elem) => boolean): Elem | null { if (pred(n)) return n; for (const c of n.children) { const r = walk(c, pred); if (r) return r; } return null; }

// Elements for renderSummary
const summaryEl = new Elem('div'); summaryEl.id = 'summary'; byId.set('summary', summaryEl); root.appendChild(summaryEl);

// Parent container for usage history elements (renderMultiMonthAnalysis uses historySection.parentElement)
const historyParent = new Elem('div'); root.appendChild(historyParent);
const historySectionEl = new Elem('div'); historySectionEl.id = 'usage-history-section'; byId.set('usage-history-section', historySectionEl); historyParent.appendChild(historySectionEl);

// Elements for renderUsageHistory trend stats
const timeRangeSelectEl = new Elem('select'); timeRangeSelectEl.id = 'time-range-select'; byId.set('time-range-select', timeRangeSelectEl); historySectionEl.appendChild(timeRangeSelectEl);
const currentRateEl = new Elem('div'); currentRateEl.id = 'current-rate'; byId.set('current-rate', currentRateEl); historySectionEl.appendChild(currentRateEl);
const dailyProjectionEl = new Elem('div'); dailyProjectionEl.id = 'daily-projection'; byId.set('daily-projection', dailyProjectionEl); historySectionEl.appendChild(dailyProjectionEl);
const weeklyProjectionEl = new Elem('div'); weeklyProjectionEl.id = 'weekly-projection'; byId.set('weekly-projection', weeklyProjectionEl); historySectionEl.appendChild(weeklyProjectionEl);
const trendDirectionEl = new Elem('div'); trendDirectionEl.id = 'trend-direction'; byId.set('trend-direction', trendDirectionEl); historySectionEl.appendChild(trendDirectionEl);
const trendConfidenceEl = new Elem('div'); trendConfidenceEl.id = 'trend-confidence'; byId.set('trend-confidence', trendConfidenceEl); historySectionEl.appendChild(trendConfidenceEl);

// Pre-create multi-month section so renderMultiMonthAnalysis can toggle display without needing insertBefore
const multiMonthSectionEl = new Elem('div'); multiMonthSectionEl.id = 'multi-month-analysis-section'; byId.set('multi-month-analysis-section', multiMonthSectionEl); historyParent.appendChild(multiMonthSectionEl);

// Document stub — includes createDocumentFragment and createTextNode used by renderMultiMonthAnalysis
const documentStub: TestDocument & { createDocumentFragment?: () => Elem; createTextNode?: (t: string) => Elem } = {
    createElement: (tag: string) => new Elem(tag),
    getElementById: (id: string) => byId.get(id),
    querySelector: (sel: string) => root.querySelector(sel),
    body: { prepend: (_: Elem) => { } },
    createDocumentFragment: () => new Elem('div'),
    createTextNode: (text: string) => { const e = new Elem('#text'); e.textContent = text; return e; }
};

let msgHandler: ((ev: any) => void) | undefined;
const windowStub: TestWindow = {
    addEventListener: (type: string, handler: any) => { if (type === 'message') msgHandler = handler; },
    removeEventListener: () => { /* noop */ }
};

let globalsBackup: GlobalsBackup;

suite('Webview panel smoke tests', () => {
    suiteSetup(() => {
        globalsBackup = backupGlobals();
        const testGlobal = getTestGlobal();
        testGlobal.document = documentStub as TestDocument;
        testGlobal.window = windowStub;
        testGlobal.console = console;
        testGlobal.acquireVsCodeApi = (): TestVSCodeApi => ({ postMessage: () => { /* noop */ } });
        const code = fs.readFileSync(path.resolve(__dirname, '../../../media/webview.js'), 'utf8');
        msgHandler = undefined;
        eval(code); // eslint-disable-line no-eval
        if (!msgHandler && (windowStub as any).__cpumMessageHandler) {
            msgHandler = (windowStub as any).__cpumMessageHandler;
        }
        // Prime cfg so renderSummary has mode/org context
        (msgHandler as any)({ data: { type: 'config', config: { mode: 'personal', org: '', budget: 10, warnAtPercent: 75, dangerAtPercent: 90, includedPremiumRequests: 0, selectedPlanId: '', generatedPlans: { plans: [] } } } });
    });

    suiteTeardown(() => {
        restoreGlobals(globalsBackup);
    });

    test('no floating-point display artifacts in budget label', () => {
        assert.ok(msgHandler, 'Expected message handler to be registered');
        const spend = 0.1 + 0.2; // evaluates to 0.30000000000000004
        (msgHandler as any)({ data: { type: 'summary', budget: 10, spend, pct: 3, warnAtPercent: 75, dangerAtPercent: 90, included: 0 } });
        const snap = summaryEl.getAttribute('data-summary-snapshot') || '';
        assert.ok(/\$0\.30\b/.test(snap) || snap.includes('$0.30'), `Expected formatted $0.30 in summary snapshot, got: "${snap}"`);
        assert.ok(!snap.includes('0.30000000000000004'), `Expected no raw float in summary, got: "${snap}"`);
    });

    test('time-range selector filters snapshots correctly', () => {
        assert.ok(msgHandler, 'Expected message handler');
        const now = Date.now();
        // Three snapshots: one 15 days old (outside 7d window), two within 7 days
        const snapOld = { timestamp: now - 15 * 24 * 3600 * 1000, totalQuantity: 5 };
        const snapMid = { timestamp: now - 5 * 24 * 3600 * 1000, totalQuantity: 55 };
        const snapNew = { timestamp: now - 1 * 24 * 3600 * 1000, totalQuantity: 155 };

        // Reset dataset so renderUsageHistory wires up the 'change' listener
        timeRangeSelectEl.dataset = {};

        (msgHandler as any)({ data: { type: 'summary', budget: 10, spend: 5, pct: 50, warnAtPercent: 75, dangerAtPercent: 90, included: 0, usageHistory: { trend: { hourlyRate: 2.5, dailyProjection: 60, weeklyProjection: 420, trend: 'stable', confidence: 'medium' }, recentSnapshots: [snapOld, snapMid, snapNew] } } });

        // Initial current-rate is set from trend.hourlyRate
        assert.strictEqual(currentRateEl.textContent, '2.5', 'Initial rate should come from trend data');

        // Fire the '7d' change event — filters out snapOld, leaving snapMid+snapNew
        const changeListener = timeRangeSelectEl._listeners['change'];
        assert.ok(changeListener, 'Expected change listener on time-range-select');
        changeListener({ target: { value: '7d' } });

        // updateTrendStats([snapMid, snapNew]):
        //   timeRange = snapNew.ts - snapMid.ts = 4 days = 96 hours
        //   usageChange = 155 - 55 = 100 -> hourlyRate = 100/96 ~1.04 -> toFixed(1) = '1.0'
        assert.strictEqual(currentRateEl.textContent, '1.0', 'Rate should reflect 7d-filtered snapshots only');
    });

    test('multi-month section visible when dataMonths >= 2', () => {
        assert.ok(msgHandler, 'Expected message handler');
        const now = Date.now();
        // Reset to ensure section starts hidden
        multiMonthSectionEl.style.display = 'none';

        (msgHandler as any)({ data: { type: 'summary', budget: 10, spend: 5, pct: 50, warnAtPercent: 75, dangerAtPercent: 90, included: 0, usageHistory: { trend: { hourlyRate: 1.0, dailyProjection: 24, weeklyProjection: 168, trend: 'stable', confidence: 'medium' }, recentSnapshots: [{ timestamp: now - 2 * 24 * 3600 * 1000, totalQuantity: 10 }, { timestamp: now - 1 * 24 * 3600 * 1000, totalQuantity: 20 }], multiMonthAnalysis: { dataMonths: 3 } } } });

        const sectionEl = byId.get('multi-month-analysis-section');
        assert.ok(sectionEl, 'Expected #multi-month-analysis-section to exist in DOM');
        assert.strictEqual(sectionEl!.style.display, 'block', 'Multi-month section should be visible when dataMonths=3');
    });
});
