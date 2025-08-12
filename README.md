# Copilot Premium Usage Monitor

![CI](https://img.shields.io/github/actions/workflow/status/Fail-Safe/CopilotPremiumUsageMonitor/ci.yml?branch=main)
![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Fail-Safe/CopilotPremiumUsageMonitor/main/coverage/coverage-badge.json)

Monitor your GitHub Copilot Premium usage and spend against a monthly budget in VS Code.

> Coverage badge updates when the Release workflow (or a future dedicated coverage job) runs and commits the generated `coverage/coverage-badge.json` to main. Until the first release after adding this badge it may show as 0% or a cached value.

## Quick Start

1. Install extension (Marketplace search: Copilot Premium Usage Monitor).
2. Set your monthly budget in Settings to match that which you have set in GitHub for Copilot Premium Usage SKU.
3. Provide a PAT with `Plan: read-only` scope for personal spend OR sign in (read:org) for org metrics.
4. Use the command palette: "Copilot Premium Usage Monitor: Open".

## Screenshots
| Panel View | Status Bar & Tooltip |
|-----------|----------------------|
| ![Panel](./media/screenshot-panel.png) | ![Status Bar](./media/screenshot-statusbar.png) |

## Features

- Budget meter (panel + status bar)
- Org metrics (requires read:org and org permission)
- Personal spend via Enhanced Billing (requires PAT with Plan: read‑only)
- Mode selector (auto/personal/org); personal shows current month, org shows last 28 days
- Auto‑refresh (configurable)

## Install

1. Open VS Code Extensions view.
2. Search for "Copilot Premium Usage Monitor".
3. Install and reload if prompted.

Or install via CLI once published:

```
code --install-extension fail-safe.copilot-premium-usage-monitor
```

## Auth model (important)

- VS Code GitHub session (read:org): works for Organization Copilot metrics.
- Enhanced Billing `Plan: read-only`: NOT provided by VS Code session. Use a fine‑grained/classic PAT with `Plan: read-only`.
- If Enhanced Billing isn’t enabled on your account, personal spend endpoints return 404.

## Settings

- copilotPremiumUsageMonitor.budget — monthly budget (USD)
- copilotPremiumUsageMonitor.mode — auto | personal | org
- copilotPremiumUsageMonitor.org — Organization login (for Organization mode)
- copilotPremiumUsageMonitor.token — PAT (`Plan: read‑only`) for personal spend
- copilotPremiumUsageMonitor.warnAtPercent — default 80
- copilotPremiumUsageMonitor.dangerAtPercent — default 100
- copilotPremiumUsageMonitor.refreshIntervalMinutes — default 15 (min 5)
- copilotPremiumUsageMonitor.statusBarAlignment — left | right (default left)
- copilotPremiumUsageMonitor.showLogOnError — auto-open log channel on first error (default false)
- copilotPremiumUsageMonitor.useThemeStatusColor — use theme default foreground for normal state (default true)
- copilotPremiumUsageMonitor.statusBarIconOverride — optional Codicon (e.g. `graph`, `pulse`, `rocket`, `dashboard`). Invalid / unknown names: automatic icon is used and a persistent (until fixed) yellow warning banner + one‑time log message appears. Full list: https://microsoft.github.io/vscode-codicons/dist/codicon.html

## Settings Sync

- It’s safe to sync: budget, mode, org, thresholds, refresh interval.
- Do NOT sync: copilotPremiumUsageMonitor.token
  - Add to ignored settings:
    - settingsSync.ignoredSettings: ["copilotPremiumUsageMonitor.token"]

## Commands

- Copilot Premium Usage Monitor: Open
- Copilot Premium Usage Monitor: Sign in to GitHub
- Copilot Premium Usage Monitor: Choose Organization
- Copilot Premium Usage Monitor: Show Logs (opens the extension Output Channel)

## Troubleshooting

- Personal spend 404: Enhanced Billing isn’t enabled for your account yet.
- Personal spend 403: Your PAT/session lacks `Plan: read-only` permission.
- No orgs listed: Ensure read:org and membership; org may restrict visibility.
- Need more detail? Run "Copilot Premium Usage Monitor: Show Logs" or enable `copilotPremiumUsageMonitor.showLogOnError` to automatically open the log on the first error.
- Need diagnostics: Run the command "Copilot Premium Usage Monitor: Show Logs".
- Custom icon not applied: Check the panel warning banner and Output Channel for a message about `statusBarIconOverride` (unknown or malformed). Use a valid Codicon name from the list linked in settings.

## Running locally

1) Install deps
2) Build
3) F5 (Extension Development Host)

## Release / Changelog

See [CHANGELOG](./CHANGELOG.md).

### Automated Release Workflow

This repo provides a GitHub Actions workflow (Release) that can be triggered manually (workflow_dispatch):

1. Go to Actions → Release → Run workflow.
2. Choose a bump type: patch | minor | major | prepatch | preminor | premajor | prerelease | auto.
  - auto: derives bump from commit messages since last tag (BREAKING CHANGE/! => major, feat => minor, else patch).
3. (Optional) Provide preid (default: beta) for pre* / prerelease bumps.
4. Workflow enforces a clean working tree (no uncommitted changes) before proceeding.
5. Steps: bump version + CHANGELOG, commit, tag, build, run activation test (collect coverage), generate coverage badge + release notes (includes CI & coverage shields), package VSIX, create GitHub Release.
6. Optional Marketplace publish runs only if a VSCE_PAT secret is configured.

### Marketplace Publish Token (VSCE_PAT)

To enable the publish step, create a Visual Studio Marketplace Personal Access Token with publish scope and add it as a repository secret named `VSCE_PAT` (Settings → Secrets and variables → Actions → New repository secret). Omit the secret to skip publishing (useful for dry runs).

### Coverage Badge in Release Notes

Coverage is parsed from `coverage/lcov.info` during the release job. A dynamic JSON badge is generated locally and an approximate static shields.io badge is embedded in the release body along with CI status. (A persistent README badge can be added later if desired.)

## License

MIT

## Permissions & Privacy

| Functionality | Requirement | Notes |
| ------------- | ----------- | ----- |
| Personal spend (budget meter) | PAT with `Plan: read-only` | Stored in user settings if you enter it; never transmitted except to GitHub billing API. |
| Org metrics (28-day engaged users, completions) | GitHub auth session (read:org) | Uses VS Code GitHub Authentication provider. |
| Network destinations | api.github.com only | No third-party telemetry. |

No analytics or tracking is collected. Cached spend and last sync timestamps are stored locally in globalState.

## Security
See [SECURITY.md](./SECURITY.md).

## Disclaimer
Not affiliated with or endorsed by GitHub. GitHub and Copilot are trademarks of their respective owners.
