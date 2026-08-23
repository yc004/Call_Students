'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cloud = require('../src/utils/cloud');

test('mini program keeps face traffic off cloud transport', () => {
  assert.equal(cloud.isFaceMessage({ type:'face-status' }), true);
  assert.equal(cloud.isFaceMessage({ type:'pending-face-library' }), true);
  assert.equal(cloud.isFaceMessage({ type:'set-face-system' }), true);
  assert.equal(cloud.isFaceMessage({ type:'update-submission' }), false);
  assert.equal(cloud.normalizeServerUrl('https://cloud.example.com/'), 'https://cloud.example.com');
  assert.equal(cloud.normalizeServerUrl('http://cloud.example.com'), 'http://cloud.example.com');
  assert.equal(cloud.normalizeServerUrl('cloud.example.com', false), 'http://cloud.example.com');
  assert.equal(cloud.normalizeServerUrl('cloud.example.com'), 'https://cloud.example.com');
  assert.match(cloud.explainNetworkError({ errMsg:'request:fail net::ERR_SSL_PROTOCOL_ERROR' }).message, /取消“使用 HTTPS 安全连接”/);
});

test('homeroom face controls use the LAN channel and expose a live camera viewer', () => {
  const page = fs.readFileSync(path.join(__dirname, '../src/pages/classroom-settings/index.js'), 'utf8');
  const markup = fs.readFileSync(path.join(__dirname, '../src/pages/classroom-settings/index.wxml'), 'utf8');
  const faceTransport = fs.readFileSync(path.join(__dirname, '../src/utils/face-lan.js'), 'utf8');
  assert.match(page, /sendFaceCommand[\s\S]*set-face-system/);
  assert.match(page, /face-preview-subscribe/);
  assert.match(page, /cameraFrame/);
  assert.match(page, /matchFace[\s\S]*sendFaceCommand/);
  assert.match(markup, /isHomeroom && tab==='faces'/);
  assert.match(markup, /<switch[^>]*bindchange="toggleFaceSystem"/);
  assert.match(markup, /class="camera-viewer"/);
  assert.match(faceTransport, /face-camera-frame/);
  assert.match(faceTransport, /send\(data\)/);
});

test('attendance page tells every teacher when classroom face recognition is paused', () => {
  const page = fs.readFileSync(path.join(__dirname, '../src/pages/attendance/index.js'), 'utf8');
  const markup = fs.readFileSync(path.join(__dirname, '../src/pages/attendance/index.wxml'), 'utf8');
  assert.match(page, /faceSystemStateKnown/);
  assert.match(page, /event==='faceSystemState'/);
  assert.match(page, /data\.faceSystemEnabled===true/);
  assert.match(markup, /教室人脸识别已关闭/);
  assert.match(markup, /识别已暂停/);
});
