import * as vscode from 'vscode';

// Key under which we store the migrated PAT in the secret storage API.
const SECRET_KEY = 'copilotPremiumUsageMonitor.token';

export interface StoredTokenInfo {
    token: string | undefined;
    source: 'secretStorage' | 'settings' | 'none';
}

/**
 * Reads the PAT from secret storage first; falls back to legacy settings value if present.
 * Does NOT trigger sign-in flows; caller decides on interactive auth prompts.
 */
export async function readStoredToken(context: vscode.ExtensionContext): Promise<StoredTokenInfo> {
    let secret: string | undefined; let legacy: string | undefined;
    try { secret = await context.secrets.get(SECRET_KEY) || undefined; } catch { /* ignore */ }
    try { const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor'); legacy = (cfg.get('token') as string | undefined)?.trim(); } catch { /* ignore */ }
    if (legacy && secret && legacy !== secret) {
        // Divergence: favor plaintext source so UI can prompt user to clear/migrate and tests expecting settings precedence pass
        return { token: legacy, source: 'settings' };
    }
    if (secret) return { token: secret, source: 'secretStorage' };
    if (legacy) return { token: legacy, source: 'settings' };
    return { token: undefined, source: 'none' };
}

/** Store (or overwrite) the PAT in secure storage. */
export async function writeToken(context: vscode.ExtensionContext, token: string): Promise<void> {
    await context.secrets.store(SECRET_KEY, token);
}

/** Remove any token from secure storage. */
export async function clearToken(context: vscode.ExtensionContext): Promise<void> {
    try { await context.secrets.delete(SECRET_KEY); } catch { /* noop */ }
}

/**
 * Migrate a plaintext setting token into secret storage. Leaves the original setting untouched unless
 * `removeSetting` is true (we don't remove automatically to avoid surprising sync diffs; user can clear manually).
 */
export async function migrateSettingToken(context: vscode.ExtensionContext, removeSetting: boolean): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
    const val = (cfg.get('token') as string | undefined)?.trim();
    if (!val) return false;
    const current = await context.secrets.get(SECRET_KEY);
    if (current === val) return false; // nothing new
    await writeToken(context, val);
    if (removeSetting) {
        try { await cfg.update('token', '', vscode.ConfigurationTarget.Global); } catch { /* ignore */ }
    }
    return true;
}

export function getSecretStorageKey() { return SECRET_KEY; }
