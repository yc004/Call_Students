const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── 窗口控制（所有页面通用） ──
  winMinimize:  () => ipcRenderer.send('win-minimize'),
  winMaximize:  () => ipcRenderer.send('win-maximize'),
  winClose:     () => ipcRenderer.send('win-close'),

  // ── 数据读写（管理页用） ──
  getData:    ()      => ipcRenderer.invoke('get-data'),
  saveData:   (data)  => ipcRenderer.invoke('save-data', data),
  createStudentAssignment: (input) => ipcRenderer.invoke('create-student-assignment', input),

  // ── 首次安装班主任绑定引导 ──
  getOnboardingStatus: () => ipcRenderer.invoke('get-onboarding-status'),
  getClassroomQr: () => ipcRenderer.invoke('get-classroom-qr'),
  getWechatDirectLinkSettings: () => ipcRenderer.invoke('get-wechat-direct-link-settings'),
  setWechatDirectLinkSettings: (baseUrl) => ipcRenderer.invoke('set-wechat-direct-link-settings', baseUrl),
  getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),
  setNetworkInterface: (name) => ipcRenderer.invoke('set-network-interface', name),
  getCloudConfig: () => ipcRenderer.invoke('get-cloud-config'),
  enrollCloud: (input) => ipcRenderer.invoke('enroll-cloud', input),
  disconnectCloud: () => ipcRenderer.invoke('disconnect-cloud'),
  onNetworkInterfaceChanged: (cb) => ipcRenderer.on('network-interface-changed', () => cb()),
  bindHomeroomTeacher: (connectionId) => ipcRenderer.invoke('bind-homeroom-teacher', connectionId),
  approvePendingTeacher: (connectionId) => ipcRenderer.invoke('approve-pending-teacher', connectionId),
  rejectPendingTeacher: (connectionId) => ipcRenderer.invoke('reject-pending-teacher', connectionId),
  transferHomeroomTeacher: (connectionId) => ipcRenderer.invoke('transfer-homeroom-teacher', connectionId),
  finishOnboarding: () => ipcRenderer.send('finish-onboarding'),
  onOnboardingChanged: (cb) => ipcRenderer.on('onboarding-changed', () => cb()),

  openFaceRegister: (studentId, name) => ipcRenderer.send('open-face-register', studentId, name),

  // ── 呼叫弹窗（popup 页用） ──
  onShowCall: (cb)    => ipcRenderer.on('show-call', (_e, call) => cb(call)),
  callAck:    (callId)=> ipcRenderer.send('call-ack', callId),
  closePopup: ()      => ipcRenderer.send('close-popup'),

  // ── 作业看板（board 页用） ──
  closeBoard:  ()     => ipcRenderer.send('close-board'),
  openHomeworkWidget: () => ipcRenderer.send('open-homework-widget'),
  hideHomeworkWidget: () => ipcRenderer.send('hide-homework-widget'),
  openHomeworkBoard: () => ipcRenderer.send('open-homework-board'),
  setHomeworkFloatExpanded: (expanded) => ipcRenderer.send('set-homework-float-expanded', expanded),
  moveHomeworkFloat: (dx, dy) => ipcRenderer.send('move-homework-float', dx, dy),
  getHomeworkUnread: () => ipcRenderer.invoke('get-homework-unread'),
  onHomeworkUnreadChanged: (cb) => ipcRenderer.on('homework-unread-changed', (_event, unread) => cb(!!unread)),
  onDataChanged: (cb) => ipcRenderer.on('data-changed', () => cb()),
  boardLog:    (tag, msg) => ipcRenderer.send('board-log', tag, msg),

  // ── 人脸识别（face-check / face-register 页用） ──
  faceAPI: {
    getGallery:      ()      => ipcRenderer.invoke('face:get-gallery'),
    saveDescriptor:  (id, name, desc) => ipcRenderer.invoke('face:save-descriptor', id, name, desc),
    reportDetections:(dets)  => ipcRenderer.invoke('face:report-detections', dets),
    getAttendance:   ()      => ipcRenderer.invoke('face:get-attendance'),
    getStudents:     ()      => ipcRenderer.invoke('face:get-students'),
    resetAdaptive:   (id)    => ipcRenderer.invoke('face:reset-adaptive', id),
    removeStudent:   (id)    => ipcRenderer.invoke('face:remove-student', id),
    updateConfig:    (cfg)   => ipcRenderer.invoke('face:update-config', cfg),
    diagLog:         (line)  => ipcRenderer.send('face:diag-log', line),

    // ── 原生人脸引擎（C++ ONNX Runtime 加速） ──
    getNativeStatus:       ()      => ipcRenderer.invoke('face:native-status'),
    nativeDetect:          (pixels, w, h) => ipcRenderer.invoke('face:native-detect', pixels, w, h),
    nativeExtractDescriptor: (pixels, w, h) => ipcRenderer.invoke('face:native-extract-descriptor', pixels, w, h),
    nativeMatch:           (desc)  => ipcRenderer.invoke('face:native-match', desc),
  },

  // ── 人脸识别开关 ──
  getFaceCheckEnabled:  () => ipcRenderer.invoke('get-face-check-enabled'),
  setFaceCheckEnabled:  (enabled) => ipcRenderer.invoke('set-face-check-enabled', enabled),

  // ── 人脸注册窗口事件 ──
  onSetStudent: (cb) => ipcRenderer.on('set-student', (_e, studentId, name) => cb(studentId, name)),
});
