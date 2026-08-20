'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cloud = require('../src/utils/cloud');

test('mini program keeps face traffic off cloud transport', () => {
  assert.equal(cloud.isFaceMessage({ type:'face-status' }), true);
  assert.equal(cloud.isFaceMessage({ type:'pending-face-library' }), true);
  assert.equal(cloud.isFaceMessage({ type:'update-submission' }), false);
  assert.equal(cloud.normalizeServerUrl('https://cloud.example.com/'), 'https://cloud.example.com');
  assert.throws(() => cloud.normalizeServerUrl('http://cloud.example.com'), /HTTPS/);
});
