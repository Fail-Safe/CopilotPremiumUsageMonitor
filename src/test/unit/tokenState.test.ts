import test from 'node:test';
import assert from 'node:assert/strict';
import { resetAllTokenStateWindows, recordSecureSetAndLegacyCleared, recordMigrationKeep, recordSecureCleared, deriveTokenState, _test_tokenStateInternals, debugSnapshot } from '../../lib/tokenState';

void test('tokenState: secure set creates secureAssume window', () => {
    resetAllTokenStateWindows();
    const before = Date.now();
    const internals0 = _test_tokenStateInternals();
    assert.equal(internals0.legacySuppressUntil, 0);
    recordSecureSetAndLegacyCleared();
    const internals1 = _test_tokenStateInternals();
    assert.ok(internals1.secureAssumeUntil > before);
    // secure should be effective during assume window
    const nowDuringSecureAssume = Math.floor((before + internals1.secureAssumeUntil) / 2);
    const s = deriveTokenState({ secretPresent: false, legacyPresentRaw: false, now: nowDuringSecureAssume });
    assert.equal(s.hasSecure, true);
});

void test('tokenState: migration keep sets legacyRetain window', () => {
    resetAllTokenStateWindows();
    recordMigrationKeep();
    const internals = _test_tokenStateInternals();
    const nowDuringRetain = Math.floor((Date.now() + internals.legacyRetainUntil) / 2);
    const s = deriveTokenState({ secretPresent: false, legacyPresentRaw: false, now: nowDuringRetain });
    assert.equal(s.hasLegacy, true);
});

void test('tokenState: secure cleared creates suppress window', () => {
    resetAllTokenStateWindows();
    recordSecureCleared();
    const internals = _test_tokenStateInternals();
    const nowDuringSecureSuppress = Math.floor((Date.now() + internals.secureSuppressUntil) / 2);
    const s = deriveTokenState({ secretPresent: true, legacyPresentRaw: false, now: nowDuringSecureSuppress });
    assert.equal(s.hasSecure, false);
    const snap = debugSnapshot();
    assert.ok(typeof snap === 'string' && snap.includes('suppressRemaining'));
});
