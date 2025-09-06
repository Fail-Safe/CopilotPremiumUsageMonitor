#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Release-time script to fetch Copilot plans table and generate a small JSON file
// Usage: node ./scripts/update-plan-data.mjs

const URL = 'https://docs.github.com/en/copilot/get-started/plans#comparing-copilot-plans';

async function fetchHtml(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return await res.text();
}

function extractTableRows(html) {
    // Very small and forgiving HTML extraction: find the header cells and the "Premium requests" row
    const headerMatch = html.match(/<thead>[\s\S]*?<tr>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/i);
    const headers = [];
    if (headerMatch) {
        const ths = headerMatch[1].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
        for (const th of ths) {
            const t = th.replace(/<[^>]+>/g, '').trim();
            if (t) headers.push(t);
        }
    }
    const tbodyMatch = html.match(/<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>[\s\S]*?<\/tbody>/i);
    const rowsHtml = [];
    if (tbodyMatch) {
        // get all rows
        const rows = html.match(/<tbody>[\s\S]*?<tr>[\s\S]*?<\/tr>[\s\S]*?<\/tbody>/i);
    }
    // Find the row that starts with <th>Premium requests</th>
    const premiumRowMatch = html.match(/<tr>\s*<th[^>]*>\s*Premium requests\s*<\/th>([\s\S]*?)<\/tr>/i);
    const premiumCells = [];
    if (premiumRowMatch) {
        const tds = premiumRowMatch[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
        for (const td of tds) {
            const text = td.replace(/<[^>]+>/g, '').trim();
            premiumCells.push(text);
        }
    }
    return { headers, premiumCells };
}

function parseNumberFromCell(text) {
    if (!text) return null;
    const m = text.match(/(\d+[\d,]*)/);
    if (!m) return null;
    return Number(m[1].replace(/,/g, ''));
}

async function main() {
    try {
        console.log('Fetching plans from', URL);
        const html = await fetchHtml(URL);
        const { headers, premiumCells } = extractTableRows(html);
        if (!headers.length || !premiumCells.length) {
            console.warn('Could not reliably parse plan table. Falling back to known defaults.');
        }
        // Map headers to premiumCells. The table may present a header row that includes the first
        // column as a plan name (no leading empty header) or include a leading empty header cell
        // for the row labels. Handle both cases robustly.
        const plans = [];
        if (headers.length === premiumCells.length) {
            // Direct one-to-one mapping
            for (let i = 0; i < headers.length; i++) {
                const name = headers[i] || `plan-${i}`;
                const cell = premiumCells[i] || '';
                const included = parseNumberFromCell(cell);
                const id = name.toLowerCase().replace(/\+/g, 'plus').replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
                plans.push({ id, name, included: included ?? null });
            }
        } else if (headers.length === premiumCells.length + 1) {
            // First header is the row label (e.g., empty/labels); map headers[1...] to premiumCells[0...]
            for (let i = 1; i < headers.length; i++) {
                const name = headers[i] || `plan-${i}`;
                const cell = premiumCells[i - 1] || '';
                const included = parseNumberFromCell(cell);
                const id = name.toLowerCase().replace(/\+/g, 'plus').replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
                plans.push({ id, name, included: included ?? null });
            }
        } else {
            // Fallback: attempt to map as best-effort by using the larger of the two arrays
            const max = Math.max(headers.length, premiumCells.length);
            for (let i = 0; i < max; i++) {
                const name = headers[i] || `plan-${i}`;
                const cell = premiumCells[i] || '';
                const included = parseNumberFromCell(cell);
                const id = name.toLowerCase().replace(/\+/g, 'plus').replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
                plans.push({ id, name, included: included ?? null });
            }
        }
        // If parsing failed, fall back to known mapping (reasonable defaults)
        if (!plans.length || plans.every(p => p.included === null)) {
            console.log('Using fallback plan mapping');
            plans.length = 0;
            plans.push({ id: 'copilot-free', name: 'Copilot Free', included: 50 });
            plans.push({ id: 'copilot-pro', name: 'Copilot Pro', included: 300 });
            plans.push({ id: 'copilot-pro-plus', name: 'Copilot Pro+', included: 1500 });
            plans.push({ id: 'copilot-business', name: 'Copilot Business', included: 300 });
            plans.push({ id: 'copilot-enterprise', name: 'Copilot Enterprise', included: 1000 });
        }
        const out = { sourceUrl: URL, fetchedAt: new Date().toISOString(), pricePerPremiumRequest: 0.04, plans };
        const outDir = path.join(process.cwd(), 'media', 'generated');
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, 'copilot-plans.json');
        fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
        console.log('Wrote', outPath);
    } catch (e) {
        console.error('update-plan-data failed:', e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
    }
}

main();
