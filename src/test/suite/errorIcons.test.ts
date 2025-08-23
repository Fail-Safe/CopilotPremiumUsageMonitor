import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Status bar error icon variants', () => {
    async function activate() {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        return ext.exports;
    }

    test('404 error maps to question icon', async () => {
        const api = await activate();
        api._test_setLastError('Request failed with status 404 Not Found');
        api._test_forceStatusBarUpdate();
        const text = api._test_getStatusBarText();
        assert.ok(/\$\(question\)/.test(text), 'Expected question icon for 404');
    });

    test('401/403 auth error maps to key icon', async () => {
        const api = await activate();
        api._test_setLastError('Permission denied: 401');
        api._test_forceStatusBarUpdate();
        const text = api._test_getStatusBarText();
        assert.ok(/\$\(key\)/.test(text), 'Expected key icon for auth error');
    });

    test('network error maps to cloud-offline icon', async () => {
        const api = await activate();
        api._test_setLastError('Network timeout reached');
        api._test_forceStatusBarUpdate();
        const text = api._test_getStatusBarText();
        assert.ok(/\$\(cloud-offline\)/.test(text), 'Expected cloud-offline icon for network error');
    });

    test('generic error maps to warning icon', async () => {
        const api = await activate();
        api._test_setLastError('Unexpected failure foobar');
        api._test_forceStatusBarUpdate();
        const text = api._test_getStatusBarText();
        assert.ok(/\$\(warning\)/.test(text), 'Expected warning icon for generic error');
    });
});
