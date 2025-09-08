import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

void test('RECENT_DATA_WINDOW_HOURS constant validation', () => {
    // Read the constants file source and validate that it contains the expected constant
    const constantsPath = path.join(__dirname, '../../../src/constants.ts');
    const constantsSource = fs.readFileSync(constantsPath, 'utf8');
    
    // Verify that RECENT_DATA_WINDOW_HOURS is defined and exported
    assert.ok(constantsSource.includes('export const RECENT_DATA_WINDOW_HOURS'), 
        'RECENT_DATA_WINDOW_HOURS should be exported from constants.ts');
        
    // Verify that it's set to 48
    assert.ok(constantsSource.includes('RECENT_DATA_WINDOW_HOURS = 48'), 
        'RECENT_DATA_WINDOW_HOURS should be set to 48');
        
    // Check that usage files import the constant
    const extensionPath = path.join(__dirname, '../../../src/extension.ts');
    const extensionSource = fs.readFileSync(extensionPath, 'utf8');
    assert.ok(extensionSource.includes('RECENT_DATA_WINDOW_HOURS'), 
        'extension.ts should import and use RECENT_DATA_WINDOW_HOURS');
        
    const usageHistoryPath = path.join(__dirname, '../../../src/lib/usageHistory.ts');
    const usageHistorySource = fs.readFileSync(usageHistoryPath, 'utf8');
    assert.ok(usageHistorySource.includes('RECENT_DATA_WINDOW_HOURS'), 
        'usageHistory.ts should import and use RECENT_DATA_WINDOW_HOURS');
});