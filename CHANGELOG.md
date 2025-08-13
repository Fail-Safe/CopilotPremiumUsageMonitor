# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]
### Planned / Proposed
- Optional command to force refresh ignoring cache.
<!-- Add new unreleased entries above; when releasing, these move under a version block. -->

<!-- Placeholder for upcoming release notes. Add new sections (Added/Changed/Fixed/etc.) here. -->
### Changed
- Changelog housekeeping: deduplicated 0.4.3 duplicate entries and reset Unreleased placeholder.

## [0.4.3] - 2025-08-13
### Planned / Proposed
- Optional command to force refresh ignoring cache.
<!-- Add new unreleased entries above; when releasing, these move under a version block. -->

### Added
- Extensive integration + message path test suite (panel commands, help counter, config replay, negative URL schemes).
- Coverage artifact export hook with `_test_forceCoverageDump` and merged instrumentation option.
- Cleanup script (`scripts/clean-artifacts.sh`) and npm scripts: `clean`, `clean:full`.
- Lifecycle hooks: `prepublishOnly` / `preversion` / `prepack` / `postversion` (auto clean + build + push tags).
- README development/testing section describing coverage and cleanup tooling.
- Activation integration test harness (launches VS Code, asserts activation + command registration).
- Automated release workflow (bump, tag, build, package, GitHub Release, optional Marketplace publish).
- Automatic semantic version detection when selecting bump type "auto" (feat => minor, BREAKING CHANGE/! => major, otherwise patch).
- Coverage badge generation (lcov parsing) and inclusion with CI status in GitHub Release notes.

### Changed
- README now includes release process guidance, test instructions, and notes about the VSCE_PAT secret.
- Raised development / CI minimum Node version to 20 (dropped 18.x from CI matrix) due to upstream dependency engine requirements.
- README expanded with Development / Testing matrix and cleanup automation documentation.

### Internal
- Working tree cleanliness guard in release workflow (fails fast if uncommitted changes exist).
- Extended `release-bump.mjs` to support auto bump detection and to emit chosen bump type.
- New helper scripts: `coverage-badge.mjs`, `extract-release-notes.mjs`.

## [0.4.2] - 2025-08-12
### Changed
- Updated extension icon (icon.png) to use a fully transparent background for better appearance in light/dark themes.
- Refined documentation: clarified persistent warning banner and transparent icon background guidance.
- Minor internal webview cleanup (removed codicon text preview logic from invalid icon warning banner).
## [0.4.1] - 2025-08-12
### Changed
- Version superseded by 0.4.2 the same day; no user‑visible changes retained.

## [0.4.0] - 2025-08-12
### Added
- Setting: `useThemeStatusColor` to improve contrast by using the theme's default status bar foreground except when warning/danger/error states apply.
- Setting: `statusBarIconOverride` to allow choosing a custom Codicon for normal (non-error) status bar state.
- In‑panel warning banner (persistent across panel opens) for invalid / unknown `statusBarIconOverride` values.
### Changed
- Status bar now uses an account icon in Personal (PAT) mode instead of the organization icon for clearer context.
- Warning banner styling updated for higher contrast & accessibility (role=alert); automatically clears when override fixed.
### Fixed / Improved
- Validation and one-time log message for malformed or unknown `statusBarIconOverride` values with safe fallback.
- Persist and replay last sync error & icon override warning when panel reopens, reducing silent failure risk.

## [0.3.0] - 2025-08-12
### Changed
- Clarified 404 error messages for personal Enhanced Billing usage and org metrics with actionable causes and documentation links.
- Added guidance suggesting switching modes (Personal/Org) when one data source is unavailable.

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
