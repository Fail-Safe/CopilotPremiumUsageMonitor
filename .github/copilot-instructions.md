# Copilot Premium Usage Monitor

## Purpose

This project is intended to show the premium usage amount/cost of Copilot Premium Request SKU from https://github.com/settings/billing/budgets. This is an extension for Visual Studio Code that helps developers monitor their Copilot usage and costs more effectively.

## Features

- Real-time budget usage percentage (status bar + panel)
- Personal monthly spend (Enhanced Billing) & org engagement metrics
- Configurable warn / danger thresholds & refresh interval
- Secure PAT storage (Secret Storage) with migration from legacy plaintext setting
- Help and troubleshooting banners with log channel for diagnostics

## Requirements

- Visual Studio Code
- GitHub account with access to Copilot Pro/Pro+

## Security

PATs are stored in VS Code Secret Storage. The legacy plaintext setting is auto‑migrated and should be cleared after upgrade.