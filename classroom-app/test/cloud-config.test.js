const assert=require('node:assert/strict');
const test=require('node:test');
const {enrollClassroom}=require('../cloud-config');

test('教室端使用教室账号和初始密码直接绑定',async()=>{
  const originalFetch=global.fetch;
  let captured;
  global.fetch=async(url,options)=>{
    captured={url:String(url),options};
    return{ok:true,json:async()=>({data:{deviceId:'device-1',classroomId:'room-1',deviceToken:'cd_test_token',snapshot:{type:'cloud.restore',authority:'cloud',students:[],assignments:[]}}})};
  };
  try{
    const result=await enrollClassroom({serverUrl:'https://cloud.example.com',organizationSlug:'org-demo',loginName:'room-a',password:'C-ABCD-EFGH-JK',deviceName:'教室电脑',appVersion:'2.0.0'});
    assert.equal(captured.url,'https://cloud.example.com/api/v2/devices/classrooms/login');
    assert.deepStrictEqual(JSON.parse(captured.options.body),{organizationSlug:'org-demo',loginName:'room-a',password:'C-ABCD-EFGH-JK',deviceName:'教室电脑',appVersion:'2.0.0'});
    assert.equal(result.classroomId,'room-1');
    assert.equal(result.snapshot.authority,'cloud');
  }finally{global.fetch=originalFetch;}
});
