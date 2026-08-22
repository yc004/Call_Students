'use strict';

const assert = require('assert');

let modalOptions = null;
let copiedText = '';
global.getCurrentPages = () => [{ route:'pages/home/index' }];
global.wx = {
  getSystemInfoSync: () => ({ platform:'android', system:'Android 15', model:'Test Phone', version:'8.0.50', SDKVersion:'3.16.2' }),
  getAccountInfoSync: () => ({ miniProgram:{ version:'1.2.3' } }),
  showModal: options => { modalOptions = options; },
  setClipboardData: options => { copiedText = options.data; options.success && options.success(); },
  showToast: () => {},
};

const reporter = require('../src/utils/error-report');
const report = reporter.show({
  title:'连接失败',
  context:'测试连接',
  error:new Error('request failed token=abc123 password=secret'),
  suggestions:['检查网络'],
});

assert.ok(modalOptions, 'should open an error modal');
assert.match(modalOptions.content, /提交给管理员/);
assert.strictEqual(modalOptions.confirmText, '复制信息');
assert.match(report, /班达微信小程序错误报告/);
assert.match(report, /页面：pages\/home\/index/);
assert.doesNotMatch(report, /abc123|password=secret/);
assert.match(report, /token=\[已隐藏\]/i);

modalOptions.success({ confirm:true });
assert.strictEqual(copiedText, report);
modalOptions.complete();

console.log('mini-program error report tests passed');
