const socket = require('../../utils/socket');
const roomContext = require('../../utils/room-context');
const { sessionStore } = require('../../utils/session');
const { parseStudentNames } = require('../../utils/student-list');
const sharedRoom = require('../../utils/shared-room');
const errorReport = require('../../utils/error-report');
const subjectOptions = require('../../utils/subject-options');
const shareCard = require('../../utils/share-card');
const faceLan = require('../../utils/face-lan');

function teacherView(item, currentId) {
  const id = item.connection_id || '';
  const subjects = item.subjects || [];
  return { ...item, id, avatar:String(item.name||'教').slice(0,1),isSelf:id===currentId,isHomeroom:item.role==='班主任',subjectValue:subjects.join('、'),subjectText:subjects.join('、') || '尚未设置授课科目',shortId:id.slice(-8) };
}

Page({
  data:{tab:'students',status:'connecting',statusText:'正在连接教室',className:'',connectionCode:'',isCloudRoom:false,permissionsReady:false,isHomeroom:false,teacherRole:'正在验证身份',students:[],approvedTeachers:[],pendingTeachers:[],pendingFaces:[],studentNames:[],saving:false,managingTeacherId:'',onboarding:false,onboardingStep:1,batchVisible:false,batchText:'',batchCount:0,faceSystemEnabled:false,faceLanAvailable:false,faceLanMessage:'正在连接教室局域网',faceControlBusy:false,cameraPreviewVisible:false,cameraFrame:'',cameraStatus:'等待教室画面'},
  onLoad(options){
    this.guideRequested=options.guide==='1';
    const result=roomContext.activateByCode(options.code);
    if(!result){wx.showToast({title:'教室不存在',icon:'none'});wx.navigateBack();return;}
    this.room=result.room;this.account=result.session.account;
    this.setData({className:this.room.name||'',connectionCode:this.room.connectionCode||'',isCloudRoom:!!this.room.cloudClassroomId});
    this.unsubscribe=socket.subscribe((event,payload)=>{
      if(event==='status'){
        this.setData({status:payload.status,statusText:payload.message});
        if(!this.data.isCloudRoom)this.setData({faceLanAvailable:payload.status==='online',faceLanMessage:payload.status==='online'?'局域网人脸服务已连接':payload.message});
      }else if(event==='sync')this.applyRoomSync(payload,false);
      else if(event==='pendingFaces')this.applyFaces(payload.faces||[]);
      else if(event==='faceSystemState')this.applyFaceSystemState(payload);
      else if(event==='facePreviewState')this.applyFacePreviewState(payload);
      else if(event==='faceCameraFrame')this.applyCameraFrame(payload);
      else if(event==='error'){this.setData({managingTeacherId:'',faceControlBusy:false});wx.showToast({title:payload.message||'操作失败',icon:'none'});}
    });
    socket.connect(this.room,this.account,{force:true});
    if(this.data.isCloudRoom)this.connectFaceLan();
  },
  onUnload(){
    clearTimeout(this.cameraWaitTimer);
    if(this.data.cameraPreviewVisible)this.sendFaceCommand({type:'face-preview-subscribe',enabled:false});
    if(this.unsubscribe)this.unsubscribe();
    if(this.faceLanConnection)this.faceLanConnection.close();
  },
  applyRoomSync(data,fromFaceLan=false){const isHomeroom=!!(data.teacher&&data.teacher.role==='班主任');const wasHomeroom=this.data.permissionsReady&&this.data.isHomeroom;const faceState={};if(!this.data.isCloudRoom||fromFaceLan){faceState.faceSystemEnabled=data.faceSystemEnabled===true;faceState.faceLanAvailable=true;faceState.faceLanMessage='局域网人脸服务已连接';}this.setData({permissionsReady:true,isHomeroom,teacherRole:data.teacher&&data.teacher.role||'任课教师',className:data.className||this.room.name||'',connectionCode:this.room.connectionCode||'',onboarding:isHomeroom?this.data.onboarding:false,...faceState});if(isHomeroom)this.applySync(data);else if(wasHomeroom&&!this.transferNoticeShown){this.transferNoticeShown=true;if(this.alertEnabled&&wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload();wx.showModal({title:'班主任身份已转让',content:'你现在是该教室的普通任课教师，仍可在这里退出教室。',showCancel:false});}},
  applySync(data){if(!data.teacher||data.teacher.role!=='班主任'){if(this.permissionExitPending)return;this.permissionExitPending=true;if(this.alertEnabled&&wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload();wx.showModal({title:'班主任身份已转让',content:'你现在是该教室的普通任课教师，班级管理权限已经交接给新班主任。',showCancel:false,confirmText:'返回首页',success:()=>wx.switchTab({url:'/pages/home/index'})});return;}const needsSetup=data.classroomConfigured===false;const wasOnboarding=this.data.onboarding;this.currentTeacherId=data.teacher.connectionId;if(!this.hasInitialSync){this.hasInitialSync=true;this.setData({className:data.className||this.room.name||'',students:(data.students||[]).map(item=>({...item})),studentNames:(data.students||[]).map(item=>item.name)});}this.setData({onboarding:needsSetup,managingTeacherId:'',approvedTeachers:((data.teachers&&data.teachers.approved)||[]).map(item=>teacherView(item,this.currentTeacherId)),pendingTeachers:((data.teachers&&data.teachers.pending)||[]).map(item=>teacherView(item,this.currentTeacherId))});if(needsSetup&&!this.alertEnabled){this.alertEnabled=true;if(wx.enableAlertBeforeUnload)wx.enableAlertBeforeUnload({message:'完成班级基础配置后才能开始使用教室。'});}if(wasOnboarding&&!needsSetup&&this.awaitingSetupSave){this.awaitingSetupSave=false;this.alertEnabled=false;if(wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload();wx.showModal({title:'教室配置完成',content:'班级名称和学生名单已经保存，现在可以开始使用全部教学功能。',showCancel:false,confirmText:'进入首页',success:()=>wx.switchTab({url:'/pages/home/index'})});}this.applyFaces(data.pendingFaces||[]);},
  applyFaces(faces){this.setData({pendingFaces:(faces||[]).filter(item=>/^data:image\//.test(item.cropBase64||'')).map(item=>({...item,image:item.cropBase64}))});},
  switchTab(event){this.setData({tab:event.currentTarget.dataset.tab});},
  noop(){},
  connectFaceLan(){
    if(this.faceLanConnection)this.faceLanConnection.close();
    this.setData({faceLanAvailable:false,faceLanMessage:'正在尝试连接教室局域网'});
    this.faceLanConnection=faceLan.connect(this.room,this.account,(event,payload)=>{
      if(event==='available'){this.setData({faceLanAvailable:true,faceLanMessage:'局域网人脸服务已连接'});this.applyRoomSync(payload,true);}
      else if(event==='unavailable'){this.closeCameraPreview(false);this.setData({faceLanAvailable:false,faceLanMessage:payload.message||'局域网人脸服务不可用',faceControlBusy:false});}
      else if(event==='faceSystemState')this.applyFaceSystemState(payload);
      else if(event==='facePreviewState')this.applyFacePreviewState(payload);
      else if(event==='faceCameraFrame')this.applyCameraFrame(payload);
      else if(event==='pendingFaces')this.applyFaces(payload.faces||[]);
      else if(event==='error'){this.setData({faceControlBusy:false});this.showFaceControlError(payload.message||'人脸服务操作失败');}
    });
  },
  retryFaceLan(){
    this.setData({faceLanAvailable:false,faceLanMessage:'正在重新连接教室局域网'});
    if(this.data.isCloudRoom)this.connectFaceLan();
    else socket.reconnect(this.room,this.account);
  },
  sendFaceCommand(command){return this.data.isCloudRoom?!!(this.faceLanConnection&&this.faceLanConnection.send(command)):socket.send(command);},
  showFaceControlError(message){errorReport.show({title:'人脸服务不可用',error:new Error(message||this.data.faceLanMessage),context:'教室设置－人脸系统',message:'人脸功能仅通过教室局域网提供，画面不会上传到云服务器。',suggestions:['确认手机与教室电脑连接同一 Wi-Fi', '如果手机正在开热点，请改为让手机和电脑连接同一个无线路由器', '确认教室端已启动且摄像头可用']});},
  toggleFaceSystem(event){
    const enabled=event.detail.value===true;
    if(!this.data.faceLanAvailable){this.setData({faceSystemEnabled:!enabled});this.showFaceControlError(this.data.faceLanMessage);return;}
    const send=()=>{if(!this.sendFaceCommand({type:'set-face-system',enabled})){this.setData({faceSystemEnabled:!enabled});this.showFaceControlError('无法向教室端发送人脸系统设置');return;}this.setData({faceControlBusy:true});setTimeout(()=>this.setData({faceControlBusy:false}),1800);};
    if(!enabled){wx.showModal({title:'关闭人脸识别？',content:'关闭后教室端将停止摄像头采集与出勤识别，重新开启前不会更新出勤状态。',confirmText:'确认关闭',confirmColor:'#FA5151',success:result=>{if(result.confirm)send();else this.setData({faceSystemEnabled:true});}});return;}
    send();
  },
  applyFaceSystemState(message){const enabled=message.enabled===true;if(!enabled)this.closeCameraPreview(false);this.setData({faceSystemEnabled:enabled,faceControlBusy:false});},
  openCameraPreview(){
    if(!this.data.faceLanAvailable){this.showFaceControlError(this.data.faceLanMessage);return;}
    if(!this.data.faceSystemEnabled){wx.showToast({title:'请先开启人脸识别',icon:'none'});return;}
    clearTimeout(this.cameraWaitTimer);
    this.setData({cameraPreviewVisible:true,cameraFrame:'',cameraStatus:'正在请求教室画面'});
    if(!this.sendFaceCommand({type:'face-preview-subscribe',enabled:true})){
      this.closeCameraPreview(false);
      this.showFaceControlError('无法向教室端请求摄像头画面');
      return;
    }
    this.cameraWaitTimer=setTimeout(()=>{
      if(this.data.cameraPreviewVisible&&!this.data.cameraFrame)this.setData({cameraStatus:'暂未收到画面，请检查教室摄像头'});
    },6000);
  },
  closeCameraPreview(notify=true){
    clearTimeout(this.cameraWaitTimer);
    if(notify&&this.data.cameraPreviewVisible)this.sendFaceCommand({type:'face-preview-subscribe',enabled:false});
    this.setData({cameraPreviewVisible:false,cameraFrame:'',cameraStatus:'等待教室画面'});
  },
  applyFacePreviewState(message){if(message.faceSystemEnabled===false)this.setData({faceSystemEnabled:false});if(message.enabled!==true){this.closeCameraPreview(false);return;}this.setData({cameraPreviewVisible:true,cameraStatus:'已连接，等待实时画面'});},
  applyCameraFrame(message){const image=String(message.image||'');if(!this.data.cameraPreviewVisible||!/^data:image\/jpeg;base64,/i.test(image))return;clearTimeout(this.cameraWaitTimer);this.setData({cameraFrame:image,cameraStatus:'教室实时画面'});},
  onClassNameInput(event){this.setData({className:event.detail.value});},
  onStudentInput(event){const students=this.data.students.slice();students[Number(event.currentTarget.dataset.index)]={...students[Number(event.currentTarget.dataset.index)],name:event.detail.value};this.setData({students});},
  addStudent(){this.setData({students:this.data.students.concat({id:`s${Date.now().toString(36)}`,name:''})});},
  openBatch(){this.setData({batchVisible:true,batchText:'',batchCount:0});},
  closeBatch(){this.setData({batchVisible:false,batchText:'',batchCount:0});},
  onBatchInput(event){const batchText=event.detail.value;this.setData({batchText,batchCount:parseStudentNames(batchText).length});},
  applyBatch(){const names=parseStudentNames(this.data.batchText);if(!names.length){wx.showToast({title:'请先粘贴学生名单',icon:'none'});return;}const existingNames=new Set(this.data.students.map(item=>String(item.name||'').trim()).filter(Boolean));const additions=names.filter(name=>!existingNames.has(name)).map((name,index)=>({id:`s${Date.now().toString(36)}${index}`,name}));this.setData({students:this.data.students.filter(item=>String(item.name||'').trim()).concat(additions),batchVisible:false,batchText:'',batchCount:0});wx.showToast({title:`已添加 ${additions.length} 人`,icon:'none'});},
  nextSetupStep(){const className=this.data.className.trim();if(!className){wx.showToast({title:'请填写班级名称',icon:'none'});return;}this.setData({onboardingStep:2});},
  previousSetupStep(){this.setData({onboardingStep:1});},
  completeSetup(){const names=parseStudentNames(this.data.batchText);const students=names.map((name,index)=>({id:`s${Date.now().toString(36)}${index}`,name}));if(!students.length){wx.showToast({title:'请至少录入一名学生',icon:'none'});return;}this.setData({students,studentNames:names});this.submitClassroom(this.data.className.trim(),students,true);},
  removeStudent(event){const index=Number(event.currentTarget.dataset.index);const student=this.data.students[index];wx.showModal({title:'移除学生',content:`确定从名单中移除“${student.name||'未命名学生'}”吗？相关作业提交记录也会一并移除。`,confirmColor:'#FA5151',success:result=>{if(result.confirm)this.setData({students:this.data.students.filter((_item,i)=>i!==index)});}});},
  submitClassroom(className,students,isSetup){const session=sessionStore.load();const activeRoom=session&&session.activeRoom;const subjects=(activeRoom&&activeRoom.subjects)||[];if(!subjects.length){wx.showToast({title:'请先返回首页设置授课科目',icon:'none'});return;}if(!socket.send({type:'update-classroom',classroom:{className,students,subjects}})){wx.showToast({title:'教室连接已断开',icon:'none'});return;}if(isSetup)this.awaitingSetupSave=true;this.setData({saving:true});setTimeout(()=>this.setData({saving:false}),1000);if(!isSetup)wx.showToast({title:'已保存',icon:'success'});},
  saveClassroom(){const className=this.data.className.trim();const students=this.data.students.map(item=>({...item,name:String(item.name||'').trim()})).filter(item=>item.name);if(!className){wx.showToast({title:'请填写班级名称',icon:'none'});return;}if(!students.length){wx.showToast({title:'请至少保留一名学生',icon:'none'});return;}if(new Set(students.map(item=>item.name)).size!==students.length){wx.showToast({title:'学生姓名不能重复',icon:'none'});return;}this.submitClassroom(className,students,false);},
  leaveRoom(){const session=sessionStore.load();const room=this.room;if(!session||!room)return;const homeroomNote=this.data.isHomeroom?'\n\n你当前是班主任。退出后教室将暂时没有班主任，但现有班级资料会保留。':'';wx.showModal({title:`退出“${this.data.className||room.name}”？`,content:`退出后，本机会删除该教室，服务端也会删除你的教师成员记录。以后需要重新扫码或接受邀请才能加入。${homeroomNote}`,confirmText:'退出教室',confirmColor:'#FA5151',success:async result=>{if(!result.confirm)return;wx.showLoading({title:'正在退出',mask:true});try{await socket.leaveClassroom(room,session.account,8000);const activeId=session.activeRoom&&(session.activeRoom.cloudClassroomId||session.activeRoom.connectionCode);const roomId=room.cloudClassroomId||room.connectionCode;const updated=sessionStore.removeRoom(room);getApp().globalData.session=updated;if(String(activeId)===String(roomId)){socket.disconnect();if(updated&&updated.activeRoom)socket.connect(updated.activeRoom,updated.account,{force:true});}wx.hideLoading();wx.showToast({title:'已退出教室',icon:'success'});setTimeout(()=>wx.switchTab({url:'/pages/home/index'}),350);}catch(error){wx.hideLoading();errorReport.show({title:'暂时无法退出教室',error,context:'教室设置－退出教室',message:'无法通知服务端；为避免两端成员记录不一致，本次没有删除本地教室。',suggestions:['检查当前网络连接', '确认教室端或云服务处于在线状态']});}}});},
  manageTeacher(event){const {action,id,name,self}=event.currentTarget.dataset;if(self||String(id)===String(this.currentTeacherId)){wx.showToast({title:'不能对班主任本人执行此操作',icon:'none'});return;}const copy={approve:{title:'批准教师加入',content:`批准“${name}”加入教室？授课科目将使用其申请时选择的内容。`,confirmText:'批准',confirmColor:'#07C160'},reject:{title:'拒绝加入申请',content:`拒绝“${name}”的加入申请？对方需要重新发起申请。`,confirmText:'拒绝',confirmColor:'#FA5151'},remove:{title:'移除教师',content:`确定将“${name}”移出当前教室？对方会立即失去本教室的呼叫、出勤和作业管理权限，之后需要重新受邀并通过审核。`,confirmText:'移除',confirmColor:'#FA5151'},transfer:{title:'转让班主任身份',content:`确认将班主任身份转让给“${name}”？\n\n转让后，对方将获得学生名单、教师成员和人脸匹配等全部班级管理权限；你将保留当前授课科目，并变为普通任课教师。`,confirmText:'确认转让',confirmColor:'#E17719'}}[action];if(!copy)return;wx.showModal({...copy,success:result=>{if(!result.confirm)return;const sent=socket.send({type:'manage-teacher',action,connectionId:id,subjects:[]});if(!sent){wx.showToast({title:'教室连接已断开',icon:'none'});return;}this.setData({managingTeacherId:id});wx.showToast({title:action==='remove'?'正在移除':(action==='transfer'?'正在交接':'请求已发送'),icon:'loading',duration:1000});}});},
  async editSubjects(event){const {id,name,subjects}=event.currentTarget.dataset;const current=String(subjects||'').split('、').filter(Boolean);const values=await subjectOptions.choose(current,`设置${name}的授课科目`);if(!values)return;socket.send({type:'manage-teacher',action:'update',connectionId:id,subjects:values});},
  matchFace(event){const face=this.data.pendingFaces[Number(event.currentTarget.dataset.index)];const student=this.data.students[Number(event.detail.value)];if(!face||!student)return;wx.showModal({title:'确认人脸匹配',content:`将这张人脸匹配为“${student.name}”？确认后会写入教室人脸库。`,success:result=>{if(result.confirm&&!this.sendFaceCommand({type:'label-face',faceId:face.faceId,studentId:student.id,name:student.name}))this.showFaceControlError('无法向教室端发送人脸匹配结果');}});},
  previewFace(event){const image=event.currentTarget.dataset.image;if(image)wx.previewImage({current:image,urls:[image]});},
  showCloudInviteHelp(){wx.showModal({title:'添加云端教师',content:'请由组织管理员先创建教师账号并发放默认密码，再在该教室的“成员”页面选择教师、设置身份和授课科目。教师首次登录后会被要求修改密码并完善资料。',showCancel:false,confirmText:'我知道了'});},
  onShareAppMessage(options){const isInvite=options&&options.from==='button'&&options.target&&options.target.dataset.action==='invite-teacher';if(!isInvite||!this.room||this.room.cloudClassroomId)return shareCard.classroomInvite('班达 · 教室管理','/pages/home/index');const room={...this.room,name:this.data.className||this.room.name};return shareCard.classroomInvite(`${room.name}邀请你加入教师团队`,sharedRoom.createPath(room));},
});
