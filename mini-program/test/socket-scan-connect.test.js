const assert = require('assert');

const nativeSetTimeout = global.setTimeout;
// 将身份验证的 8 秒超时压缩到 20ms，确保测试能发现响应后仍遗留的幽灵计时器。
global.setTimeout = (handler, delay, ...args) => nativeSetTimeout(handler, delay === 8000 ? 20 : delay, ...args);

let requestedUrl = '';
let connectMessage = null;
let connectionCount = 0;
global.wx = {
  connectSocket(options) {
    connectionCount += 1;
    requestedUrl = options.url;
    const handlers = {};
    const task = {
      // 模拟高速局域网：注册 onOpen 时连接已经就绪，回调会立即执行。
      onOpen(handler) { handlers.open = handler; handler(); },
      onMessage(handler) { handlers.message = handler; },
      onError(handler) { handlers.error = handler; },
      onClose(handler) { handlers.close = handler; },
      send({ data }) {
        connectMessage = JSON.parse(data);
        handlers.message({ data:JSON.stringify({
          type:'approval-required',
          message:'等待班主任批准加入',
        }) });
      },
      // 模拟微信真机：close() 可能同步触发旧 SocketTask 的 onClose。
      close() { if (handlers.close) handlers.close({ code:1000, reason:'switch room' }); },
    };
    return task;
  },
  showModal() {},
  getStorageSync() { return null; },
};

const socket = require('../src/utils/socket');

async function main() {
  socket.connect(
    { name:'旧教室', connectionCode:'178-368-056', subjects:['语文'] },
    { name:'刘逸宸', connectionId:'mini-test-account-001', subjects:[] },
  );
  await new Promise(resolve => setTimeout(resolve, 10));

  const result = await socket.waitForConnection(
    { name:'测试班级', connectionCode:'178-368-049', subjects:['数学'] },
    { name:'刘逸宸', connectionId:'mini-test-account-001', subjects:[] },
    1000,
  );
  assert.strictEqual(requestedUrl, 'ws://192.168.43.4:3456');
  assert.deepStrictEqual(connectMessage, {
    type:'connect',
    purpose:'session',
    connectionId:'mini-test-account-001',
    name:'刘逸宸',
    subjects:['数学'],
  });
  assert.strictEqual(result.status, 'pending');
  await assert.rejects(
    socket.fetchRoomSnapshot(
      { name:'测试班级', connectionCode:'178-368-049', subjects:['数学'] },
      { name:'刘逸宸', connectionId:'mini-test-account-001', subjects:[] },
      100,
    ),
    error => error && error.roomStatus === 'pending',
  );
  await new Promise(resolve => nativeSetTimeout(resolve, 50));
  assert.strictEqual(socket.getState().status, 'waiting');
  assert.strictEqual(connectionCount, 2);
  socket.disconnect();
  global.setTimeout = nativeSetTimeout;
  console.log('socket scan connection tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
