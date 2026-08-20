# 小程序云账号 + 管理后台密钥入口调整 实施方案

日期：2026-08-16
状态：已确认设计，待实施

## 目标

1. 管理后台移除独立「连接密钥」Tab，把教室/教师密钥管理下沉到对应管理界面。
2. 小程序新增本地/云服务两种账号模式；云服务模式支持账号密码注册、登录，并支持微信昵称头像。
3. 微信登录在本版实现。
4. 首次接入云服务后，服务端为小程序账号下发唯一用户 id。

## 关键决策

- 本地模式：账号密码注册/登录，不连云。
- 云服务模式：
  - 注册：服务器地址 + tk_ 密钥 + 账号 + 密码 + 昵称 + 头像。
  - 登录：服务器地址 + 账号 + 密码（或微信登录）。
- 桌面教师端保持小程序扫码登录，不增加账号密码登录。
- 头像以文件形式上传到云服务器，数据库只存 URL。

## 服务端

- 迁移 `006_mini_program_accounts.sql`：
  - users 增加 avatar_url、nickname 字段（nickname 可复用 name 或新增）。
  - 教师 login_name 唯一约束。
- 新接口：
  - POST /api/v1/auth/mini-program/register
  - POST /api/v1/auth/mini-program/login
  - POST /api/v1/auth/mini-program/wechat
  - POST /api/v1/teacher/avatar
  - GET /uploads/avatars/:file
- 密码 scrypt 哈希；微信登录通过 code2session 换取 openid。

## 后台

- 移除 keysPage。
- 教室配置页新增教室密钥卡片。
- 教师详情弹窗新增教师身份密钥卡片。

## 小程序

- 登录页增加模式切换、注册、登录、微信一键登录。
- 我的页面云服务区域改为注册/登录流程并展示头像昵称。
- utils/cloud.js 增加 register/login/wechat/uploadAvatar。
- session 存储增加云端 userId、avatarUrl、nickname。

## 兼容性

- 旧 tk_ 密钥兑换保留。
- 桌面扫码登录不变。
- 现有教室/成员/作业逻辑不变。

## 验证

- cloud-server 全量测试 + TypeScript 构建。
- mini-program 测试 + 语法检查。
- 后台静态选择器核对。
