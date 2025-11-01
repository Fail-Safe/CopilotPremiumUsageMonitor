# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]
### Planned / Proposed
<!-- No unreleased items at this time. -->
<!-- Add new unreleased entries above; when releasing, these move under a version block. -->

<!-- Placeholder for upcoming release notes. -->
## [0.8.0] - 2025-11-01
### Changed
- **VSIX package size optimization**: Reduced extension download size by ~1.89 MB (96.5% reduction in media assets).
  - Resized extension icon from 512x512 to 128x128 (saved 284 KB).
  - Minified webview JavaScript with esbuild (saved 19 KB).
  - Excluded screenshots from VSIX package (saved 1.6 MB) - screenshots remain visible on Marketplace and GitHub.
- Updated VS Code engine requirement to match @types/vscode (^1.104.0).

## [0.7.2] - 2025-11-01
### Fixed
- Improved test stability by increasing timing tolerance in flaky CI test to handle variability in GitHub Actions environment.
### Changed
- Updated dependencies: @octokit/rest (22.0.1), TypeScript (5.9.3), @vscode/vsce (3.6.2), tar-fs (2.1.4), mocha, eslint stack (@typescript-eslint 8.44.0, eslint 9.36.0), and build tooling (esbuild, rimraf).
- Updated CI workflows: actions/setup-node (v6), actions/upload-artifact (v5), actions/download-artifact (v6).

## [0.7.1] - 2025-09-08
### Changed
- Updated extension icon (`media/icon.png`) for improved appearance in the Marketplace and VS Code (replaces previous icon). No runtime code changes.

## [0.7.0] - 2025-09-06
### Added
- Display of Included Premium Requests usage and remaining included units in the panel and status bar (breaks out included vs billable requests).
### Changed
 - Status bar color behavior refined for included-request state: when not using the default theme the meter uses the included-state color (blue) until included units are exhausted, after which warn/danger thresholds apply.
 - Panel tooltip and detail view now show included-request counts and a clear distinction between included and billable usage.
### Fixed
 - Fixed fallback color handling so included-state coloring does not persist after included units are consumed.
### Internal
 - Added unit and integration tests covering included-request display, tooltip breakdown, and status bar color transitions; documentation/screenshots updated accordingly.

## [0.6.2] - 2025-08-23
### Changed
- Enforced uniform 95% coverage thresholds (lines, functions, statements, branches) via nyc config; branches ratcheted up from prior staged values.
### Fixed
- Removed residual CI flakiness (org refresh network error stale path, personal 404 stale tag, auto mode routing, status bar stale indicator timing, icon override warning replay).
### Internal
- Added targeted polling / propagation wait loops and light retry logic in integration tests to stabilize async config & state assertions.
- Hardened quality gates: build now fails on any coverage regression below enforced thresholds. No user‑visible runtime changes.

## [0.6.1] - 2025-08-23
### Fixed
- Restored Changelog tab in Marketplace by re-including `CHANGELOG.md` in packaged VSIX (removed exclusion from `.vscodeignore`). No runtime code changes.

## [0.6.0] - 2025-08-23
### Added
- Separate "Last attempt" timestamp (with gating) alongside last successful sync in status bar tooltip.
- Error classification with contextual icons (network/auth/not found/token/generic) appended to "Last attempt" line.
- Internal test helper `_test_getAttemptMeta` including classification metadata for deterministic tests.

### Changed
- Tooltip formatting: conditional dual-line display (successful sync + gated attempt) with timezone & relative age refresh improvements.
- Status bar markdown capture refactored to deterministic accumulator (stabilizes tooltip-related tests).
- Gating logic broadened: attempt shown after 2 missed intervals since last success or if attempt itself is stale (>=1 interval old) or if no success yet.

### Fixed
- Flaky attempt visibility & classification tests (moved from regex tooltip scraping to internal meta assertions).
- Potential races in setting / clearing last sync error causing stale color retention.
- Minor timing instability in stale tag clearing and threshold color tests (awaited async helpers).

### Internal
- Converted test helpers `_test_setLastError` / `_test_clearLastError` to async to eliminate update races.
- Added classification text to attempt meta for direct assertion (reduces reliance on tooltip rendering order).

## [0.5.1] - 2025-08-22
### Changed
- Bundled extension with esbuild and introduced `.vscodeignore` trimming VSIX to single bundled `extension.js` plus assets (significant size reduction).
- Separated dev build (`build:dev`) from bundled packaging pipeline (`build:bundle`) to keep test artifacts intact.

### Fixed
- Flaky first-run notice test by avoiding clearing the one-time notice message after panel creation (moved reset earlier + polling).
- Race in config budget assertion (now polls for updated value ensuring post-write consistency).
- Secure token indicator timing race: extended polling for `securePatOnly` true after migration/clear latency windows.
- Intermittent org refresh tests (added pre-clear + longer polling windows for error clear / network error capture).

### Internal
- Added polling-based stabilization across integration tests (budget, secure token indicator, org refresh, first-run dismissal).
- Improved post-migration secret + legacy interplay logic test coverage without altering runtime behavior.
- Minor test timing adjustments (poll loops replacing fixed sleeps) to reduce future flakes.

### Package
- Ready for Marketplace publish following prior v0.5.0 tag; patch release captures post-tag hardening & packaging optimization.

## [0.5.0] - 2025-08-22
### Added
- Secure token indicator (pill) with dual states: green (secure only) and warning (secure + residual plaintext).
- Residual plaintext migration hint window ensuring late-opened panel still shows remediation CTA.
- Token state machine (`tokenState.ts`) with deterministic windows (assume, retain, suppress) replacing ad-hoc timing flags.
- Unit tests for residual token retention logic; expanded integration tests covering live refresh & migration edge cases.
- Layout alignment: meter, buttons (left) and mode dropdown + pill badge (right) all aligned to banner edges.
- Defensive polling & heuristic fixes reducing flakiness in secure token + no-token hint tests.
### Changed
- Migration flow consolidated; residual plaintext hint always appears when both secure + legacy tokens exist until cleared.
- Plaintext token setting deprecated messaging clarified; panel hint shows only once per getConfig cycle when relevant.
- Clear-token command now immediately ends secure assume window (more accurate post-clear indicator).
- Panel styling centered heading while keeping content edge-aligned; improved button row spacing.
### Fixed
- Race conditions where securePatOnly or residualPlaintext flags could be misclassified right after migration or clear.
- Occasional missing no-token activation hint (now reliably emitted with polling safeguard in tests).
- Potential stale org metrics error race via reaffirmed error clears.
### Internal
- Added optimistic `lastSetTokenValue` bridging secret storage latency while avoiding false securePatOnly during residual legacy.
- Extended test helpers to clear heuristic windows and lastSetTokenValue between tests.

## [0.4.7] - 2025-08-13
### Planned / Proposed
<!-- Add new unreleased entries above; when releasing, these move under a version block. -->

<!-- Placeholder for upcoming release notes. Add new sections (Added/Changed/Fixed/etc.) here. -->
### Changed
- Changelog housekeeping: deduplicated 0.4.3 duplicate entries and reset Unreleased placeholder.

## [0.4.6] - 2025-08-13
### Added
- Ability to disable warn / danger coloring by setting thresholds to 0.
### Changed
- Centralized threshold defaults: extension now reads warn/danger defaults dynamically from `package.json` (single source of truth).
- README updated to document 0=disable behavior and single-source defaults.
### Internal
- Refactored fallback literals (75/90) to use dynamic manifest-driven constants; updated tests to derive defaults from manifest.
- Added integration test to verify threshold=0 disables warn/danger status bar coloring.

## [0.4.5] - 2025-08-13
### Planned / Proposed
<!-- Add new unreleased entries above; when releasing, these move under a version block. -->

<!-- Placeholder for upcoming release notes. Add new sections (Added/Changed/Fixed/etc.) here. -->
### Changed
- Changelog housekeeping: deduplicated 0.4.3 duplicate entries and reset Unreleased placeholder.

## [0.4.4] - 2025-08-13
### Planned / Proposed
<!-- Add new unreleased entries above; when releasing, these move under a version block. -->

<!-- Placeholder for upcoming release notes. Add new sections (Added/Changed/Fixed/etc.) here. -->
### Changed
- Changelog housekeeping: deduplicated 0.4.3 duplicate entries and reset Unreleased placeholder.

## [0.4.3] - 2025-08-13
### Planned / Proposed
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
