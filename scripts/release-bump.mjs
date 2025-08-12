#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkgPath = path.join(repoRoot, 'package.json');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');

let bumpType = process.env.BUMP || process.argv[2] || 'patch';
const preId = process.env.PREID || 'beta';

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

function bumpSemver(v, type) {
    const prereleaseMatch = v.match(/^(\d+)\.(\d+)\.(\d+)(-(.+))?$/);
    if (!prereleaseMatch) throw new Error('Unsupported version format: ' + v);
    let [_, major, minor, patch, _pre, preStr] = prereleaseMatch;
    let M = +major, m = +minor, p = +patch;
    const bumpMap = {
        major: () => { M++; m = 0; p = 0; return `${M}.${m}.${p}`; },
        minor: () => { m++; p = 0; return `${M}.${m}.${p}`; },
        patch: () => { p++; return `${M}.${m}.${p}`; },
        premajor: () => `${M + 1}.0.0-${preId}.0`,
        preminor: () => `${M}.${m + 1}.0-${preId}.0`,
        prepatch: () => `${M}.${m}.${p + 1}-${preId}.0`,
        prerelease: () => {
            if (!preStr) return `${M}.${m}.${p}-${preId}.0`;
            const parts = preStr.split('.');
            if (parts[0] !== preId) return `${M}.${m}.${p}-${preId}.0`;
            const num = +(parts[1] || 0) + 1;
            return `${M}.${m}.${p}-${preId}.${num}`;
        }
    };
    if (!bumpMap[type]) throw new Error('Unknown bump type: ' + type);
    return bumpMap[type]();
}

// Auto-detect bump type (major > minor > patch) when bumpType === 'auto'
if (bumpType === 'auto') {
    try {
        let lastTag = '';
        try { lastTag = execSync('git describe --tags --abbrev=0', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { }
        const rangeArg = lastTag ? `${lastTag}..HEAD` : '';
        const logCmd = `git log --pretty=%s ${rangeArg}`.trim();
        const commitMessages = execSync(logCmd, { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().split(/\r?\n/).filter(Boolean);
        const isMajor = commitMessages.some(m => /BREAKING CHANGE/.test(m) || /!:(\s|$)/.test(m));
        const isMinor = !isMajor && commitMessages.some(m => /^feat(\(|:)/.test(m));
        bumpType = isMajor ? 'major' : isMinor ? 'minor' : 'patch';
        console.log(`[auto] Derived bump type: ${bumpType}`);
    } catch (e) {
        console.warn('[auto] Failed to derive bump type, defaulting to patch:', e.message);
        bumpType = 'patch';
    }
}

const pkg = readJson(pkgPath);
const oldVersion = pkg.version;
const newVersion = bumpSemver(oldVersion, bumpType);
pkg.version = newVersion;
writeJson(pkgPath, pkg);

// Update CHANGELOG: move Unreleased content under new version if there are any bullet lines
let changelog = fs.readFileSync(changelogPath, 'utf8');
const today = new Date().toISOString().split('T')[0];
// Capture content between ## [Unreleased] and next ## [
const unreleasedRegex = /(## \[Unreleased\]([\s\S]*?))(?:\n## \[|$)/;
const match = unreleasedRegex.exec(changelog);
if (match) {
    const fullUnreleasedBlock = match[1];
    const inner = match[2];
    const hasEntries = /(^|\n)\s*-\s+/.test(inner.replace(/<!--([\s\S]*?)-->/g, ''));
    if (hasEntries) {
        const insertionHeader = `## [${newVersion}] - ${today}`;
        const idx = changelog.indexOf(fullUnreleasedBlock) + fullUnreleasedBlock.length;
        changelog = changelog.slice(0, idx) + '\n' + insertionHeader + '\n' + inner.replace(/^\n+/, '') + changelog.slice(idx);
    }
}
fs.writeFileSync(changelogPath, changelog);

console.log(`Bumped version: ${oldVersion} -> ${newVersion}`);
console.log('version=' + newVersion);
// Emit chosen bump type (useful when auto)
console.log('bumpType=' + bumpType);
