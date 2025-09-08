/**
 * Type definitions for test environment globals to improve type safety
 * and reduce the need for 'as any' type assertions in test files.
 */

/**
 * Minimal element stub used in webview tests
 */
export interface TestElement {
    id?: string;
    tag: string;
    style: any;
    children: TestElement[];
    parent?: TestElement;
    textContent: string;
    innerHTML: string;
    _listeners: Record<string, (...args: any[]) => void>;
    classList: {
        _s: Set<string>;
        add(c: string): void;
        remove(c: string): void;
        contains(c: string): boolean;
    };
    appendChild(e: TestElement): TestElement;
    prepend(e: TestElement): TestElement;
    remove(): void;
    querySelector(selector: string): TestElement | null;
    addEventListener(ev: string, fn: (...args: any[]) => void): void;
}

/**
 * Minimal document stub used in webview tests
 */
export interface TestDocument {
    createElement(tag: string): TestElement;
    getElementById(id: string): TestElement | undefined;
    querySelector(sel: string): TestElement | null;
    body: {
        prepend(el: TestElement): void;
    };
}

/**
 * Minimal window stub used in webview tests
 */
export interface TestWindow {
    addEventListener(type: string, handler: any): void;
    removeEventListener(type?: string, handler?: any): void;
}

/**
 * Minimal VS Code API stub used in webview tests
 */
export interface TestVSCodeApi {
    postMessage(message: any): void;
}

/**
 * VS Code module stub used in unit tests
 */
export interface TestVSCodeModule {
    [key: string]: any;
}

/**
 * Extended global interface for test environment
 */
export interface TestGlobal extends NodeJS.Global {
    document?: TestDocument;
    window?: TestWindow;
    acquireVsCodeApi?: () => TestVSCodeApi;
    vscode?: TestVSCodeModule;
    console?: Console;
}

/**
 * Type-safe helper to access the global object in tests
 */
export function getTestGlobal(): TestGlobal {
    return global as TestGlobal;
}

/**
 * Type-safe helper to set test globals with proper typing
 */
export function setTestGlobals(globals: Partial<TestGlobal>): void {
    const testGlobal = getTestGlobal();
    Object.assign(testGlobal, globals);
}

/**
 * Type-safe helper to preserve and restore globals in tests
 */
export interface GlobalsBackup {
    document?: TestDocument;
    window?: TestWindow;
    acquireVsCodeApi?: () => TestVSCodeApi;
    vscode?: TestVSCodeModule;
    console?: Console;
}

export function backupGlobals(): GlobalsBackup {
    const testGlobal = getTestGlobal();
    return {
        document: testGlobal.document,
        window: testGlobal.window,
        acquireVsCodeApi: testGlobal.acquireVsCodeApi,
        vscode: testGlobal.vscode,
        console: testGlobal.console
    };
}

export function restoreGlobals(backup: GlobalsBackup): void {
    const testGlobal = getTestGlobal();
    testGlobal.document = backup.document;
    testGlobal.window = backup.window;
    testGlobal.acquireVsCodeApi = backup.acquireVsCodeApi;
    testGlobal.vscode = backup.vscode;
    testGlobal.console = backup.console;
}