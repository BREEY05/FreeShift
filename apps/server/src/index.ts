import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { getDb } from './db/index.ts';

// Local SMTP configuration stays outside Git; systemd loads its own EnvironmentFile.
const localEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

function resolveStaticDir(): string | undefined {
  if (process.env.SERVE_STATIC === '0' || process.env.SERVE_STATIC === 'false') return undefined;
  let dir = process.env.SERVE_STATIC;
  if (!dir) {
    // 自动探测 monorepo 内前端构建产物，找不到就不托管静态（线上由 Nginx 托管）
    const here = dirname(fileURLToPath(import.meta.url));
    const candidate = resolve(here, '../../web/dist');
    if (!existsSync(join(candidate, 'index.html'))) return undefined;
    dir = candidate;
  }
  const abs = resolve(dir);
  return existsSync(join(abs, 'index.html')) ? abs : undefined;
}

const staticDir = resolveStaticDir();
const app = buildApp({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  ...(staticDir ? { staticDir } : {}),
});

getDb();
if (staticDir) {
  app.log.info(`托管前端静态文件：${staticDir}`);
}
try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
