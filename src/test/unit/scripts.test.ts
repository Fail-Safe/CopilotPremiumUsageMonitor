import test from 'node:test';
import assert from 'node:assert/strict';

test('update-plan-data: parses table headers and premium cells', async () => {
    const { extractTableRows, parseNumberFromCell } = (await import('../../../scripts/update-plan-data.mjs')) as any;
    const html = `
      <table>
        <thead>
          <tr><th></th><th>Free</th><th>Pro</th><th>Pro+</th></tr>
        </thead>
        <tbody>
          <tr><th>Premium requests</th><td>50</td><td>300</td><td>1,500</td></tr>
        </tbody>
      </table>
    `;
    const { headers, premiumCells } = extractTableRows(html);
    // Some HTML variants include an empty leading header for label column.
    if (headers.length === 4 && headers[0] === '') {
        assert.deepEqual(headers, ['', 'Free', 'Pro', 'Pro+']);
    } else {
        assert.deepEqual(headers, ['Free', 'Pro', 'Pro+']);
    }
    assert.deepEqual(premiumCells, ['50', '300', '1,500']);
    assert.strictEqual(parseNumberFromCell('1,500'), 1500);
});

test('release-bump: sanitizes changelog inner content to avoid script tags', async () => {
    const { sanitizeChangelogInner } = (await import('../../../scripts/release-bump.mjs')) as any;
    const raw = '\n- Fix: something\n<script>alert(1)</script>\n';
    const out = sanitizeChangelogInner(raw);
    assert.ok(out.includes('&lt;script'), 'Expected sanitized string to replace <script with &lt;script');
    assert.ok(!out.includes('<script'), 'No literal <script should remain');
});
