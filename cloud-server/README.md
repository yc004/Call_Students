# 班达云服务端

当前实现包含 PostgreSQL 数据结构、首次初始化、管理员登录、教室与教师管理、一次性连接密钥、设备注册、快照/增量/幂等操作 API、WebSocket 网关和管理面板。

服务端明确拒绝所有 `face-*` 云消息，不创建人脸数据表。人脸功能由客户端与教室端在局域网内完成。

## 本地开发

1. 复制 `.env.example` 为 `.env` 并填写所有必填项。
2. 准备 PostgreSQL 数据库。
3. 执行 `corepack enable && pnpm install`。
4. 执行 `pnpm run db:migrate`。
5. 执行 `pnpm run dev`。
6. 打开 `http://127.0.0.1:8080/admin/`。

## Docker Compose

在部署环境提供以下变量：

```text
POSTGRES_PASSWORD
PUBLIC_URL
ACCESS_TOKEN_SECRET
KEY_PEPPER
SETUP_TOKEN
```

然后执行：

```sh
docker compose up -d --build
```

生产环境应在服务前部署 Caddy 或 Nginx，并只公开 HTTPS/WSS 地址。

## 客户端接入

1. 管理员打开 `/admin/` 完成首次初始化并创建教室。
2. 为教室生成 `ck_` 密钥，在教室端托盘中打开“云服务设置”并填入服务器地址和密钥。
3. 管理员先创建唯一教师账号，再生成分配给该账号的 `tk_` 身份密钥；教师用它授权小程序或教师端连接该云账号。
4. 教师与教室的成员关系不使用密钥建立：局域网加入和班主任配置会由教室端同步到云端，云管理员也可以在教室“成员”面板中直接管理。
5. 小程序扫码登录电脑教师端时，云会话会通过一次性局域网通道同步到教师端。

微信小程序正式环境必须使用可信 HTTPS 域名，并在微信公众平台把该域名加入 `request` 与 `socket` 合法域名。开发环境可以在开发者工具中临时关闭域名校验，但不能作为生产方案。

小程序支持本地模式与云服务模式。云服务模式可使用 `tk_` 密钥注册，或使用账号密码 / 微信一键登录；注册和首次登录会返回服务端唯一 `userId`。微信昵称与头像会同步到云端，头像文件保存于 `/app/uploads/avatars`（Docker Compose 已挂载 `banda-uploads` 卷），并通过 `/uploads/avatars/` 静态托管。

除回环地址上的本机开发外，三端会拒绝 HTTP/WS 明文云地址。REST 请求必须携带客户端类型和协议版本，访问令牌绑定已登记设备；WebSocket 凭证在 WSS 建立后通过首条认证消息发送，不会出现在 URL 和代理访问日志中。客户端标识只是协议筛选，真正的身份依据是分配给实体的连接密钥、可撤销设备令牌、短期 JWT 与数据库中的设备记录。

## 数据与隐私边界

- 云端保存教师、教室、成员、学生名单、作业、通知、提交状态、设备状态和审计日志。
- 教室端上传普通教学快照时会先删除 `attendance`、`pendingFaces`、`faceDetections` 等字段。
- 服务端会再次递归检查请求和 WebSocket 消息，发现人脸图片、特征向量、裁剪图或人脸消息时立即拒绝。
- 教师端和小程序只在进入出勤功能时使用教室连接码发起局域网握手；失败不影响其他云功能。

## 运维

- 存活检查：`GET /health/live`
- 数据库就绪检查：`GET /health/ready`
- Caddy 反向代理示例：`deploy/Caddyfile.example`
- PostgreSQL 备份：设置 `DATABASE_URL` 后执行 `deploy/backup.sh`
- 生产环境必须更换所有示例密钥，限制 PostgreSQL 端口暴露，并定期验证备份恢复。
