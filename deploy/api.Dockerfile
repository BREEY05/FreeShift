# FreeShift API 镜像：Node 24（原生 TypeScript 运行）+ SQLite
FROM node:24-bookworm-slim

RUN npm install -g pnpm@11.28.5 \
  && pnpm --version

WORKDIR /app

# 先复制清单以复用依赖层缓存
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @freeshift/shared build

ENV NODE_ENV=production \
    DATABASE_PATH=/data/freeshift.db \
    PORT=3000 \
    HOST=0.0.0.0 \
    TZ=Asia/Shanghai \
    LOG_LEVEL=info

RUN mkdir -p /data /backups && chown -R node:node /data /backups /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/server/src/index.ts"]
