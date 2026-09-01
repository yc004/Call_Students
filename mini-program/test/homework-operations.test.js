const assert = require('node:assert/strict');
const test = require('node:test');
const operations = require('../src/utils/homework-operations');

test('default deadline stays in the future after 20:00', () => {
  assert.deepEqual(operations.nextDeadlineDraft(new Date(2026, 7, 31, 20, 1)), { date:'2026-09-01', time:'20:00' });
  assert.deepEqual(operations.nextDeadlineDraft(new Date(2026, 7, 31, 19, 1)), { date:'2026-08-31', time:'20:00' });
});

test('mutation confirmation checks the synchronized snapshot', () => {
  const snapshot = { assignments:[{ id:'a1',title:'练习',subject:'数学',deadline:'2026-09-02T20:00',type:'homework',submissions:{s1:'已提交'} }] };
  assert.equal(operations.mutationSatisfied({action:'add',assignmentId:'a1',title:'练习',subject:'数学',deadline:'2026-09-02T20:00',type:'homework'},snapshot),true);
  assert.equal(operations.mutationSatisfied({action:'submission',assignmentId:'a1',studentId:'s1',status:'已提交'},snapshot),true);
  assert.equal(operations.mutationSatisfied({action:'delete',assignmentId:'a2'},snapshot),true);
  assert.equal(operations.mutationSatisfied({action:'delete',assignmentId:'a1'},snapshot),false);
});
