import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

suite('Coverage & Org metrics parsing', () => {
    async function activate(env: Record<string, string> = {}): Promise<any> {
        Object.assign(process.env, env);
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports;
    }

    test('writes coverage artifact when CPUM_COVERAGE_DIR set and coverage present', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpum-cov-'));
        (globalThis as any).__coverage__ = { sample: { path: 'dummy.ts', s: { '1': 1 }, statementMap: {}, b: {}, branchMap: {}, f: {}, fnMap: {} } };
        const api = await activate({ CPUM_COVERAGE_DIR: tmp });
        // Force a dump explicitly (handles case where coverage object set after activation path)
        api._test_forceCoverageDump();
        const target = path.join(tmp, 'extension-host-final.json');
        for (let i = 0; i < 10 && !fs.existsSync(target); i++) { await new Promise(r => setTimeout(r, 50)); }
        assert.ok(fs.existsSync(target), 'Expected coverage artifact file to exist');
        const content = fs.readFileSync(target, 'utf8');
        assert.ok(/sample/.test(content), 'Coverage file should contain serialized coverage data');
    });

    test('org metrics parsing aggregates engaged users & code suggestions', async () => {
        const api = await activate();
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('token', 'ORG_TOKEN', vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('copilotPremiumUsageMonitor').update('org', 'acme', vscode.ConfigurationTarget.Global);
        api._test_resetPostedMessages();
        api._test_setOctokitFactory(() => ({
            request: (route: string) => {
                if (route === 'GET /orgs/{org}/copilot/metrics') {
                    return {
                        data: [
                            { total_engaged_users: 3, copilot_ide_code_completions: { editors: [{ models: [{ languages: [{ total_code_suggestions: 10 }, { total_code_suggestions: 5 }] }] }] } },
                            { total_engaged_users: 2, copilot_ide_code_completions: { editors: [{ models: [{ languages: [{ total_code_suggestions: 7 }] }] }] } }
                        ]
                    };
                }
                if (route === 'GET /user') return { data: { login: 'tester' } };
                throw new Error('Unexpected route ' + route);
            }, paginate: () => []
        }));
        await vscode.commands.executeCommand('copilotPremiumUsageMonitor.openPanel');
        await new Promise(r => setTimeout(r, 70));
        api._test_invokeWebviewMessage({ type: 'refresh', mode: 'org' });
        await new Promise(r => setTimeout(r, 200));
        const msgs = api._test_getPostedMessages();
        const m = msgs.find((x: any) => x.type === 'metrics');
        assert.ok(m, 'Expected metrics message');
        assert.strictEqual(m.metrics.engagedUsersSum, 5, 'Engaged user sum mismatch');
        assert.strictEqual(m.metrics.codeSuggestionsSum, 22, 'Code suggestion sum mismatch');
        assert.strictEqual(m.metrics.days, 2, 'Day count mismatch');
    });
});
