import * as assert from 'assert';
import { describe, it } from 'node:test';
// Import only pure functions without pulling VS Code at runtime (tokenState imports vscode, so we lazily require)
// Use dynamic require to allow injecting a stub for vscode before module evaluation.

// Provide a minimal vscode stub to satisfy tokenState's import (only needs workspace & ExtensionContext types at runtime = noop)
(global as any).vscode = {}; // tokenState only uses vscode for wait helper we don't call here
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deriveTokenState, recordMigrationKeep, resetAllTokenStateWindows } = require('../../lib/tokenState');

// These are pure unit tests validating timing retention behavior that backs the pending residual hint window.
// We focus on legacyRetainUntil effect (triggered by recordMigrationKeep) which ensures residualPlaintext classification
// even if the raw legacy setting temporarily appears absent; UI layer uses a separate pendingResidualHintUntil, but
// this window models similar temporal grace guaranteeing hint visibility after migration keep.

void describe('tokenState residual window', () => {
    void it('sets BOTH state immediately after migration keep when both present', () => {
        resetAllTokenStateWindows();
        // Simulate both secure + legacy present via inputs and call keep (which sets retain window + secure assume window)
        recordMigrationKeep();
        const s = deriveTokenState({ secretPresent: true, legacyPresentRaw: true });
        assert.equal(s.state, 'BOTH');
        assert.equal(s.residualPlaintext, true);
    });

    void it('retains legacy presence during retain window even if legacyPresentRaw false', async () => {
        await Promise.resolve();
        resetAllTokenStateWindows();
        recordMigrationKeep();
        // Immediately after migration, legacyPresentRaw could race to false in some scenarios; retention should keep BOTH
        const s = deriveTokenState({ secretPresent: true, legacyPresentRaw: false });
        assert.equal(s.state, 'BOTH', 'Expected BOTH due to retain window');
        assert.equal(s.residualPlaintext, true);
    });

    void it('eventually drops to SECURE_ONLY after retain window expires', async () => {
        await Promise.resolve();
        resetAllTokenStateWindows();
        recordMigrationKeep();
        // Fast-forward time by manually injecting now > LEGACY_RETAIN_MS by adding 6000ms
        const future = Date.now() + 6000; // > default 5000 retain window
        const s = deriveTokenState({ secretPresent: true, legacyPresentRaw: false, now: future });
        assert.equal(s.state, 'SECURE_ONLY');
        assert.equal(s.residualPlaintext, false);
    });
});
