# 教室呼叫系统

一套用于学校教室与教师办公室之间的呼叫通知系统。教师端发起呼叫，教室端弹窗显示并语音播报。

## 架构

```
教师端（办公室）── WebSocket ──→ 教室端（教室大屏）
      ↑                              ↑
  输入 IP 连接                   托盘驻留 + 呼叫弹窗
  编辑消息模板                   学生名单管理
```

- 教室端内置 WebSocket 服务，教师端直连教室 IP 即可
- 无需服务器，无需数据库，局域网即用

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
cd classroom-app && npm run build    # 输出 dist/教室呼叫-教室端 Setup 1.0.0.exe
cd teacher-app   && npm run build    # 输出 dist/教室呼叫-教师端 Setup 1.0.0.exe
```

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Electron 28 |
| 通信 | WebSocket (ws) |
| 语音 | Web Speech API (系统 TTS) |
| 打包 | electron-builder (NSIS) |
