#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Arg1: directory holding extension-host.json (dumped by extension hook)
// This script APPENDS an lcov section for any instrumented extension-host files
// not already present in coverage/lcov.info (so run AFTER c8 report). It also
// stashes the raw Istanbul map for future debugging.

const dumpDir = process.argv[2] || '.node_coverage';
const hostFile = path.join(dumpDir, 'extension-host.json');
if (!fs.existsSync(hostFile)) process.exit(0);

let payload;
try { payload = JSON.parse(fs.readFileSync(hostFile, 'utf8')); } catch { process.exit(0); }
if (!payload || !payload.coverage) process.exit(0);

const coverageMap = payload.coverage; // Istanbul coverage map object

// Stash raw map
const stash = path.join(dumpDir, 'istanbul-extension-host.json');
try { fs.writeFileSync(stash, JSON.stringify(coverageMap, null, 2)); } catch { /* noop */ }

// Location of final lcov (produced by c8 earlier)
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const lcovPath = path.join(repoRoot, 'coverage', 'lcov.info');
if (!fs.existsSync(lcovPath)) {
    // If lcov not yet created we create new; badge script will still read it.
    try { fs.mkdirSync(path.join(repoRoot, 'coverage'), { recursive: true }); } catch { /* noop */ }
    fs.writeFileSync(lcovPath, '');
}

let existing = '';
try { existing = fs.readFileSync(lcovPath, 'utf8'); } catch { existing = ''; }

let appended = 0;
let sections = '';
for (const filePath of Object.keys(coverageMap)) {
    // Skip if already present
    if (existing.includes(`SF:${filePath}`)) continue;
    const fileCov = coverageMap[filePath];
    if (!fileCov || !fileCov.statementMap || !fileCov.s) continue;
    const lineHits = new Map();
    for (const [id, loc] of Object.entries(fileCov.statementMap)) {
        const hits = fileCov.s[id] || 0;
        const startLine = loc.start.line;
        // Aggregate hits by start line (approximation)
        lineHits.set(startLine, (lineHits.get(startLine) || 0) + hits);
    }
    const lines = Array.from(lineHits.keys()).sort((a, b) => a - b);
    const lf = lines.length;
    const lh = lines.filter(l => (lineHits.get(l) || 0) > 0).length;
    let section = `SF:${filePath}\n`;
    for (const ln of lines) {
        section += `DA:${ln},${lineHits.get(ln)}\n`;
    }
    section += `LF:${lf}\nLH:${lh}\nend_of_record\n`;
    sections += section;
    appended++;
}

if (appended) {
    fs.appendFileSync(lcovPath, sections);
    console.log(`[merge-extension-coverage] Appended ${appended} file(s) from extension host to lcov.`);
} else {
    console.log('[merge-extension-coverage] No new extension-host files to append.');
}
