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
- Personal Access Token (PAT) only if you explicitly place it in settings (user responsibility)

No telemetry or analytics are collected or transmitted by this extension.
