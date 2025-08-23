import * as path from 'path';
import { globSync } from 'glob';
import Mocha from 'mocha';

// Ensure mocha globals are available (bdd interface)
// (When executed inside the VS Code extension host, globals should be injected after mocha.run is invoked)

export function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 10000 });
    const testsRoot = __dirname;
    return new Promise((resolve, reject) => {
        try {
            const files = globSync('**/*.test.js', { cwd: testsRoot });
            for (const f of files) {
                mocha.addFile(path.resolve(testsRoot, f));
            }
            mocha.loadFilesAsync().then(() => {
                mocha.run(failures => {
                    if (failures > 0) {
                        reject(new Error(`${failures} tests failed`));
                    } else {
                        resolve();
                    }
                });
            }, reject);
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}
