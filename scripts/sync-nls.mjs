import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const masterPath = path.join(root, 'package.nls.json');
if (!fs.existsSync(masterPath)) {
    console.error('master file not found:', masterPath);
    process.exit(1);
}
const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));

const files = fs.readdirSync(root).filter(f => /^package\.nls(\.[^.]+)?\.json$/.test(f));

for (const file of files) {
    const p = path.join(root, file);
    if (p === masterPath) continue;
    try {
        const current = JSON.parse(fs.readFileSync(p, 'utf8'));
        const merged = {};
        // preserve master's key order
        for (const k of Object.keys(master)) {
            if (Object.prototype.hasOwnProperty.call(current, k)) merged[k] = current[k];
            else merged[k] = master[k];
        }
        // also include any extra keys present in current that are not in master (append)
        for (const k of Object.keys(current)) {
            if (!Object.prototype.hasOwnProperty.call(merged, k)) merged[k] = current[k];
        }
        fs.writeFileSync(p, JSON.stringify(merged, null, 4) + '\n', 'utf8');
        console.log('synced', file);
    } catch (e) {
        console.error('failed to sync', file, e.message);
    }
}

console.log('done');
