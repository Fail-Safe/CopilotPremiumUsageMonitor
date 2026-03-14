import * as assert from 'assert';
import * as vscode from 'vscode';
import { CopilotUsageSidebarProvider } from '../../sidebarProvider';

suite('Sidebar provider', () => {
    test('posts update and responds to refresh/visibility', async () => {
        const id = 'fail-safe.copilot-premium-usage-monitor';
        const ext = vscode.extensions.getExtension(id)!;
        await ext.activate();
        const api: any = ext.exports;

        // Seed some state for calculateCompleteUsageData()
        await api._test_setSpendAndUpdate?.(2, 10); // 20%
        await api._test_setLastSyncTimestamp?.(Date.now());
        await api._test_setLastBilling?.({ totalQuantity: 50, totalIncludedQuantity: 1500, pricePerPremiumRequest: 0.04 });

        // Minimal mock ExtensionContext providing globalState used by provider for lastSync
        const mockContext: any = {
            globalState: {
                get: (k: string) => (k === 'copilotPremiumUsageMonitor.lastSyncTimestamp' ? Date.now() : undefined)
            },
            extensionUri: ext.extensionUri
        };

        const messages: any[] = [];
        let onReceive: ((m: any) => void) | undefined;
        let visibilityHandlers: Array<() => void> = [];

        const webviewView: any = {
            webview: {
                options: {},
                html: '',
                postMessage: async (m: any) => { messages.push(m); return true; },
                onDidReceiveMessage: (handler: any) => { onReceive = handler; return { dispose() { } }; },
            },
            onDidChangeVisibility: (handler: any) => { visibilityHandlers.push(handler); return { dispose() { } }; },
            visible: true,
        };

        const provider = new CopilotUsageSidebarProvider(ext.extensionUri, mockContext as any);
        provider.resolveWebviewView(webviewView, {} as any, {} as any);

        // Wait for the initial update message to be posted — poll to avoid flaky timing
        async function waitFor(predicate: () => boolean, timeout = 2000) {
            const start = Date.now();
            while (!predicate()) {
                if (Date.now() - start > timeout) throw new Error('Timed out waiting for condition');
                await new Promise(r => setTimeout(r, 50));
            }
        }
        await waitFor(() => messages.some(m => m?.type === 'update'));
        const firstUpdate = messages.find(m => m?.type === 'update');
        assert.ok(firstUpdate, 'Expected initial update message');
        assert.ok(typeof firstUpdate.data?.percentage === 'number', 'Update missing percentage');

        // Simulate a refresh message from the webview
        messages.length = 0;
        onReceive?.({ type: 'refresh' });
        await waitFor(() => messages.some(m => m.type === 'refreshComplete'));
        assert.ok(messages.some(m => m.type === 'refreshing'), 'Expected refreshing message');
        // Either an update will be posted, or the refresh completes with a failure; both are acceptable outcomes
        assert.ok(messages.some(m => m.type === 'update') || messages.some(m => (m.type === 'refreshComplete' && m.success === false)), 'Expected update after refresh or a failed refresh');
        assert.ok(messages.some(m => m.type === 'refreshComplete'), 'Expected refreshComplete message');

        // Simulate visibility change to visible
        messages.length = 0;
        for (const h of visibilityHandlers) h();
        await waitFor(() => messages.some(m => m.type === 'refreshComplete'));
        assert.ok(messages.some(m => m.type === 'refreshing'), 'Expected refreshing on visibility');
        // Either update will be posted or the refreshFallback triggers; both are acceptable
        assert.ok(messages.some(m => m.type === 'update') || messages.some(m => (m.type === 'refreshComplete' && m.success === false)), 'Expected update on visibility or failed refreshComplete');
        assert.ok(messages.some(m => m.type === 'refreshComplete'), 'Expected refreshComplete on visibility');
    });
});
