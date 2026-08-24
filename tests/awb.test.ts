import test from 'node:test';
import assert from 'node:assert/strict';
import { isAmazonOrderId, normalizeAwb, normalizeBarcode } from '@/lib/domain/awb';

test('normalizes scanner whitespace and dash variants', () => {
  assert.equal(normalizeBarcode('  3713\u201317  811 994 '), '3713-17811994');
});

test('validates a usable AWB', () => {
  assert.equal(normalizeAwb(' 371317811994 '), '371317811994');
  assert.throws(() => normalizeAwb('x'));
});

test('recognizes Amazon order IDs only in the expected format', () => {
  assert.equal(isAmazonOrderId('404-1234567-1234567'), true);
  assert.equal(isAmazonOrderId('371317811994'), false);
});
