// Simple indirection layer so secrets.ts does not import extension.ts (avoids cycle).
// extension.ts will assign a logger function after activation.

export type LoggerFn = (msg: string) => void;
let _log: LoggerFn | undefined;

export function setSecretsLogger(fn: LoggerFn) { _log = fn; }
export function logSecrets(msg: string) { try { _log?.(msg); } catch { /* noop */ } }
