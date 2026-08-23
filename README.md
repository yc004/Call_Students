# 班达

班达是一套用于教室与教师之间进行班级协作的工具，支持呼叫通知、作业管理和出勤统计等功能。

## 架构

```
教师端 / 微信小程序 ── HTTPS/WSS ── 云服务 ── WSS ── 教室端
        └──────────── 局域网 WebSocket ────────────┘
                  （仅人脸与离线直连）
```

- 默认继续支持无需服务器的局域网分布式模式；
- 可选配置 `cloud-server/`：教室设备使用接入密钥注册，教师在小程序中使用组织发放的账号密码登录；
- 云端负责教师身份、教室成员、作业、通知、呼叫路由和离线快照；
- 人脸图片、特征、识别结果和人脸出勤永不进入云服务。打开出勤页面时客户端会单独尝试局域网握手，失败时仅禁用人脸服务。

微信小程序工程位于 `mini-program/`，具体使用和真机网络要求见 [`mini-program/README.md`](mini-program/README.md)。

云服务部署与配置说明见 [`cloud-server/README.md`](cloud-server/README.md)，完整设计与实施边界见 [`docs/CLOUD-SERVICE-IMPLEMENTATION-PLAN.md`](docs/CLOUD-SERVICE-IMPLEMENTATION-PLAN.md)。

## 快速开始

```bash
# 教室端
cd classroom-app
npm install
npm start

# 教师端
cd teacher-app
npm install
npm start
```

### 使用流程

1. 教室电脑启动教室端 → 自动缩到系统托盘
2. 右键托盘 → **学生管理** → 录入班级名称和学生名单 → 保存
3. 教师电脑启动教师端 → 输入教室 IP → 点击连接
4. 学生名单自动同步 → 点击学生卡片上的「呼叫」
5. 教室屏幕弹出通知卡片 + 语音播报

## 打包

```bash
cd classroom-app && npm run build    # 输出 dist/Banda-Classroom-<版本号>-Setup-x64.exe
cd teacher-app   && npm run build    # 输出 dist/Banda-Teacher-<版本号>-Setup-x64.exe
```

### GitHub 自动构建

`.github/workflows/build.yml` 使用 Windows Server 2022 原生构建两端的 x64 NSIS 安装包：

- 推送到 `master`、向 `master` 提交 Pull Request 或手动运行工作流时，生成可下载的 Actions Artifacts；
- 推送 `v*` 标签时，在全部验证通过后自动创建 GitHub Release；
- 每个安装包同时生成 `.sha256` 校验文件；
- 教室端必须通过原生插件、ONNX Runtime、模型校验和 `better-sqlite3` 测试；
- 两端都必须通过“解包应用启动”和“NSIS 静默安装后启动”两层冒烟测试。

若要签名 Windows 安装包，在仓库 Actions Secrets 中配置 `WINDOWS_CSC_LINK`（证书文件路径、URL 或 Base64）与 `WINDOWS_CSC_KEY_PASSWORD`。配置后，工作流会拒绝 Authenticode 签名无效的安装包；未配置时仍会生成经过安装测试的无签名安装包，但 Windows 可能显示 SmartScreen 提示。

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Electron 42 |
| 通信 | WebSocket (ws) |
| 云服务 | Fastify + PostgreSQL + TypeScript |
| 语音 | Web Speech API (系统 TTS) |
| 打包 | electron-builder (NSIS) |
