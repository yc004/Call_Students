const assert = require('assert');
const view = require('../homework-view');

const now = new Date(2026, 7, 12, 12, 0).getTime();
const assignments = [
  { id:'today', deadline:'2026-08-12T20:00', submissions:{ s1:'已提交', s2:'未提交' } },
  { id:'tomorrow', deadline:'2026-08-13T20:00', submissions:{ s1:'迟交', s2:'免交' } },
  { id:'closed', deadline:'2026-08-11T20:00', submissions:{ s1:'已提交', s2:'迟交' } },
];
assert.strictEqual(view.stageOf(assignments[0], now), 'pending');
assert.strictEqual(view.stageOf(assignments[2], now), 'closed');
assert.strictEqual(view.typeOf({}), 'homework');
assert.strictEqual(view.typeOf({type:'notice'}), 'notice');
assert.strictEqual(view.stageOf({ deadline:'2026-08-12T12:00' }, now), 'closed');
assert.deepStrictEqual(view.groupByDeadline(assignments, 'pending', now).map(group => group.label), ['今天截止', '明天截止']);
assert.deepStrictEqual(view.groupByDeadline(assignments, 'closed', now).map(group => group.label), ['昨天截止']);
assert.deepStrictEqual(view.submissionSummary(assignments[0], [{id:'s1'}, {id:'s2'}]), { submitted:1, pending:1, late:0, exempt:0, other:0, total:2, completed:1, rate:50 });
console.log('homework view tests passed');
