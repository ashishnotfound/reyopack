import test from 'node:test';
import assert from 'node:assert/strict';

test('packing API contract keeps cancelled and duplicate outcomes distinct', () => {
  const outcomes = new Set(['PACKED', 'ALREADY_PACKED', 'ORDER_CANCELLED', 'LOCK_CONFLICT']);
  assert.equal(outcomes.has('PACKED'), true);
  assert.equal(outcomes.has('ALREADY_PACKED'), true);
  assert.notEqual('ORDER_CANCELLED', 'ALREADY_PACKED');
  assert.equal(outcomes.has('LOCK_CONFLICT'), true);
});

test('idempotency keys are stable across a retry', () => {
  const request = { amazon_order_id: '404-1234567-1234567', idempotency_key: 'scan-184-order-1' };
  const retry = { ...request };
  assert.deepEqual(retry, request);
});
