import * as fs from 'fs';
import * as path from 'path';

export interface Plan { id: string; name: string; included: number | null }
export interface PlanFile { sourceUrl: string; fetchedAt: string; pricePerPremiumRequest: number; plans: Plan[] }

export function loadGeneratedPlans(): PlanFile | null {
    // Resolve the bundled JSON relative to the extension's install path, not process.cwd().
    // __dirname at runtime points to out/lib (compiled JS). The JSON lives at ../../media/generated/.
    const candidatePaths: string[] = [];
    try {
        const relFromOut = path.resolve(__dirname, '..', '..', 'media', 'generated', 'copilot-plans.json');
        candidatePaths.push(relFromOut);
    } catch { /* noop */ }
    try {
        // Fallback for unit tests or direct repo execution where process.cwd() is the repo root
        const relFromCwd = path.resolve(process.cwd(), 'media', 'generated', 'copilot-plans.json');
        candidatePaths.push(relFromCwd);
    } catch { /* noop */ }
    try {
        for (const p of candidatePaths) {
            if (p && fs.existsSync(p)) {
                const raw = fs.readFileSync(p, 'utf8');
                return JSON.parse(raw) as PlanFile;
            }
        }
    } catch { /* noop */ }
    return null;
}

export function findPlanById(id: string | undefined): Plan | null {
    if (!id) return null;
    const f = loadGeneratedPlans();
    if (f && Array.isArray(f.plans)) {
        const hit = f.plans.find(p => p.id === id);
        if (hit) return hit;
    }
    // Fallback map for known plans when JSON is unavailable at runtime
    const fallbackPlans: Record<string, { included: number | null, name: string }> = {
        'copilot-free': { included: 50, name: 'Copilot Free' },
        'copilot-pro': { included: 300, name: 'Copilot Pro' },
        'copilot-proplus': { included: 1500, name: 'Copilot Pro+' },
        'copilot-business': { included: 300, name: 'Copilot Business' },
        'copilot-enterprise': { included: 1000, name: 'Copilot Enterprise' },
    };
    if (Object.prototype.hasOwnProperty.call(fallbackPlans, id)) {
        const planData = fallbackPlans[id];
        return { id, name: planData.name, included: planData.included };
    }
    return null;
}

// Compute suggested settings when a plan is selected. Pure function used by tests.
export function computePlanOverrides(planId: string | undefined, currentIncluded: number | null | undefined, currentPrice: number | null | undefined) {
    const gen = loadGeneratedPlans();
    if (!gen || !planId) return {};
    const plan = gen.plans.find(p => p.id === planId);
    if (!plan) return {};
    const out: { included?: number; price?: number } = {};
    const curIncluded = typeof currentIncluded === 'number' ? currentIncluded : 0;
    const curPrice = typeof currentPrice === 'number' ? currentPrice : 0.04;
    if ((!curIncluded || curIncluded === 0) && typeof plan.included === 'number' && plan.included > 0) out.included = plan.included;
    if (curPrice === 0.04 && typeof gen.pricePerPremiumRequest === 'number') out.price = gen.pricePerPremiumRequest;
    return out;
}

// Return a list of available plans, preferring generated JSON but falling back to baked-in defaults.
export function listAvailablePlans(): Plan[] {
    const gen = loadGeneratedPlans();
    if (gen && Array.isArray(gen.plans) && gen.plans.length) return gen.plans;
    const fallback: Plan[] = [
        { id: 'copilot-free', name: 'Copilot Free', included: 50 },
        { id: 'copilot-pro', name: 'Copilot Pro', included: 300 },
        { id: 'copilot-proplus', name: 'Copilot Pro+', included: 1500 },
        { id: 'copilot-business', name: 'Copilot Business', included: 300 },
        { id: 'copilot-enterprise', name: 'Copilot Enterprise', included: 1000 }
    ];
    return fallback;
}

// Get the generated price per premium request if available.
export function getGeneratedPrice(): number | undefined {
    const gen = loadGeneratedPlans();
    if (gen && typeof gen.pricePerPremiumRequest === 'number') return gen.pricePerPremiumRequest;
    return undefined;
}
