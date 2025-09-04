#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const plansPath = path.join(repoRoot, 'media', 'generated', 'copilot-plans.json');
const pkgPath = path.join(repoRoot, 'package.json');

function readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function writeJson(p, obj) {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

const plans = readJson(plansPath);
if (!plans || !Array.isArray(plans.plans)) {
    console.warn('No generated plans found at', plansPath);
    process.exit(0);
}

const pkg = readJson(pkgPath);
if (!pkg) {
    console.error('Cannot read package.json at', pkgPath);
    process.exit(1);
}

const prop = pkg.contributes && pkg.contributes.configuration && pkg.contributes.configuration.properties && pkg.contributes.configuration.properties['copilotPremiumUsageMonitor.selectedPlanId'];
if (!prop) {
    console.error('Package does not declare selectedPlanId property in contributes.configuration.properties');
    process.exit(1);
}

const ids = [''].concat(plans.plans.map(p => String(p.id || '').trim()).filter(Boolean));
prop.enum = ids;
prop.enumDescriptions = ids.map(id => {
    if (!id) return '${cpum.plans.dropdown.placeholder}';
    // Use localization key pattern used elsewhere: cpum.plans.<plan-id>
    return `\${cpum.plans.${id}}`;
});

writeJson(pkgPath, pkg);
console.log('Synchronized selectedPlanId enum with', plansPath);

// Also update package.nls.json with plan labels
const nlsPath = path.join(repoRoot, 'package.nls.json');
const nls = readJson(nlsPath) || {};
plans.plans.forEach(p => {
    const id = String(p.id || '').trim();
    if (!id) return;
    const key = `cpum.plans.${id}`;
    const included = (typeof p.included === 'number') ? ` (${p.included} included)` : '';
    nls[key] = `${p.name || id}${included}`;
});
// Ensure select button key exists
nls['cpum.plans.selectPlanButton'] = nls['cpum.plans.selectPlanButton'] || 'Select built-in plan...';
writeJson(nlsPath, nls);
console.log('Synchronized package.nls.json with plan labels');