'use strict';

const assert = require('assert');
const connectionCode = require('../src/utils/connection-code');

const sentMessages = [];
const handlers = {};
const task = {
  onOpen(handler) { handlers.open = handler; },
  onMessage(handler) { handlers.message = handler; },
  onError(handler) { handlers.error = handler; },
  onClose(handler) { handlers.close = handler; },
  send({ data }) {
    const message = JSON.parse(data);
    sentMessages.push(message);
    if (message.type === 'connect') {
      queueMicrotask(() => handlers.message({ data: JSON.stringify({ type: 'sync' }) }));
    } else if (message.type === 'leave-classroom') {
      queueMicrotask(() => handlers.message({ data: JSON.stringify({ type: 'leave-classroom-ack', removed: true }) }));
    }
  },
  close() { if (handlers.close) queueMicrotask(handlers.close); },
};

global.wx = {
  connectSocket() {
    queueMicrotask(() => handlers.open());
    return task;
  },
  showModal() {},
};

const socket = require('../src/utils/socket');

(async () => {
  const room = { name: '测试教室', connectionCode: connectionCode.encode('192.168.1.2'), subjects: ['数学'] };
  const account = { name: '测试教师', connectionId: 'teacher-test-001', subjects: [] };
  const result = await socket.leaveClassroom(room, account, 500);
  assert.strictEqual(result.removed, true);
  assert.deepStrictEqual(sentMessages.map(message => message.type), ['connect', 'leave-classroom']);
  assert.strictEqual(sentMessages[0].connectionId, account.connectionId);
  assert.deepStrictEqual(sentMessages[0].subjects, ['数学']);
  console.log('socket leave-classroom tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
