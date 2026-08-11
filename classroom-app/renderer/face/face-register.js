/**
 * 人脸注册页 — 摄像头拍照 → 提取人脸描述符 → 保存到底库
 */
(function () {
  'use strict';

  // 修复 Electron 中 fetch 无法读取自定义协议的问题
  (function patchFetchForElectron() {
    var _origFetch = window.fetch;
    window.fetch = function(url, init) {
      var urlStr = typeof url === 'string' ? url : (url ? url.url || '' : '');
      if (urlStr && !/^https?:/.test(urlStr)) {
        return new Promise(function(resolve, reject) {
          var xhr = new XMLHttpRequest();
          xhr.open((init && init.method) || 'GET', urlStr, true);
          xhr.responseType = 'arraybuffer';
          xhr.onload = function() {
            var headers = new Headers();
            var ct = xhr.getResponseHeader('Content-Type');
            if (ct) headers.set('Content-Type', ct);
            resolve(new Response(xhr.response, {
              status: xhr.status, statusText: xhr.statusText, headers: headers
            }));
          };
          xhr.onerror = function() { reject(new Error('XHR failed: ' + urlStr)); };
          xhr.send();
        });
      }
      return _origFetch.call(this, url, init);
    };
  })();

  const api = window.api || {};
  const faceapi = window.faceapi;

  // ── DOM ──
  let video, canvas, noCamera, retryCameraBtn;
  let studentSelect, captureBtn, closeBtn, statusMsg;
  let resultPanel, resultContent;

  // ── 状态 ──
  let stream = null;
  let modelsLoaded = false;
  let galleryStudents = [];
  let useNative = false;
  let galleryMigration = null;

  async function checkNativeCapability() {
    try {
      if (api.faceAPI && api.faceAPI.getNativeStatus) {
        var status = await api.faceAPI.getNativeStatus();
        useNative = !!(status && status.available);
        galleryMigration = status && status.gallery ? status.gallery.migration : null;
        console.log('[face-reg] Native engine:', useNative ? 'available (ONNX)' : 'unavailable');
        if (galleryMigration && galleryMigration.required) {
          setStatus('info', galleryMigration.message || '模型已升级，请重新录入学生人脸。');
        }
      }
    } catch (_) {
      useNative = false;
    }
  }

  // ═══════════════════════════════
  //  摄像头
  // ═══════════════════════════════

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' }
      });
      video.srcObject = stream;
      await video.play();
      if (noCamera) noCamera.classList.add('hidden');
      return true;
    } catch (e) {
      console.error('Camera error:', e.message);
      if (noCamera) noCamera.classList.remove('hidden');
      return false;
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  // ═══════════════════════════════
  //  face-api.js 模型加载
  // ═══════════════════════════════

  async function loadModels() {
    if (modelsLoaded) return true;
    try {
      setStatus('info', '正在加载人脸识别模型…');
      const base = 'face-models://models';
      console.log('[face-register] Loading models from:', base);
      await faceapi.nets.ssdMobilenetv1.loadFromUri(base);
      await faceapi.nets.faceLandmark68Net.loadFromUri(base);
      await faceapi.nets.faceRecognitionNet.loadFromUri(base);
      modelsLoaded = true;
      setStatus('ok', '模型加载完成 ✓');
      updateCaptureBtn();
      return true;
    } catch (e) {
      console.error('Model load error:', e.message);
      setStatus('error', '模型加载失败: ' + e.message);
      return false;
    }
  }

  // ═══════════════════════════════
  //  学生列表
  // ═══════════════════════════════

  async function loadStudentList() {
    if (!api.getData) return;
    try {
      const data = await api.getData();
      const students = data.students || [];
      if (studentSelect) {
        studentSelect.innerHTML = '<option value="">-- 请选择学生 --</option>';
        students.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          studentSelect.appendChild(opt);
        });
      }
    } catch (e) {
      console.error('loadStudentList error:', e.message);
    }
  }

  function updateCaptureBtn() {
    if (!captureBtn) return;
    const hasStudent = studentSelect && studentSelect.value;
    captureBtn.disabled = !(modelsLoaded && hasStudent && stream);
  }

  // ═══════════════════════════════
  //  拍照 & 提取特征
  // ═══════════════════════════════

  async function captureAndRegister() {
    if (!studentSelect || !studentSelect.value) {
      setStatus('error', '请先选择一个学生');
      return;
    }
    if (!useNative && !modelsLoaded) {
      setStatus('error', '模型尚未加载完成');
      return;
    }
    if (!stream) {
      setStatus('error', '摄像头未就绪');
      return;
    }

    const studentId = studentSelect.value;
    const studentName = studentSelect.options[studentSelect.selectedIndex].textContent;

    setStatus('info', '正在检测人脸…');

    try {
      // 从视频捕获一帧
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, 320, 240);

      let descriptor;

      if (useNative && api.faceAPI && api.faceAPI.nativeExtractDescriptor) {
        // ── 原生路径：通过 IPC 发送帧到主进程，C++ ONNX 提取描述符 ──
        var imageData = ctx.getImageData(0, 0, 320, 240);
        var result = await api.faceAPI.nativeExtractDescriptor(
          new Uint8Array(imageData.data.buffer), 320, 240
        );
        if (!result || !result.success) {
          setStatus('error', '原生人脸检测失败: ' + (result ? result.error : '引擎不可用'));
          return;
        }
        descriptor = result.descriptor;
      } else {
        // ── 原有 face-api.js 路径 ──
        const detection = await faceapi.detectSingleFace(canvas)
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (!detection) {
          setStatus('error', '未检测到人脸，请确保面部正对摄像头、光线充足');
          return;
        }
        descriptor = Array.from(detection.descriptor);
      }

      // 保存到底库
      if (api.faceAPI && api.faceAPI.saveDescriptor) {
        const result = await api.faceAPI.saveDescriptor(studentId, studentName, descriptor);
        if (result.success) {
          setStatus('ok', `✓ ${studentName} 人脸注册成功！`);
          showResult();
        } else {
          setStatus('error', '保存失败: ' + (result.error || '未知错误'));
        }
      } else {
        setStatus('error', 'IPC 接口不可用');
      }
    } catch (e) {
      console.error('Capture error:', e.message);
      setStatus('error', '识别出错: ' + e.message);
    }
  }

  // ═══════════════════════════════
  //  结果显示
  // ═══════════════════════════════

  async function showResult() {
    if (!resultPanel || !resultContent) return;
    resultPanel.classList.remove('hidden');

    try {
      let students = [];
      if (api.faceAPI && api.faceAPI.getStudents) {
        students = await api.faceAPI.getStudents();
      }
      if (students.length === 0) {
        resultContent.innerHTML = '<p class="fr-hint">暂无注册学生</p>';
        return;
      }
      resultContent.innerHTML = students.map(s =>
        `<div class="fr-student-card">
          <span class="fr-stu-name">${esc(s.name)}</span>
          <span class="fr-stu-info">
            注册特征: ${s.registeredCount} | 自适应: ${s.adaptiveCount}
          </span>
        </div>`
      ).join('');
    } catch (e) {
      resultContent.innerHTML = '<p class="fr-hint">加载底库失败</p>';
    }
  }

  // ═══════════════════════════════
  //  工具
  // ═══════════════════════════════

  function setStatus(type, msg) {
    if (!statusMsg) return;
    statusMsg.textContent = msg;
    statusMsg.className = 'fr-status ' + type;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ═══════════════════════════════
  //  事件绑定
  // ═══════════════════════════════

  function bindEvents() {
    if (retryCameraBtn) retryCameraBtn.addEventListener('click', startCamera);
    if (captureBtn) captureBtn.addEventListener('click', captureAndRegister);
    if (closeBtn) closeBtn.addEventListener('click', () => window.close());

    if (studentSelect) {
      studentSelect.addEventListener('change', updateCaptureBtn);
    }
  }

  /**
   * 从 URL hash 读取预选学生: #studentId/name
   */
  function readHashStudent() {
    const hash = window.location.hash.slice(1);
    if (!hash) return null;
    const idx = hash.indexOf('/');
    if (idx < 0) return { studentId: decodeURIComponent(hash), name: '' };
    return {
      studentId: decodeURIComponent(hash.slice(0, idx)),
      name: decodeURIComponent(hash.slice(idx + 1)),
    };
  }

  /**
   * 预选学生
   */
  function selectStudent(studentId) {
    if (!studentSelect) return;
    for (let i = 0; i < studentSelect.options.length; i++) {
      if (studentSelect.options[i].value === studentId) {
        studentSelect.selectedIndex = i;
        updateCaptureBtn();
        return;
      }
    }
  }

  // ═══════════════════════════════
  //  启动
  // ═══════════════════════════════

  async function onReady() {
    video        = document.getElementById('video');
    canvas       = document.getElementById('canvas');
    noCamera     = document.getElementById('noCamera');
    retryCameraBtn = document.getElementById('retryCameraBtn');
    studentSelect= document.getElementById('studentSelect');
    captureBtn   = document.getElementById('captureBtn');
    closeBtn     = document.getElementById('closeBtn');
    statusMsg    = document.getElementById('statusMsg');
    resultPanel  = document.getElementById('resultPanel');
    resultContent= document.getElementById('resultContent');

    bindEvents();

    // 检查原生引擎
    await checkNativeCapability();

    // 并行加载（原生可用时跳过 face-api.js 模型加载）
    var tasks = [loadStudentList(), startCamera()];
    if (!useNative) {
      tasks.push(loadModels());
    } else {
      modelsLoaded = true; // 原生模式无需加载 TF.js 模型
    }
    await Promise.all(tasks);

    // 预选学生（来自 hash 参数）
    const hashStudent = readHashStudent();
    if (hashStudent) {
      selectStudent(hashStudent.studentId);
      setStatus('info', `准备为 ${hashStudent.name || hashStudent.studentId} 注册人脸`);
    }

    showResult();

    // 监听主进程发来的切换学生事件
    if (api.onSetStudent) {
      api.onSetStudent((studentId, name) => {
        selectStudent(studentId);
        setStatus('info', `已切换: ${name || studentId}`);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
