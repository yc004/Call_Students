FROM node:22-bookworm-slim AS admin-build
ENV CI=true
WORKDIR /admin
RUN corepack enable
COPY admin-web/package.json admin-web/pnpm-lock.yaml admin-web/pnpm-workspace.yaml ./
COPY admin-web/internal ./internal
COPY admin-web/packages ./packages
COPY admin-web/scripts ./scripts
COPY admin-web/apps/web-antd ./apps/web-antd
COPY admin-web/turbo.json admin-web/vitest.config.ts admin-web/oxfmt.config.ts admin-web/oxlint.config.ts admin-web/eslint.config.mjs admin-web/stylelint.config.mjs ./
RUN pnpm install --frozen-lockfile && pnpm --filter @vben/web-antd run build

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN pnpm run build && pnpm prune --prod

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=admin-build /admin/apps/web-antd/dist ./admin-web
ENV ADMIN_WEB_ROOT=/app/admin-web
RUN mkdir -p /app/uploads/avatars && chown -R node:node /app/uploads
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
