# Copilot Premium Usage Monitor – Development Guide

This document contains engineering & contributor facing details intentionally kept out of the end‑user `README.md` (optimized for the VS Code Marketplace).

---

## Local Extension Development

1. Clone & install deps
  ```bash
  git clone https://github.com/Fail-Safe/CopilotPremiumUsageMonitor.git
  cd CopilotPremiumUsageMonitor
  npm install
  ```
2. Build once (or use watch): `npm run vscode:prepublish` or `npm run compile` for watch.
3. Press F5 in VS Code (launches an Extension Development Host). The extension activates on `onStartupFinished`.
4. Use the command palette to run: "Copilot Premium Usage Monitor: Open".

Tips:
- When iterating UI in the webview, you can close/reopen via the command palette to force a fresh HTML load.
- Status bar changes react to configuration events; for manual forcing use tests or tweak a setting.

---

## Development / Testing

### Scripts Overview

| Command | Purpose |
| ------- | ------- |
| `npm run compile` | TypeScript watch build |
| `npm test` | Unit + extension integration tests (no full coverage instrumentation) |
| `npm run test:coverage` | Unit test coverage (extension host not instrumented) |
| `npm run test:coverage:full` | Full instrumentation: unit + extension activation with combined coverage merge |
| `npm run clean` | Remove build + coverage artifacts (safe) |
| `npm run clean:full` | Deep clean (also uses `git clean -fdX`) – removes ignored/untracked build artifacts |
| `npm run package` | Build a VSIX (no publish) |
| `npm run release` | Build & publish (requires `VSCE_PAT`) |

All test commands transpile TypeScript first (`vscode:prepublish`) unless already built.

### Test Structure

Location: `src/test/`

| Area | Path | Notes |
|------|------|-------|
| VS Code activation/integration | `src/test/suite/*.test.ts` | Uses `@vscode/test-electron`. Exercises command registration, webview message routing, status bar coloring. |
| Node unit tests | `src/test/unit/*.test.ts` | Run via Node test runner (`node --test`). Focus on formatting helpers. |
| Harness | `src/test/runTests.ts` | Wrapper enabling optional coverage instrumentation & environment control. |

### Coverage Modes

| Mode | Command | What it Instruments |
|------|---------|--------------------|
| Unit only | `npm run test:coverage` | Node unit tests (c8) – no extension host instrumentation |
| Full merge | `npm run test:coverage:full` | Instruments compiled JS, runs unit + activation tests, merges host + unit coverage, updates badge |

The badge JSON consumed by README uses `scripts/coverage-badge.mjs`.

### Helpful Environment Variables

| Variable | Purpose | Used In |
|----------|---------|---------|
| `CPUM_TEST_ENABLE_LOG_BUFFER` | Captures OutputChannel lines into an in‑memory buffer for assertions | Tests & runtime guard in `extension.ts` |
| `CPUM_TEST_FORCE_ORG_ERROR` | Forces an org listing error path | Org error test |
| `CPUM_COVERAGE_DIR` | Directory where extension host writes instrumentation JSON (extension + runTests) | Coverage merge scripts |

Set via the `activateWithEnv` helper in tests or shell before running coverage commands.

### Linting

`npm run lint` (ESLint + TypeScript). Add rules sparingly; keep signal high. Run before large PRs.

---

Artifacts removed by `clean` script:
- `out/` (compiled JS)
- `coverage/`, `.nyc_output/`, `.node_coverage/`
- `.tsbuildinfo`

## Cleanup Automation

The `scripts/clean-artifacts.sh` script centralizes safe removal of transient artifacts. It is referenced by the npm scripts above so local and CI workflows remain consistent.

If you add new transient directories (e.g., `dist/` or `reports/`), update both `.gitignore` and this script.

## Automated Release Workflow

This repo provides a GitHub Actions workflow (Release) that can be triggered manually (workflow_dispatch):

1. Go to Actions → Release → Run workflow.
2. Choose a bump type: patch | minor | major | prepatch | preminor | premajor | prerelease | auto.
  - auto: derives bump from commit messages since last tag (BREAKING CHANGE/! => major, feat => minor, else patch).
3. (Optional) Provide preid (default: beta) for pre* / prerelease bumps.
4. Workflow enforces a clean working tree (no uncommitted changes) before proceeding.
5. Steps: bump version + CHANGELOG, commit, tag, build, run activation test (collect coverage), generate coverage badge + release notes (includes CI & coverage shields), package VSIX, create GitHub Release.
6. Optional Marketplace publish runs only if a VSCE_PAT secret is configured.

## Marketplace Publish Token (VSCE_PAT)

To enable the publish step, create a Visual Studio Marketplace Personal Access Token with publish scope and add it as a repository secret named `VSCE_PAT` (Settings → Secrets and variables → Actions → New repository secret). Omit the secret to skip publishing (useful for dry runs).

## Coverage Badge in Release Notes
---

## Contributing Guidelines

1. Open an issue for feature proposals – align on scope before coding.
2. Keep PRs small & cohesive (one feature or fix + tests).
3. Include tests for new logic (status bar behaviors, config interactions, error flows). Prefer deterministic test env variables.
4. Avoid introducing runtime dependencies unless clearly justified (evaluate size, maintenance, security). Octokit & `vscode-nls` intentionally kept minimal.
5. Internationalization: wrap user‑facing strings in `nls.loadMessageBundle()` usage patterns when new UI text is added.
6. Security / Privacy: never add telemetry or external network endpoints; only GitHub API calls are allowed.

### Commit Conventions (for auto bump)

Release workflow supports an `auto` bump deriving semantic version from commit messages:

| Trigger | Result |
|---------|--------|
| Commit body / footer contains `BREAKING CHANGE:` or `!` after type (e.g. `feat!:`) | major |
| `feat:` conventional commit type | minor |
| Anything else | patch |

Follow standard Conventional Commits where practical (e.g., `feat:`, `fix:`, `docs:`, `refactor:`).

---

## Diagnostics Tips

- Use **Copilot Premium Usage Monitor: Show Logs** to view OutputChannel.
- Toggle `copilotPremiumUsageMonitor.showLogOnError` to auto open log on first failure.
- For status bar color debugging modify thresholds & observe immediate refresh events.
- For webview messaging issues, add temporary log lines in `_dispatch` (ensure removal before commit).

---

## Roadmap (Lightweight / Non‑binding)

Potential future improvements (open issues & PR discussion first):
| Idea | Notes |
|------|-------|
| Org spend estimation | If GitHub exposes an org cost endpoint for Copilot Premium Request SKU. |
| Export usage data | Panel action to copy current summarized metrics. |
| More granular refresh | Separate intervals or manual-only mode. |
| Status bar hover mini‑chart | Sparkline of recent percent snapshots (local only). |

---

## License

MIT (see root `LICENSE`).


Coverage is parsed from `coverage/lcov.info` during the release job. A dynamic JSON badge is generated locally and an approximate static shields.io badge is embedded in the release body along with CI status. (A persistent README badge can be added later if desired.)