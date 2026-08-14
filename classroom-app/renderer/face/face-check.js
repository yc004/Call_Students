/**
 * 人脸采集引擎 — 静默运行，实时检测 + 发送教师端
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
            resolve(new Response(xhr.response, { status: xhr.status, statusText: xhr.statusText, headers: headers }));
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

  // 约每 1.5 秒采样一次；两帧未检测到即确认离开，兼顾实时性与短暂漏检保护。
  const RECOGNITION_INTERVAL = 1500;
  let recognitionThreshold = 0.65;
  let trackingThreshold = 0.82;
  // 单个学生在其他人仍被检测到时，也应尽快从追踪列表移除。
  // 3 秒约等于两个采样周期，避免旧版最长等待 30 秒才显示离开。
  const TRACK_EXPIRY_MS = 3000;
  const MATCH_CONFIRM_COUNT = 2;
  const IMG_WIDTH = 320;
  const IMG_HEIGHT = 240;
  const CROP_SIZE = 80;

  let fcVideo, fcCanvas, fcStatus;
  let fcCropCanvas;
  let stream = null;
  let modelsLoaded = false;
  let isRunning = false;
  let detectTimer = null;
  let galleryData = null;
  let activeTracks = [];
  let trackIdCounter = 0;
  let lastGalleryRefresh = 0;
  let _consecutiveEmptyFrames = 0;  // 连续空帧计数（镜头遮挡检测）

  // ── 原生引擎标志 ──
  let useNative = false;

  async function checkNativeCapability() {
    try {
      if (api.faceAPI && api.faceAPI.getNativeStatus) {
        var status = await api.faceAPI.getNativeStatus();
        useNative = !!(status && status.available);
        if (useNative && Number.isFinite(status.recognitionThreshold)) {
          recognitionThreshold = status.recognitionThreshold;
          trackingThreshold = 0.45;
        }
        console.log('[face] Native engine:', useNative ? 'available (ONNX)' : 'unavailable, using face-api.js');
      }
    } catch (_) {
      useNative = false;
    }
  }

  function status(msg) {
    if (fcStatus) fcStatus.textContent = msg;
    console.log('[face]', msg);
  }

  // ── 诊断日志（写到主进程 debug.log，排查显示异常）──
  let _diagLastReport = 0;
  let _lastReportedTrackCount = -1;
  function diagLog(detCount, trackCount, recCount, errMsg) {
    if (!(api.faceAPI && api.faceAPI.diagLog)) return;
    var now = Date.now();
    // 关键时刻必记：出错、或 track 数量变化（尤其变 0 的那一刻）
    var mustLog = !!errMsg || trackCount !== _lastReportedTrackCount || detCount === -1;
    if (!mustLog && now - _diagLastReport < 3000) return;  // 平稳期 3 秒一行
    _diagLastReport = now;
    _lastReportedTrackCount = trackCount;
    var line;
    if (errMsg) {
      line = 'ERR ' + new Date().toISOString().slice(11, 19) + ' trk=' + trackCount + ' : ' + errMsg;
    } else {
      var tracksInfo = activeTracks.map(function(t) {
        var age = Math.round((now - t.lastSeenTime) / 1000);
        return t.trackId + '(seen=' + t.seenCount + ',age=' + age + 's,rec=' + t.isRecognized + (t.studentId ? '/' + t.studentId : '') + ')';
      }).join(' ');
      line = new Date().toISOString().slice(11, 19) + ' det=' + detCount + ' trk=' + trackCount + ' rec=' + recCount +
             ' | ' + (tracksInfo || '(no tracks)');
    }
    try { api.faceAPI.diagLog(line); } catch (_) {}
  }

  // ── 摄像头 ──

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: IMG_WIDTH, height: IMG_HEIGHT, facingMode: 'user' }
      });
      fcVideo.srcObject = stream;
      await fcVideo.play();
      return true;
    } catch (e) {
      status('CAM ERR: ' + e.message);
      return false;
    }
  }

  function stopCamera() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  // ── 模型 ──

  async function loadModels() {
    if (modelsLoaded) return true;
    try {
      status('loading models...');
      const base = 'face-models://models';
      await faceapi.nets.ssdMobilenetv1.loadFromUri(base);
      await faceapi.nets.faceLandmark68Net.loadFromUri(base);
      await faceapi.nets.faceRecognitionNet.loadFromUri(base);
      modelsLoaded = true;
      status('models OK');
      return true;
    } catch (e) {
      status('MODEL ERR: ' + e.message);
      return false;
    }
  }

  // ── 底库 ──

  async function refreshGallery() {
    try {
      if (api.faceAPI && api.faceAPI.getGallery) {
        galleryData = await api.faceAPI.getGallery();
      }
    } catch (e) {}
  }

  // ── 相似度 ──

  function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    var dot = 0, normA = 0, normB = 0;
    for (var i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    var denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  // ── 人脸裁剪（face-api.js 路径） ──

  function cropFace(detection) {
    var box = detection.detection.box;
    var marginX = box.width * 0.3;
    var marginY = box.height * 0.4;
    var sx = Math.max(0, box.x - marginX);
    var sy = Math.max(0, box.y - marginY);
    var sw = Math.min(IMG_WIDTH - sx, box.width + marginX * 2);
    var sh = Math.min(IMG_HEIGHT - sy, box.height + marginY * 2);
    if (!fcCropCanvas) {
      fcCropCanvas = document.createElement('canvas');
      fcCropCanvas.width = CROP_SIZE;
      fcCropCanvas.height = CROP_SIZE;
    }
    var ctx = fcCropCanvas.getContext('2d');
    ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
    ctx.drawImage(fcCanvas, sx, sy, sw, sh, 0, 0, CROP_SIZE, CROP_SIZE);
    return fcCropCanvas.toDataURL('image/jpeg', 0.7);
  }

  // ── 人脸裁剪（原生路径 — 使用 box 对象而非 detection 对象） ──

  function cropFaceNative(box) {
    var marginX = box.width * 0.3;
    var marginY = box.height * 0.4;
    var sx = Math.max(0, box.x - marginX);
    var sy = Math.max(0, box.y - marginY);
    var sw = Math.min(IMG_WIDTH - sx, box.width + marginX * 2);
    var sh = Math.min(IMG_HEIGHT - sy, box.height + marginY * 2);
    if (!fcCropCanvas) {
      fcCropCanvas = document.createElement('canvas');
      fcCropCanvas.width = CROP_SIZE;
      fcCropCanvas.height = CROP_SIZE;
    }
    var ctx = fcCropCanvas.getContext('2d');
    ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
    ctx.drawImage(fcCanvas, sx, sy, sw, sh, 0, 0, CROP_SIZE, CROP_SIZE);
    return fcCropCanvas.toDataURL('image/jpeg', 0.7);
  }

  // ── 追踪 ──

  function matchTrack(descriptor) {
    if (!descriptor || descriptor.length < 128) return null;
    var bestTrack = null, bestSim = 0;
    for (var i = 0; i < activeTracks.length; i++) {
      var t = activeTracks[i];
      if (!t.descriptor || t.descriptor.length < 128) continue;
      // 优先比对滑动平均描述符（多帧稳定特征）
      var sim = cosineSimilarity(descriptor, t.descriptor);
      // 同时比对最近一帧的原始描述符（防止新 track 因平均特征尚未稳定而失配）
      if (t.lastDescriptor && t.lastDescriptor.length === descriptor.length) {
        var simLast = cosineSimilarity(descriptor, t.lastDescriptor);
        if (simLast > sim) sim = simLast;
      }
      if (sim > bestSim && sim >= trackingThreshold) {
        bestSim = sim;
        bestTrack = t;
      }
    }
    // 诊断：匹配失败时记录原因
    if (!bestTrack && activeTracks.length > 0) {
      console.log('[face] matchTrack FAILED: ' + activeTracks.length + ' tracks checked, bestSim=' + bestSim.toFixed(4) + ' (threshold=' + trackingThreshold + ')');
    }
    return bestTrack;
  }

  function cleanupTracks() {
    var now = Date.now();
    var before = activeTracks.length;
    activeTracks = activeTracks.filter(function(t) {
      var age = now - t.lastSeenTime;
      if (age >= TRACK_EXPIRY_MS) {
        console.log('[face] cleanup: removing track ' + t.trackId + ' (age=' + Math.round(age/1000) + 's, seen=' + t.seenCount + 'x)');
        return false;
      }
      return true;
    });
    if (before !== activeTracks.length) {
      console.log('[face] cleanup: ' + before + ' → ' + activeTracks.length + ' tracks (' + (before - activeTracks.length) + ' removed)');
    }
  }

  // ── 检测循环 ──

  async function detectFrame() {
    if (!isRunning) return;
    if (!stream) { scheduleNext(); return; }
    if (!useNative && !modelsLoaded) { scheduleNext(); return; }

    try {
      var now = Date.now();
      if (!useNative && now - lastGalleryRefresh > 5000) {
        await refreshGallery();
        lastGalleryRefresh = now;
      }

      // 抓帧
      fcCanvas.width = IMG_WIDTH;
      fcCanvas.height = IMG_HEIGHT;
      var ctx = fcCanvas.getContext('2d');
      ctx.drawImage(fcVideo, 0, 0, IMG_WIDTH, IMG_HEIGHT);

      // ═══════════════════════════════════════════
      //  原生加速路径（C++ ONNX Runtime）
      // ═══════════════════════════════════════════
      if (useNative) {
        var imageData = ctx.getImageData(0, 0, IMG_WIDTH, IMG_HEIGHT);
        var result = await api.faceAPI.nativeDetect(
          new Uint8Array(imageData.data.buffer),
          IMG_WIDTH, IMG_HEIGHT
        );

        if (!result || !result.success) {
          // 原生路径失败，自动降级
          if (result && result.error) {
            console.warn('[face] Native detection failed:', result.error, '→ falling back to face-api.js');
          }
          useNative = false;
          // 回溯：此帧跳过，下帧走 face-api.js 路径
          scheduleNext();
          return;
        }

        var detections = result.detections || [];
        var nowTime = new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });

        // 原生路径：匹配已在主进程完成，直接处理结果
        for (var d = 0; d < detections.length; d++) {
          var det = detections[d];
          var box = det.box;
          var desc = det.descriptor;

          // 跳过描述符无效的人脸（提取失败），等下一帧重试
          if (!desc || desc.length !== 128) {
            console.warn('[face] Native detection skipped: invalid descriptor (len=' + (desc ? desc.length : 0) + ')');
            continue;
          }

          // 裁剪人脸缩略图（渲染进程用 canvas 完成）
          var crop = cropFaceNative(box);

          // 匹配追踪
          var track = matchTrack(desc);
          if (track) {
            track.lastSeenTime = now;
            track.lastSeen = nowTime;
            track.cropBase64 = crop;
            track.lastDescriptor = desc;
            track.seenCount = (track.seenCount || 0) + 1;
            if (track.seenCount >= 3 && desc.length === 128) {
              for (var i = 0; i < desc.length; i++) {
                track.descriptor[i] = track.descriptor[i] * 0.85 + desc[i] * 0.15;
              }
            }
            // 主进程已给出识别结果，若比本地更可信则更新
            if (det.isRecognized && det.similarity >= recognitionThreshold) {
              track.studentId = det.studentId;
              track.name = det.name;
              track.similarity = det.similarity;
              track.isRecognized = true;
              track.matchCandidates = track.matchCandidates || {};
              track.matchCandidates[det.studentId] = (track.matchCandidates[det.studentId] || 0) + 1;
            }
          } else {
            trackIdCounter++;
            track = {
              trackId: 'face_' + trackIdCounter,
              descriptor: new Float32Array(desc),
              lastDescriptor: desc,
              cropBase64: crop,
              lastSeenTime: now,
              lastSeen: nowTime,
              studentId: det.isRecognized ? det.studentId : null,
              name: det.isRecognized ? det.name : '未识别',
              similarity: det.similarity || 0,
              isRecognized: !!(det.isRecognized),
              seenCount: 1,
              matchCandidates: {},
            };
            if (det.isRecognized) {
              track.matchCandidates[det.studentId] = 1;
            }
            activeTracks.push(track);
          }
        }

        // 连续空帧检测：>=2 帧无检测 → 镜头遮挡或人已离开 → 清空所有 track
        if (detections.length === 0) {
          _consecutiveEmptyFrames++;
        } else {
          _consecutiveEmptyFrames = 0;
        }
        if (_consecutiveEmptyFrames >= 2) {
          console.log('[face] camera blocked or person left — clearing all tracks');
          activeTracks = [];
        }

        // 每帧都清理过期追踪（不依赖 detection 数量）
        cleanupTracks();

        // 发送所有活跃追踪
        var activeFacesNative = activeTracks.map(function(t) {
          var descToSend = t.lastDescriptor || t.descriptor;
          return {
            faceId: t.trackId,
            cropBase64: t.cropBase64 || '',
            descriptor: Array.isArray(descToSend) ? descToSend : Array.from(descToSend),
            studentId: t.studentId,
            name: t.name,
            similarity: t.similarity,
            isRecognized: t.isRecognized,
            seenCount: t.seenCount || 1,
          };
        });

        if (api.faceAPI && api.faceAPI.reportDetections) {
          api.faceAPI.reportDetections(activeFacesNative).catch(function(e) {
            console.error('[face] reportDetections error:', e);
          });
        }

        var recNative = activeTracks.filter(function(t){ return t.isRecognized; }).length;
        status(nowTime + ' | N ' + detections.length + ' det ' + activeTracks.length + ' trk ' + recNative + ' rec');
        diagLog(detections.length, activeTracks.length, recNative);

        scheduleNext();
        return;
      }

      // ═══════════════════════════════════════════
      //  原有 face-api.js 路径（降级）
      // ═══════════════════════════════════════════

      // 检测
      var detections = await faceapi.detectAllFaces(fcCanvas)
        .withFaceLandmarks()
        .withFaceDescriptors();

      var nowTime = new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });

      for (var d = 0; d < detections.length; d++) {
        var det = detections[d];
        var desc = det.descriptor;
        var crop = cropFace(det);

        // 匹配已有追踪
        var track = matchTrack(desc);
        if (track) {
          track.lastSeenTime = now;
          track.lastSeen = nowTime;
          track.cropBase64 = crop;
          track.lastDescriptor = desc;   // 当前帧原始描述符，用于标注/自适应入库
          track.seenCount = (track.seenCount || 0) + 1;
          if (track.seenCount >= 3) {
            // 滑动平均仅用于 matchTrack 的追踪稳定性，不用于上报
            for (var i = 0; i < desc.length; i++) {
              track.descriptor[i] = track.descriptor[i] * 0.85 + desc[i] * 0.15;
            }
          }
        } else {
          trackIdCounter++;
          track = {
            trackId: 'face_' + trackIdCounter,
            descriptor: new Float32Array(desc),  // 滑动平均，用于追踪匹配
            lastDescriptor: desc,                // 当前帧原始，用于上报
            cropBase64: crop,
            lastSeenTime: now,
            lastSeen: nowTime,
            studentId: null,
            name: '未识别',
            similarity: 0,
            isRecognized: false,
            seenCount: 1,
            matchCandidates: {},
          };
          activeTracks.push(track);
        }

        // 底库匹配
        if (!track.isRecognized && galleryData && galleryData.students) {
          var bestId = null, bestName = null, bestSim = 0;
          for (var g = 0; g < galleryData.students.length; g++) {
            var gs = galleryData.students[g];
            for (var w = 0; w < gs.descriptors.length; w++) {
              var sim = cosineSimilarity(desc, gs.descriptors[w]);
              if (sim > bestSim) { bestSim = sim; bestId = gs.studentId; bestName = gs.name; }
            }
          }
          if (bestId && bestSim >= recognitionThreshold) {
            track.matchCandidates = track.matchCandidates || {};
            track.matchCandidates[bestId] = (track.matchCandidates[bestId] || 0) + 1;
            if (track.matchCandidates[bestId] >= MATCH_CONFIRM_COUNT) {
              track.studentId = bestId;
              track.name = bestName;
              track.similarity = bestSim;
              track.isRecognized = true;
            }
          } else {
            track.matchCandidates = {};
          }
        }
      }

      // 连续空帧检测：>=2 帧无检测 → 镜头遮挡或人已离开 → 清空所有 track
      if (detections.length === 0) {
        _consecutiveEmptyFrames++;
      } else {
        _consecutiveEmptyFrames = 0;
      }
      if (_consecutiveEmptyFrames >= 2) {
        console.log('[face] camera blocked or person left — clearing all tracks');
        activeTracks = [];
      }

      // 每帧都清理过期追踪（不依赖 detection 数量，避免追踪泄漏）
      cleanupTracks();

      // 发送所有活跃追踪给教师端（包括未更新的，确保持续显示）
      // 注意：上报的是当前帧原始描述符 lastDescriptor，不是滑动平均后的 descriptor。
      // 否则教师端标注入库 / 主进程自适应入库的都会是多帧混合特征，质量下降。
      var activeFaces = activeTracks.map(function(t) {
        var descToSend = t.lastDescriptor || t.descriptor;
        return {
          faceId: t.trackId,
          cropBase64: t.cropBase64 || '',
          descriptor: Array.from(descToSend),
          studentId: t.studentId,
          name: t.name,
          similarity: t.similarity,
          isRecognized: t.isRecognized,
          seenCount: t.seenCount || 1,
        };
      });

      if (api.faceAPI && api.faceAPI.reportDetections) {
        api.faceAPI.reportDetections(activeFaces).then(function() {
          // 每 10 次打印一次确认发送成功
          if (trackIdCounter % 10 === 0) console.log('[face] sent', activeFaces.length, 'tracks');
        }).catch(function(e) {
          console.error('[face] reportDetections error:', e);
        });
      } else {
        console.error('[face] api.faceAPI.reportDetections not available!');
      }

      var rec = activeTracks.filter(function(t){ return t.isRecognized; }).length;
      status(nowTime + ' | ' + detections.length + ' det ' + activeTracks.length + ' trk ' + rec + ' rec');

      // 诊断：把每帧关键指标写日志，便于排查"头像闪现后消失"
      diagLog(detections.length, activeTracks.length, rec);

    } catch (e) {
      status('DET ERR: ' + e.message);
      diagLog(-1, activeTracks.length, -1, e.message);
    }

    scheduleNext();
  }

  function scheduleNext() {
    if (!isRunning) return;
    detectTimer = setTimeout(detectFrame, RECOGNITION_INTERVAL);
  }

  // ── 启动 ──

  async function start() {
    if (isRunning) return;
    await refreshGallery();
    isRunning = true;
    status('started');
    detectFrame();
  }

  // ── 入口 ──

  async function onReady() {
    fcVideo  = document.getElementById('fcVideo');
    fcCanvas = document.getElementById('fcCanvas');
    fcStatus = document.getElementById('status');

    // 检查原生引擎是否可用
    await checkNativeCapability();

    var camOk = await startCamera();
    if (!camOk) return;

    // 原生引擎可用时跳过 face-api.js 模型加载（节省内存和启动时间）
    if (!useNative) {
      var modOk = await loadModels();
      if (!modOk) return;
    } else {
      // 原生模式不需要加载 TF.js 模型，但标记为已加载以通过检测
      modelsLoaded = true;
      status('ONNX native mode — models handled in main process');
    }

    await start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
