# 原生人脸识别构建与发布

当前原生链路固定为：

`Canvas RGBA → YuNet 2023mar → 五点相似变换对齐 → SFace 2021dec → 128 维 L2 归一化特征 → 余弦匹配`

特征模型 ID 为 `opencv-sface-2021dec-v1`。它与旧版 `face-api.js` 的 128 维特征不兼容，不能混合匹配。

## 本地构建

1. 安装依赖：`npm ci`
2. 准备 ONNX Runtime：`bash scripts/download_onnxruntime.sh 1.18.0`
3. 下载并校验模型：`npm run prepare:models`
4. 编译：`npm run build:native`
5. 测试：`npm run test:native`

模型二进制不进入 Git。`models/onnx/models.json` 固定来源、字节数和 SHA-256；`prepare:models` 只接受校验完全一致的文件，`build:native` 会再次执行离线校验。

## 发布门禁

当前部署目标为 Windows x64。GitHub Actions 固定使用 Windows Server 2022 与 Visual Studio 2022：

1. 用 `npm ci` 还原锁定依赖；
2. 准备 ONNX Runtime 和校验过的模型；
3. 编译并运行不可跳过的原生测试；
4. 构建 x64 NSIS 安装包；
5. 由 `scripts/verify-packaged-native.js` 检查发布目录中的 `.node`、ONNX Runtime 动态库、两个 ONNX 模型及其 SHA-256；
6. 分别启动解包应用和静默安装后的应用，实际加载 `better-sqlite3`、原生插件、ONNX Runtime 与模型；
7. 生成安装包 SHA-256；推送 `v*` 标签时自动发布 GitHub Release。

任何模型缺失、模型被替换、动态库未复制或原生插件不能加载都会使构建失败。

## 图库升级

图库保存在 Electron `userData/gallery.json`，并记录 `embeddingModel`。应用从旧版 `face-api.js` 特征升级到 SFace 时：

1. 将旧图库完整复制为 `gallery.<旧模型>.<时间>.bak.json`；
2. 建立新的 SFace 空图库；
3. 在人脸注册页提示重新录入。

备份不会参与识别，也不会被自动删除。确认所有学生完成重新录入并经过人工核验后，再由管理员按数据保留制度处理备份。

## 阈值

- SFace 识别余弦阈值：`0.363`
- 高置信度自适应入库阈值：`0.55`
- 同一人的短时追踪阈值：`0.45`

这些是模型级初始值。正式部署前仍需使用本校摄像头、光照和学生样本做误识率/漏识率标定。
