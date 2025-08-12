#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Simple extraction of line coverage percent from lcov.info
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const lcovPath = path.join(repoRoot, 'coverage', 'lcov.info');
let percent = 0;
try {
    const data = fs.readFileSync(lcovPath, 'utf8');
    // Lines: LF:<found>  LH:<hit>
    let totalFound = 0, totalHit = 0;
    const linesFound = data.match(/LF:(\d+)/g) || [];
    const linesHit = data.match(/LH:(\d+)/g) || [];
    totalFound = linesFound.reduce((a, l) => a + +l.split(':')[1], 0);
    totalHit = linesHit.reduce((a, l) => a + +l.split(':')[1], 0);
    percent = totalFound === 0 ? 0 : +(100 * totalHit / totalFound).toFixed(1);
} catch (e) {
    console.error('Failed to read lcov.info:', e.message);
}

// Determine color
function color(p) {
    if (p >= 90) return 'brightgreen';
    if (p >= 80) return 'green';
    if (p >= 70) return 'yellowgreen';
    if (p >= 60) return 'yellow';
    if (p >= 50) return 'orange';
    return 'red';
}

const badge = {
    schemaVersion: 1,
    label: 'coverage',
    message: percent + '%',
    color: color(percent)
};
const outDir = path.join(repoRoot, 'coverage');
fs.writeFileSync(path.join(outDir, 'coverage-badge.json'), JSON.stringify(badge));
console.log('Coverage badge written with', percent + '%');
