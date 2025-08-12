# Copilot Premium Usage Monitor

Monitor your GitHub Copilot Premium usage and spend against a monthly budget in VS Code.

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
- copilotPremiumUsageMonitor.showLogOnError — auto-open the extension log Output Channel on the first error (default false)

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

## Running locally

1) Install deps
2) Build
3) F5 (Extension Development Host)

## Release / Changelog

See [CHANGELOG](./CHANGELOG.md).

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
