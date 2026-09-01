# 班达企业云后端

新版后端基于 NestJS、Fastify 和 PostgreSQL，采用模块化单体架构。旧版 `/api/v1`、`/ws/v1` 和原生管理页面已经移除，所有客户端与管理后台统一接入新版协议。

## 技术结构

- NestJS：模块、依赖注入、Guard、Interceptor、Filter 和 OpenAPI。
- Fastify：HTTP 运行时。
- PostgreSQL：组织、权限、教学、同步、任务和审计数据。
- WebSocket：`/ws/client` 用户通道与 `/ws/classroom` 教室设备通道。
- Swagger：`/api/docs`。

主要模块位于 `src/modules/`：

- `auth`：首次初始化、管理员登录、组织化客户端登录、刷新和设备会话。
- `organization`、`campuses`：组织与校区。
- `authorization`：角色、权限和数据范围授权。
- `users`：管理员、教师和登录设备。
- `classrooms`、`teaching`：教室、成员、学生和教学内容。
- `devices`：教室设备运行状态、心跳与吊销；系统不提供接入密钥管理。
- `audit`：企业审计查询。
- `realtime`：新版 WebSocket 网关。

云端禁止接收、保存、转发或记录任何人脸图片、特征向量、裁剪图或实时识别结果。

## 本地启动

1. 复制 `.env.example` 为 `.env` 并填写必填配置。
2. 启动 PostgreSQL。
3. 执行 `pnpm install`。
4. 执行 `pnpm run db:migrate`。
5. 执行 `pnpm run dev`。

服务启动后：

- 管理后台：`/admin/`
- API 前缀：`/api/v2`
- OpenAPI：`/api/docs`
- 存活检查：`GET /api/v2/system/live`
- 就绪检查：`GET /api/v2/system/ready`
- 用户 WebSocket：`/ws/client`
- 教室设备 WebSocket：`/ws/classroom`

## 标准初始化流程

首次打开管理后台时，页面会检查 `GET /api/v2/setup/status`。尚未初始化的服务器会自动进入三步向导：

1. 设置企业名称、企业简称和品牌主色；组织标识由系统自动生成，不要求管理员填写。
2. 由首位管理员本人设置姓名、正式登录账号和至少 12 位密码；系统不生成初始密码。
3. 输入部署时配置的 `SETUP_TOKEN` 完成一次性安全确认。初始化成功后页面自动登录并进入运营总览。

初始化完成后，企业管理后台、教师端和小程序均使用系统生成的组织标识与账号密码登录；教室端绑定也需要组织标识，以避免不同租户的同名账号相互干扰。

管理后台基于 Vue Vben Admin 5，源码位于 `admin-web/`。本地开发可在该目录执行 `pnpm --filter @vben/web-antd run dev`；生产镜像会自动构建并将产物挂载到 `/admin/`。

## Docker

提供以下变量后执行 `docker compose up -d --build`：

```text
POSTGRES_PASSWORD
PUBLIC_URL
ACCESS_TOKEN_SECRET
KEY_PEPPER
SETUP_TOKEN
```

生产环境必须使用 HTTPS/WSS、限制 PostgreSQL 端口、轮换所有密钥，并定期验证备份恢复。

`TRUST_PROXY` 必须填写明确的可信代理范围；Compose 默认使用 `loopback,linklocal,uniquelocal` 以覆盖容器内 Caddy。生产环境会拒绝旧的 `TRUST_PROXY=true`，避免客户端伪造来源 IP。

## 加密备份

`deploy/backup.sh` 会同时备份 PostgreSQL 与 `uploads/`，使用 age 公钥加密，并生成 SHA-256 校验文件。运行前需要提供：

```bash
DATABASE_URL=postgresql://... \
UPLOADS_DIR=/srv/banda/uploads \
BACKUP_AGE_RECIPIENT=age1... \
BACKUP_DIR=/srv/banda/backups \
sh deploy/backup.sh
```

备份脚本会先用 `pg_restore --list` 验证数据库归档；恢复演练时还应校验 `.sha256`、用对应 age 私钥解密，在隔离数据库执行 `pg_restore --clean --if-exists`，并解包 `uploads.tar.gz` 后检查头像和 Logo。不要在生产数据库上直接做恢复演练。

容器启动后可执行运行时端到端验收。该脚本会创建随机测试组织，覆盖登录、权限、令牌轮换、隐私边界和 WebSocket，并在结束时自动清理测试数据：

```bash
docker run --rm --network cloud-server_default --env-file .env \
  -e BASE_URL=http://cloud-server:8080 \
  -v "$PWD/test/runtime-e2e.mjs:/app/test/runtime-e2e.mjs:ro" \
  cloud-server-cloud-server:latest node test/runtime-e2e.mjs
```
