'use strict';

function normalizeServerUrl(value) {
  const raw=String(value||'').trim().replace(/\/+$/,'');
  if(!/^https?:\/\//i.test(raw))throw new Error('服务器地址必须以 http:// 或 https:// 开头');
  const parsed=new URL(raw);
  if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('服务器地址不能包含账号、查询参数或片段');
  if(parsed.pathname!==''&&parsed.pathname!=='/')throw new Error('服务器地址不能包含路径');
  if(parsed.protocol!=='https:'&&!['localhost','127.0.0.1','::1','[::1]'].includes(parsed.hostname))throw new Error('云服务必须使用 HTTPS 加密连接');
  return parsed.toString().replace(/\/$/,'');
}
async function requestJson(serverUrl,pathname,{method='GET',body,timeout=10000}={}){
  const response=await fetch(`${normalizeServerUrl(serverUrl)}${pathname}`,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error&&payload.error.message||`云服务请求失败（${response.status}）`);
  return Object.prototype.hasOwnProperty.call(payload,'data')?payload.data:payload;
}
async function enrollClassroom(input){
  const serverUrl=normalizeServerUrl(input.serverUrl);
  const organizationSlug=String(input.organizationSlug||'').trim(),loginName=String(input.loginName||'').trim(),password=String(input.password||'');
  if(!organizationSlug||!loginName||!password)throw new Error('请输入组织标识、教室账号和初始密码');
  const installationId=String(input.installationId||'').trim();
  const body={organizationSlug,loginName,password,deviceName:String(input.deviceName||'教室电脑'),appVersion:String(input.appVersion||'')};
  if(installationId)body.installationId=installationId;
  const result=await requestJson(serverUrl,'/api/v2/devices/classrooms/login',{method:'POST',body});
  return{enabled:true,serverUrl,deviceId:result.deviceId,classroomId:result.classroomId,deviceToken:result.deviceToken,snapshot:result.snapshot||null};
}
async function revokeClassroom(config){if(!config||!config.deviceToken)return false;await requestJson(config.serverUrl,'/api/v2/devices/classrooms/revoke',{method:'POST',body:{deviceToken:config.deviceToken}});return true;}
module.exports={normalizeServerUrl,enrollClassroom,revokeClassroom};
