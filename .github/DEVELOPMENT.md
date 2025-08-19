# Copilot Premium Usage Monitor - Development Details

## Running locally

1) Install deps
2) Build
3) F5 (Extension Development Host)

## Development / Testing

Common scripts:

| Command | Purpose |
| ------- | ------- |
| `npm run compile` | TypeScript watch build |
| `npm test` | Unit + extension integration tests (no full coverage instrumentation) |
| `npm run test:coverage` | Unit test coverage (extension host not instrumented) |
| `npm run test:coverage:full` | Full instrumentation: unit + extension activation with combined coverage merge |
| `npm run clean` | Remove build + coverage artifacts (safe) |
| `npm run clean:full` | Deep clean (also uses `git clean -fdX`) – removes ignored/untracked build artifacts |

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

Coverage is parsed from `coverage/lcov.info` during the release job. A dynamic JSON badge is generated locally and an approximate static shields.io badge is embedded in the release body along with CI status. (A persistent README badge can be added later if desired.)