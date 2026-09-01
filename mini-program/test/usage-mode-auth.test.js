const assert = require('assert');

const calls = [];
global.wx = {
  request(options) {
    calls.push({ url:options.url, data:options.data, header:options.header, method:options.method });
    if (options.url.endsWith('/api/v2/auth/login')) {
      options.success({ statusCode:200, data:{ data:{
        user:{ id:'user-1', name:'张老师', nickname:'张老师', mustChangePassword:true },
        organization:{ id:'org-1', name:'示范学校', shortName:'示范校', logoUrl:'', primaryColor:'#315EFB' },
        accessToken:'access', refreshToken:'refresh', accessExpiresAt:'2099-01-01', expiresAt:'2099-02-01',
      } } });
      return;
    }
    if (options.url.endsWith('/api/v2/profile')) {
      options.success({ statusCode:200, data:{ data:{
        user:{ id:'user-1', name:options.data.name || '张老师', nickname:options.data.nickname || '张老师', mustChangePassword:false },
        organization:{ id:'org-1', name:'示范学校', shortName:'示范校', logoUrl:'', primaryColor:'#315EFB' },
      } } });
    }
  },
};

const cloudApi = require('../src/utils/cloud');

(async () => {
  const cloud = await cloudApi.loginMiniProgramAccount({ serverUrl:'https://cloud.example.com', organizationSlug:'org-demo', loginName:'teacher01', password:'default-pass', deviceName:'微信小程序' });
  assert.strictEqual(cloud.mustChangePassword, true);
  assert.strictEqual(cloud.organization.name, '示范学校');
  assert.strictEqual(cloud.organization.primaryColor, '#315EFB');
  assert.deepStrictEqual(calls[0].data, { organizationSlug:'org-demo', loginName:'teacher01', password:'default-pass', deviceName:'微信小程序' });
  assert.ok(!Object.prototype.hasOwnProperty.call(calls[0].data, 'key'));

  const httpCloud = await cloudApi.loginMiniProgramAccount({ serverUrl:'192.168.1.20:8080', useHttps:false, organizationSlug:'org-demo', loginName:'teacher01', password:'default-pass', deviceName:'微信小程序' });
  assert.strictEqual(httpCloud.serverUrl, 'http://192.168.1.20:8080');
  assert.ok(calls[1].url.startsWith('http://192.168.1.20:8080/'));

  const completed = await cloudApi.completeTeacherProfile(cloud, { name:'张老师', nickname:'张老师', newPassword:'new-password-123' });
  assert.strictEqual(completed.mustChangePassword, false);
  assert.strictEqual(calls[2].method, 'PATCH');
  assert.strictEqual(calls[2].header.authorization, 'Bearer access');

  await cloudApi.updateTeacherProfile(completed, { currentPassword:'new-password-123', newPassword:'another-password-456' });
  assert.deepStrictEqual(calls[3].data, { currentPassword:'new-password-123', newPassword:'another-password-456' });
  console.log('usage mode cloud authentication tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
