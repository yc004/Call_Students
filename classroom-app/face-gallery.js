/**
 * AdaptiveGalleryManager — 人脸底库管理器
 * 负责底库的加载、保存、特征管理、自适应更新和过期清理
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const GALLERY_FILE = path.join(DATA_DIR, 'gallery.json');
const LEGACY_EMBEDDING_MODEL = 'face-api-js-0.22.2-v1';
const SFACE_EMBEDDING_MODEL = 'opencv-sface-2021dec-v1';

// 默认配置
const DEFAULT_CONFIG = {
  maxAdaptiveSamples: 5,
  additionThreshold: 0.85,    // 自适应入库的最低相似度
  recognitionThreshold: 0.6,  // 识别判定的最低相似度
  expiryDays: 30,
};

class AdaptiveGalleryManager {
  constructor(filePath, embeddingModel = LEGACY_EMBEDDING_MODEL, security = {}) {
    this.filePath = filePath || GALLERY_FILE;
    this.embeddingModel = embeddingModel;
    this.encrypt = typeof security.encrypt === 'function' ? security.encrypt : null;
    this.decrypt = typeof security.decrypt === 'function' ? security.decrypt : null;
    this.migration = null;
    this.students = new Map();  // studentId → StudentRecord
    this.config = {
      ...DEFAULT_CONFIG,
      ...(embeddingModel === SFACE_EMBEDDING_MODEL
        ? { recognitionThreshold: 0.363, additionThreshold: 0.55 }
        : {}),
    };
    this._dirty = false;
    this._saveTimer = null;
  }

  // ── 加载 / 保存 ──

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const stored = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        const encrypted = stored && stored.encryptedVersion === 1;
        if (encrypted && !this.decrypt) throw new Error('人脸底库已加密，但系统安全存储不可用');
        const raw = encrypted ? JSON.parse(this.decrypt(stored.ciphertext)) : stored;
        const storedModel = raw.embeddingModel || LEGACY_EMBEDDING_MODEL;
        if (storedModel !== this.embeddingModel) {
          const backupPath = this._backupForModelChange(storedModel,raw);
          this.migration = {
            required: true,
            from: storedModel,
            to: this.embeddingModel,
            backupPath,
            message: '人脸模型已升级，旧底库已备份，请为学生重新录入人脸。',
          };
          console.warn(`[gallery] embedding model changed: ${storedModel} -> ${this.embeddingModel}; backup=${backupPath || 'not needed'}`);
          this._doSave();
          return;
        }
        if (raw.students) {
          for (const s of raw.students) {
            this.students.set(s.id, {
              id: s.id,
              name: s.name || s.id,
              registeredDescriptors: (s.registeredDescriptors || []).map(arr => new Float32Array(arr)),
              adaptiveDescriptors: (s.adaptiveDescriptors || []).map(arr => ({
                descriptor: new Float32Array(arr.descriptor || arr),
                addedAt: arr.addedAt || new Date().toISOString(),
              })),
              lastUpdated: s.lastUpdated || new Date().toISOString(),
            });
          }
        }
        if (raw.config) {
          Object.assign(this.config, raw.config);
        }
        this.migration = raw.migration || null;
        if(!encrypted&&this.encrypt)this._doSave();
        console.log(`[gallery] loaded ${this.students.size} students from ${this.filePath}`);
      } else {
        console.log('[gallery] no gallery file found, starting fresh');
      }
    } catch (e) {
      console.error('[gallery] load error:', e.message);
    }
  }

  _backupForModelChange(storedModel,raw) {
    if (!Array.isArray(raw.students) || raw.students.length === 0) return null;
    const safeModel = storedModel.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      path.dirname(this.filePath),
      `${path.basename(this.filePath, path.extname(this.filePath))}.${safeModel}.${stamp}.bak.json`
    );
    if(this.encrypt)fs.writeFileSync(backupPath,JSON.stringify({encryptedVersion:1,ciphertext:this.encrypt(JSON.stringify(raw))}),{encoding:'utf-8',flag:'wx',mode:0o600});
    else fs.copyFileSync(this.filePath, backupPath, fs.constants.COPYFILE_EXCL);
    const prefix=`${path.basename(this.filePath,path.extname(this.filePath))}.`;
    const backups=fs.readdirSync(path.dirname(this.filePath)).filter(name=>name.startsWith(prefix)&&name.endsWith('.bak.json')).sort().reverse();
    backups.slice(2).forEach(name=>{try{fs.unlinkSync(path.join(path.dirname(this.filePath),name));}catch(_error){}});
    return backupPath;
  }

  save() {
    // 节流：30秒内最多写入一次
    if (this._saveTimer) return;
    this._dirty = true;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._dirty = false;
      this._doSave();
    }, 30000);
  }

  saveNow() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._dirty = false;
    this._doSave();
  }

  _doSave() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const students = [];
      for (const s of this.students.values()) {
        students.push({
          id: s.id,
          name: s.name,
          registeredDescriptors: s.registeredDescriptors.map(d => Array.from(d)),
          adaptiveDescriptors: s.adaptiveDescriptors.map(a => ({
            descriptor: Array.from(a.descriptor),
            addedAt: a.addedAt,
          })),
          lastUpdated: s.lastUpdated,
        });
      }
      const plaintext = JSON.stringify({
        schemaVersion: 2,
        embeddingModel: this.embeddingModel,
        students,
        config: this.config,
        migration: this.migration,
      }, null, 2);
      const payload=this.encrypt?JSON.stringify({encryptedVersion:1,ciphertext:this.encrypt(plaintext)}):plaintext;
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, payload, {encoding:'utf-8',mode:0o600});
      fs.renameSync(tempPath, this.filePath);
      console.log(`[gallery] saved ${students.length} students`);
    } catch (e) {
      console.error('[gallery] save error:', e.message);
    }
  }

  ensureSaved() {
    if (this._dirty) this.saveNow();
  }

  // ── 查询 ──

  getAllStudentIds() {
    return Array.from(this.students.keys());
  }

  getStudentName(id) {
    const s = this.students.get(id);
    return s ? s.name : id;
  }

  getStudents() {
    return Array.from(this.students.values()).map(s => ({
      id: s.id,
      name: s.name,
      lastUpdated: s.lastUpdated,
      registeredCount: s.registeredDescriptors.length,
      adaptiveCount: s.adaptiveDescriptors.length,
    }));
  }

  /**
   * 获取某学生的所有描述符（注册 + 自适应），返回 Float32Array[]
   */
  getDescriptors(id) {
    const s = this.students.get(id);
    if (!s) return [];
    const reg = s.registeredDescriptors;
    const ada = s.adaptiveDescriptors.map(a => a.descriptor);
    return [...reg, ...ada];
  }

  // ── 余弦相似度计算 ──

  /**
   * 计算两个 Float32Array 的余弦相似度
   * 返回 [0, 1]，1 表示完全相同
   */
  static cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    return dot / denom;
  }

  /**
   * 计算给定描述符与某学生所有底库描述符的最佳余弦相似度
   */
  computeBestSimilarity(id, descriptor) {
    const descs = this.getDescriptors(id);
    if (descs.length === 0) return 0;
    let best = 0;
    for (const d of descs) {
      const sim = AdaptiveGalleryManager.cosineSimilarity(descriptor, d);
      if (sim > best) best = sim;
    }
    return best;
  }

  /**
   * 在完整底库中查找最相似的学生。
   * 主进程使用它复核渲染进程上报的“未识别”人脸。
   */
  findBestMatch(descriptor) {
    let best = null;
    for (const id of this.getAllStudentIds()) {
      const similarity = this.computeBestSimilarity(id, descriptor);
      if (!best || similarity > best.similarity) {
        best = { studentId: id, name: this.getStudentName(id), similarity };
      }
    }
    return best;
  }

  // ── 学生管理 ──

  addStudent(id, name, descriptors) {
    if (this.students.has(id)) {
      // 已存在则追加注册特征
      const s = this.students.get(id);
      for (const d of descriptors) {
        s.registeredDescriptors.push(d);
      }
      s.lastUpdated = new Date().toISOString();
    } else {
      this.students.set(id, {
        id,
        name,
        registeredDescriptors: [...descriptors],
        adaptiveDescriptors: [],
        lastUpdated: new Date().toISOString(),
      });
    }
    this.save();
  }

  removeStudent(id) {
    this.students.delete(id);
    this.save();
  }

  // ── 自适应更新 ──

  /**
   * 尝试将高置信度特征加入自适应底库
   * @returns {boolean} 是否成功加入
   */
  tryAddAdaptiveDescriptor(id, descriptor, similarity) {
    if (similarity < this.config.additionThreshold) return false;

    const s = this.students.get(id);
    if (!s) return false;

    // 容量控制：超过上限时 FIFO 移除最早的自适应特征
    if (s.adaptiveDescriptors.length >= this.config.maxAdaptiveSamples) {
      s.adaptiveDescriptors.shift();
    }

    s.adaptiveDescriptors.push({
      descriptor: new Float32Array(descriptor),
      addedAt: new Date().toISOString(),
    });
    s.lastUpdated = new Date().toISOString();
    this.save();
    console.log(`[gallery] adaptive descriptor added for ${id} (sim=${similarity.toFixed(3)}, total adaptive=${s.adaptiveDescriptors.length})`);
    return true;
  }

  /**
   * 清理超过 expiryDays 未更新的自适应特征
   */
  cleanExpired() {
    const now = Date.now();
    const maxAge = this.config.expiryDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const s of this.students.values()) {
      const before = s.adaptiveDescriptors.length;
      s.adaptiveDescriptors = s.adaptiveDescriptors.filter(a => {
        const age = now - new Date(a.addedAt).getTime();
        return age <= maxAge;
      });
      cleaned += before - s.adaptiveDescriptors.length;
    }

    if (cleaned > 0) {
      console.log(`[gallery] cleaned ${cleaned} expired adaptive descriptors`);
      this.save();
    }
  }

  /**
   * 重置某学生的自适应特征
   */
  resetAdaptive(id) {
    const s = this.students.get(id);
    if (!s) return;
    s.adaptiveDescriptors = [];
    s.lastUpdated = new Date().toISOString();
    this.save();
    console.log(`[gallery] adaptive descriptors reset for ${id}`);
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    this.save();
  }

  getConfig() {
    return { ...this.config };
  }

  getMetadata() {
    return {
      schemaVersion: 2,
      embeddingModel: this.embeddingModel,
      migration: this.migration,
    };
  }
}

module.exports = {
  AdaptiveGalleryManager,
  DEFAULT_CONFIG,
  LEGACY_EMBEDDING_MODEL,
  SFACE_EMBEDDING_MODEL,
};
