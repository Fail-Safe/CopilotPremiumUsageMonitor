# Copilot Premium Usage Monitor

Monitor your GitHub Copilot Premium usage and spend against a monthly budget in VS Code.

## Features

- Budget meter (panel, Status Bar, Sidebar mini view)
- Org metrics (requires read:org and org permission)
- Personal spend via Enhanced Billing (requires PAT with Plan: read‑only)
- Mode selector (auto/personal/org); personal shows current month, org shows last 28 days
- Auto‑refresh (configurable)

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

## Settings Sync

- It’s safe to sync: budget, mode, org, thresholds, refresh interval.
- Do NOT sync: copilotPremiumUsageMonitor.token
  - Add to ignored settings:
    - settingsSync.ignoredSettings: ["copilotPremiumUsageMonitor.token"]

## Commands

- Copilot Premium Usage Monitor: Open
- Copilot Premium Usage Monitor: Sign in to GitHub
- Copilot Premium Usage Monitor: Choose Organization

## Troubleshooting

- Personal spend 404: Enhanced Billing isn’t enabled for your account yet.
- Personal spend 403: Your PAT/session lacks `Plan: read-only` permission.
- No orgs listed: Ensure read:org and membership; org may restrict visibility.

## Running locally

1) Install deps
2) Build
3) F5 (Extension Development Host)
