const assert = require('assert');

let requestedUrl = '';
let sentMessage = null;
let closeReason = '';

global.wx = {
  connectSocket(options) {
    requestedUrl = options.url;
    const handlers = {};
    return {
      onMessage(handler) { handlers.message = handler; },
      onError(handler) { handlers.error = handler; },
      onClose(handler) { handlers.close = handler; },
      onOpen(handler) { handlers.open = handler; handler(); },
      send({ data }) {
        sentMessage = JSON.parse(data);
        handlers.message({ data:JSON.stringify({ type:'probe-ack', className:'测试班级' }) });
      },
      close(options) { closeReason = options.reason; },
    };
  },
};

const { probeClassroom } = require('../src/utils/classroom-probe');

(async () => {
  const result = await probeClassroom({ connectionCode:'178-368-049' }, 500);
  assert.strictEqual(requestedUrl, 'ws://192.168.43.4:3456');
  assert.strictEqual(sentMessage.type, 'probe');
  assert.strictEqual(sentMessage.client, 'mini-program');
  assert.strictEqual(result.className, '测试班级');
  assert.ok(result.elapsed >= 0);
  assert.strictEqual(closeReason, 'preflight complete');
  console.log('classroom preflight probe tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
