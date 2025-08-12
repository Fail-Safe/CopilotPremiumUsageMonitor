# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]
### Planned / Proposed
- Basic activation test harness.
- CI workflow for build and packaging.
- Optional command to force refresh ignoring cache.

## [0.2.1] - 2025-08-11
### Added
- Command: Show Logs (opens extension Output Channel) for easier troubleshooting.
- Setting: showLogOnError to auto-open logs upon first runtime error.

### Changed
- Replaced console logging with OutputChannel logging and one-time gated warning; README documentation updates.

## [0.2.0] - 2025-08-12
### Removed
- Sidebar mini meter view removed to simplify extension footprint; status bar + panel retained.
### Changed
- Internal cleanup of dead code and references to the removed sidebar.

## [0.1.0] - 2025-08-11
### Added
- Initial public preview release to Marketplace.
- Status bar usage meter with stale/error indicators and relative time tooltip.
- Sidebar mini meter (optional via setting).
- Panel with budget meter, mode selector, refresh, help.
- Personal spend retrieval via Enhanced Billing (PAT with `Plan: read-only`).
- Org metrics (28-day engaged users + code suggestions) via GitHub session (read:org).
- Configurable warn/danger thresholds, refresh interval, status bar alignment.
- First-run guidance banner; re-enable command.

### Changed
- Lazy-load Octokit to reduce activation cost.
- Removed star activation; now activates on startup finished only.

### Fixed
- Stale state not clearing after successful sync.
- Relative time display stuck at 0s.

## [0.0.1] - 2025-08-10
### Added
- Prototype internal build.
