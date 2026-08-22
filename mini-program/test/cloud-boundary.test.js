'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cloud = require('../src/utils/cloud');

test('mini program keeps face traffic off cloud transport', () => {
  assert.equal(cloud.isFaceMessage({ type:'face-status' }), true);
  assert.equal(cloud.isFaceMessage({ type:'pending-face-library' }), true);
  assert.equal(cloud.isFaceMessage({ type:'update-submission' }), false);
  assert.equal(cloud.normalizeServerUrl('https://cloud.example.com/'), 'https://cloud.example.com');
  assert.equal(cloud.normalizeServerUrl('http://cloud.example.com'), 'http://cloud.example.com');
  assert.equal(cloud.normalizeServerUrl('cloud.example.com', false), 'http://cloud.example.com');
  assert.equal(cloud.normalizeServerUrl('cloud.example.com'), 'https://cloud.example.com');
  assert.match(cloud.explainNetworkError({ errMsg:'request:fail net::ERR_SSL_PROTOCOL_ERROR' }).message, /取消“使用 HTTPS 安全连接”/);
});
