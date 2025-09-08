import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateIncludedQuantity, type BillingUsageItem } from '../../lib/usageUtils';

void test('calculateIncludedQuantity handles basic calculation', () => {
    const copilotItems: BillingUsageItem[] = [
        {
            date: '2023-01-01',
            product: 'copilot',
            sku: 'copilot-premium',
            quantity: 100,
            unitType: 'request',
            pricePerUnit: 0.04,
            grossAmount: 4.00,
            discountAmount: 2.00,  // 50 included requests (2.00 / 0.04 = 50)
            netAmount: 2.00,
            repositoryName: undefined
        },
        {
            date: '2023-01-02',
            product: 'copilot',
            sku: 'copilot-premium',
            quantity: 200,
            unitType: 'request',
            pricePerUnit: 0.04,
            grossAmount: 8.00,
            discountAmount: 4.00,  // 100 included requests (4.00 / 0.04 = 100)
            netAmount: 4.00,
            repositoryName: undefined
        }
    ];
    
    const result = calculateIncludedQuantity(copilotItems);
    assert.equal(result, 150); // 50 + 100 = 150 total included requests
});

void test('calculateIncludedQuantity handles zero and negative prices safely', () => {
    const copilotItems: BillingUsageItem[] = [
        {
            date: '2023-01-01',
            product: 'copilot',
            sku: 'copilot-premium',
            quantity: 100,
            unitType: 'request',
            pricePerUnit: 0,  // Zero price - should be ignored
            grossAmount: 0,
            discountAmount: 2.00,
            netAmount: 0,
            repositoryName: undefined
        },
        {
            date: '2023-01-02',
            product: 'copilot',
            sku: 'copilot-premium',
            quantity: 50,
            unitType: 'request',
            pricePerUnit: -0.04,  // Negative price - should be ignored
            grossAmount: -2.00,
            discountAmount: 1.00,
            netAmount: -2.00,
            repositoryName: undefined
        },
        {
            date: '2023-01-03',
            product: 'copilot',
            sku: 'copilot-premium',
            quantity: 75,
            unitType: 'request',
            pricePerUnit: 0.04,
            grossAmount: 3.00,
            discountAmount: 1.20,  // 30 included requests (1.20 / 0.04 = 30)
            netAmount: 1.80,
            repositoryName: undefined
        }
    ];
    
    const result = calculateIncludedQuantity(copilotItems);
    assert.equal(result, 30); // Only the valid item should contribute
});

void test('calculateIncludedQuantity handles rounding correctly', () => {
    const copilotItems: BillingUsageItem[] = [
        {
            date: '2023-01-01',
            product: 'copilot',
            sku: 'copilot-premium',
            quantity: 100,
            unitType: 'request',
            pricePerUnit: 0.03,
            grossAmount: 3.00,
            discountAmount: 1.51,  // 50.333... rounds to 50 (1.51 / 0.03 = 50.333...)
            netAmount: 1.49,
            repositoryName: undefined
        },
        {
            date: '2023-01-02',
            product: 'copilot',
            sku: 'copilot-premium',
            quantity: 100,
            unitType: 'request',
            pricePerUnit: 0.03,
            grossAmount: 3.00,
            discountAmount: 1.52,  // 50.666... rounds to 51 (1.52 / 0.03 = 50.666...)
            netAmount: 1.48,
            repositoryName: undefined
        }
    ];
    
    const result = calculateIncludedQuantity(copilotItems);
    assert.equal(result, 101); // 50 + 51 = 101 (shows proper rounding)
});

void test('calculateIncludedQuantity handles empty array', () => {
    const copilotItems: BillingUsageItem[] = [];
    const result = calculateIncludedQuantity(copilotItems);
    assert.equal(result, 0);
});

void test('calculateIncludedQuantity handles string numbers safely', () => {
    const copilotItems: BillingUsageItem[] = [
        {
            date: '2023-01-01',
            product: 'copilot',
            sku: 'copilot-premium',
            quantity: 100,
            unitType: 'request',
            pricePerUnit: 0.04,
            grossAmount: 4.00,
            discountAmount: 2.00,  // 50 included requests
            netAmount: 2.00,
            repositoryName: undefined
        }
    ];
    
    const result = calculateIncludedQuantity(copilotItems);
    assert.equal(result, 50);
});