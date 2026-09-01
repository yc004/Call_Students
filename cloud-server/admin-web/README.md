# 班达企业管理中心

本项目基于 Vue Vben Admin 5.7 与 Ant Design Vue 构建，仅连接班达企业后端新版 `/api/v2` 接口。

## 开发

要求 Node.js 22.18+ 或 24.12+，以及 pnpm 11+。

```bash
pnpm install
pnpm --filter @vben/web-antd run dev
```

开发环境 API 地址在 `apps/web-antd/.env.development` 配置。生产构建使用 `/admin/` 作为基础路径，并请求同源 `/api/v2`。

```bash
pnpm --filter @vben/web-antd run typecheck
pnpm --filter @vben/web-antd run build
```

企业页面位于 `apps/web-antd/src/views/enterprise/`，路由及服务端权限编码位于 `apps/web-antd/src/router/routes/modules/enterprise.ts`。

Vben 原项目采用 MIT License，许可文件见本目录 `LICENSE`。
