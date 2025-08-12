#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const pkgPath = path.join(repoRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const changelog = fs.readFileSync(changelogPath, 'utf8');

// Extract section for current version
const sectionRegex = new RegExp(`## \\[${version}\\] - .*?(?:\n## \\[|$)`, 's');
const match = changelog.match(sectionRegex);
let body = '';
if (match) {
    body = match[0].trim();
}

// Attempt to read coverage badge JSON
let coverageBadge;
try {
    coverageBadge = JSON.parse(fs.readFileSync(path.join(repoRoot, 'coverage', 'coverage-badge.json'), 'utf8'));
} catch { }
const coveragePct = coverageBadge?.message || 'N/A';

// Build shields.io workflow badge (status of CI on main)
const workflowBadge = `![CI](https://img.shields.io/github/actions/workflow/status/Fail-Safe/CopilotPremiumUsageMonitor/ci.yml?branch=main)`;
const covColor = coverageBadge?.color || 'lightgrey';
const covBadge = `![Coverage](https://img.shields.io/badge/coverage-${encodeURIComponent(coveragePct)}-${covColor})`;

const final = `${workflowBadge} ${covBadge}\n\n${body}`;
process.stdout.write(final);
