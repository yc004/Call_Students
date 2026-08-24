'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../homework-test-data');
const fs = require('node:fs');
const path = require('node:path');

test('builds deterministic, removable AI homework analysis fixtures', () => {
  const students = Array.from({ length:8 }, (_, index) => ({ id:`s${index + 1}`, name:`学生${index + 1}` }));
  const options = { students, subjects:['数学','英语'], roomKey:'room-1', now:new Date('2026-08-23T10:00:00+08:00') };
  const assignments = fixtures.build(options);
  assert.equal(assignments.length, 12);
  assert.deepEqual(new Set(assignments.map(item => item.subject)), new Set(['数学','英语']));
  assert.ok(assignments.every(item => fixtures.isTestAssignment(item)));
  assert.ok(assignments.every(item => Object.keys(item.submissions).length === students.length));
  const statuses = new Set(assignments.flatMap(item => Object.values(item.submissions)));
  ['已提交','未提交','迟交','免交'].forEach(status => assert.ok(statuses.has(status)));
  assert.deepEqual(assignments, fixtures.build(options));
});

test('requires students and an authorized subject', () => {
  assert.throws(() => fixtures.build({ students:[], subjects:['数学'] }), /没有学生/);
  assert.throws(() => fixtures.build({ students:[{ id:'s1', name:'学生1' }], subjects:[] }), /授课科目/);
});

test('AI analysis dialog exposes one-click seed and safe cleanup actions', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(html, /id="seedAiTestDataBtn"/);
  assert.match(html, /id="clearAiTestDataBtn"/);
  assert.match(renderer, /seedAiHomeworkTestData/);
  assert.match(renderer, /filter\(homeworkTestData\.isTestAssignment\)/);
  assert.match(renderer, /真实作业不会受到影响/);
});
