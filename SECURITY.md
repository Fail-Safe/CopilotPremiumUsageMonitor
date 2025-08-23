# Security Policy

## Supported Versions

Only the latest published version receives security updates.

## Reporting a Vulnerability

Please open a private security advisory or email the maintainer listed in LICENSE. Provide:
- A description of the issue and potential impact
- Steps to reproduce / proof of concept
- Suggested fix (if known)

You'll receive an acknowledgement within 3 business days.

## Scope

The extension performs outbound requests only to the GitHub REST API endpoints for Copilot metrics and billing usage. It stores:
- Configuration in VS Code settings
- Cached usage values in globalState (local only)
- Personal Access Token (PAT) in **VS Code Secret Storage** (encrypted OS keychain) once set via the secure commands
- (Deprecated) Plaintext token setting (`copilotPremiumUsageMonitor.token`) only if you intentionally re‑add it; it is auto‑migrated & cleared on first secure write

No telemetry or analytics are collected or transmitted by this extension.

### Secret Storage Notes

The extension never exports the PAT outside of requests you explicitly trigger (GitHub API calls for billing / metrics). Secret Storage access is asynchronous; brief UI “assume” windows (~2–3s) after set/clear are purely local heuristics and do **not** expose the token. If you observe the token persisting in plaintext after migration, clear the deprecated setting or run the "Clear Stored Token" command and file an issue with redacted logs.
