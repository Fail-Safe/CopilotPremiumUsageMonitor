// vscode import only needed for waitForTokenState helper; delay requiring to allow pure usage in unit tests without VS Code env
// (Unit tests that need only deriveTokenState / record* APIs can proceed without vscode module present.)
// eslint-disable-next-line @typescript-eslint/no-var-requires
let vscode: any; try { vscode = require('vscode'); } catch { vscode = undefined; }

// Explicit token state machine to replace scattered heuristics.
// Windows (ms) for transitional assumptions (tuned to cover test race windows without being excessive)
const LEGACY_SUPPRESS_MS = 5000; // after clearing legacy, suppress detecting stale plaintext
const LEGACY_RETAIN_MS = 5000;   // after migration keep, retain residual classification even if config read lags
const SECURE_ASSUME_MS = 3000;   // after setting/migrating secure token, assume presence until secret read confirms

// Internal transition expiry timestamps
let legacySuppressUntil = 0;   // suppress showing legacy right after clearing
let legacyRetainUntil = 0;     // retain legacy presence after keep decision even if config returns empty
let secureAssumeUntil = 0;     // assume secure present before secret storage read catches up

export type TokenStateEnum = 'NONE' | 'LEGACY_ONLY' | 'SECURE_ONLY' | 'BOTH';

export interface DerivedTokenState {
    state: TokenStateEnum;
    hasSecure: boolean;
    hasLegacy: boolean;
    residualPlaintext: boolean; // BOTH
    securePatOnly: boolean;     // SECURE_ONLY
}

export interface DeriveInputs {
    secretPresent: boolean;
    legacyPresentRaw: boolean;
    now?: number;
}

export function recordSecureSetAndLegacyCleared() {
    const now = Date.now();
    secureAssumeUntil = now + SECURE_ASSUME_MS;
    legacySuppressUntil = now + LEGACY_SUPPRESS_MS;
    legacyRetainUntil = 0; // clear retain window
}

export function recordMigrationKeep() {
    const now = Date.now();
    secureAssumeUntil = now + SECURE_ASSUME_MS;
    legacyRetainUntil = now + LEGACY_RETAIN_MS;
    // Do not set suppress window; we *want* to treat legacy as present
}

export function recordSecureCleared() {
    secureAssumeUntil = 0;
    // legacy windows unaffected
}

export function resetAllTokenStateWindows() {
    legacySuppressUntil = 0; legacyRetainUntil = 0; secureAssumeUntil = 0;
}

export function deriveTokenState(inputs: DeriveInputs): DerivedTokenState {
    const now = inputs.now ?? Date.now();
    const legacyEffective = (inputs.legacyPresentRaw || now < legacyRetainUntil) && !(now < legacySuppressUntil);
    const secureEffective = inputs.secretPresent || now < secureAssumeUntil;
    let state: TokenStateEnum;
    if (secureEffective && legacyEffective) state = 'BOTH'; else if (secureEffective) state = 'SECURE_ONLY'; else if (legacyEffective) state = 'LEGACY_ONLY'; else state = 'NONE';
    return {
        state,
        hasSecure: secureEffective,
        hasLegacy: legacyEffective,
        residualPlaintext: state === 'BOTH',
        securePatOnly: state === 'SECURE_ONLY'
    };
}

// Simple debug snapshot (used by extension when CPUM_TEST_DEBUG_TOKEN=1)
export function debugSnapshot(): string {
    const now = Date.now();
    return `windows suppressRemaining=${Math.max(0, legacySuppressUntil - now)} retainRemaining=${Math.max(0, legacyRetainUntil - now)} secureAssumeRemaining=${Math.max(0, secureAssumeUntil - now)}`;
}

// For tests to optionally wait until a particular predicate on the derived state passes.
export async function waitForTokenState(ctx: any, predicate: (s: DerivedTokenState) => boolean, timeoutMs = 1500, pollMs = 40): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        let secretPresent = false; let legacyPresentRaw = false;
        try { if (ctx) { secretPresent = !!(await ctx.secrets.get('copilotPremiumUsageMonitor.token')); } } catch { /* noop */ }
        try { const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor'); legacyPresentRaw = !!(cfg.get('token') as string || '').trim(); } catch { /* noop */ }
        if (predicate(deriveTokenState({ secretPresent, legacyPresentRaw }))) return true;
        await new Promise(r => setTimeout(r, pollMs));
    }
    return false;
}

export const _test_tokenStateInternals = () => ({ legacySuppressUntil, legacyRetainUntil, secureAssumeUntil });
