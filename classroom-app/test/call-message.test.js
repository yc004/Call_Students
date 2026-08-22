'use strict';

const assert = require('assert');
const { normalizeIncomingCall } = require('../call-message');

const names = ['张同学', '李同学', '王同学', '赵同学', '陈同学', '刘同学'];
const oldSummary = '张同学、李同学、王同学等6位同学';
const normalized = normalizeIncomingCall({
  studentName:oldSummary,
  studentNames:names,
  message:`${oldSummary}，请到办公室`,
});

assert.strictEqual(normalized.studentName, names.join('、'));
assert.strictEqual(normalized.message, `${names.join('、')}同学，请到办公室`);
assert.ok(!normalized.message.includes('等6位'));

const manyNames = Array.from({ length:80 }, (_, index) => `学生${index + 1}`);
const complete = normalizeIncomingCall({
  studentName:manyNames.join('、'),
  studentNames:manyNames,
  message:`${manyNames.join('、')}同学，请到讲台`,
});
assert.strictEqual(complete.studentNames.length, 80);
assert.ok(complete.message.includes('学生80'));

const customMessage = normalizeIncomingCall({ studentName:'张三、李四', studentNames:['张三','李四'], message:'请马上到讲台' });
assert.strictEqual(customMessage.message, '张三、李四同学，请马上到讲台');

console.log('complete multi-student call message tests passed');
