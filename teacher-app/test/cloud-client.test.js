'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeServerUrl, websocketUrl, isFaceMessage } = require('../cloud-client');

test('normalizes cloud endpoints and derives websocket urls', () => {
  assert.equal(normalizeServerUrl('https://cloud.example.com/'), 'https://cloud.example.com');
  assert.equal(websocketUrl('https://cloud.example.com', '/ws/v1/client'), 'wss://cloud.example.com/ws/v1/client?client=teacher-desktop&protocol=1');
  assert.throws(() => normalizeServerUrl('cloud.example.com'));
  assert.equal(normalizeServerUrl('http://cloud.example.com'), 'http://cloud.example.com');
  assert.equal(normalizeServerUrl('cloud.example.com', false), 'http://cloud.example.com');
  assert.equal(normalizeServerUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
});

test('face traffic is always classified as LAN-only', () => {
  assert.equal(isFaceMessage({ type:'face-status' }), true);
  assert.equal(isFaceMessage({ type:'pending-face-library' }), true);
  assert.equal(isFaceMessage({ type:'update-assignments' }), false);
});
