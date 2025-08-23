import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        const coverageDir = process.env.CPUM_COVERAGE_DIR;
        await runTests({ extensionDevelopmentPath, extensionTestsPath, extensionTestsEnv: coverageDir ? { CPUM_COVERAGE_DIR: coverageDir } : undefined });
    } catch (err) {
        console.error('Failed to run tests');
        if (err) console.error(err);
        process.exit(1);
    }
}

void main();
