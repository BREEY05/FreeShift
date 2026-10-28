import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './lib/errors.ts';
import { getDb } from './db/index.ts';
import { semesterRoutes } from './routes/semester.ts';
import { templateRoutes } from './routes/templates.ts';
import { slotRoutes } from './routes/slots.ts';
import { userRoutes } from './routes/users.ts';
import { scheduleRoutes } from './routes/schedules.ts';
import { boardRoutes } from './routes/board.ts';
import { recommendRoutes } from './routes/recommend.ts';
import { statsRoutes } from './routes/stats.ts';
import { dataRoutes } from './routes/data.ts';
import { installAuth } from './routes/auth.ts';

export const APP_VERSION = process.env.APP_VERSION ?? '1.0.0';

export interface BuildAppOptions {
  logger?: boolean | { level: string };
  /** 本地离线版用：托管前端构建产物目录（相当于 Nginx 的静态文件服务） */
  staticDir?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 5 * 1024 * 1024,
  });

  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '参数校验失败',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }
    const fastifyError = error as Error & { statusCode?: number; code?: string };
    const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
    if (statusCode < 500) {
      return reply.status(statusCode).send({
        error: { code: fastifyError.code ?? 'BAD_REQUEST', message: fastifyError.message },
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
    });
  });

  installAuth(app);

  const staticDir = options.staticDir;
  const staticReady = Boolean(staticDir && existsSync(join(staticDir, 'index.html')));

  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split('?')[0] ?? '/';
    const isApi = url.startsWith('/api/') || url === '/healthz';
    if (!isApi && staticReady && (request.method === 'GET' || request.method === 'HEAD')) {
      const relative = url.replace(/^\/+/, '');
      const candidate = normalize(join(staticDir as string, relative));
      const inside = candidate === (staticDir as string) || candidate.startsWith((staticDir as string) + sep);
      if (relative && inside && existsSync(candidate) && !candidate.endsWith(sep)) {
        const probed = candidate;
        if (!probed.includes('\0')) {
          const type = MIME_TYPES[extname(probed).toLowerCase()] ?? 'application/octet-stream';
          const immutable = probed.includes(`${sep}assets${sep}`);
          return reply
            .type(type)
            .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
            .send(readFileSync(probed));
        }
      }
      // SPA 回退
      return reply
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-cache')
        .send(readFileSync(join(staticDir as string, 'index.html')));
    }
    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: '接口不存在：' + request.method + ' ' + request.url,
      },
    });
  });

  app.get('/healthz', async () => {
    getDb().prepare('SELECT 1 AS ok').get();
    return { status: 'ok', db: 'ok', version: APP_VERSION };
  });

  app.register(
    async (api) => {
      api.get('/meta', async () => ({
        data: {
          version: APP_VERSION,
          db: 'sqlite',
          timezone: process.env.TZ ?? 'Asia/Shanghai',
        },
      }));
      await api.register(semesterRoutes, { prefix: '/semester' });
      await api.register(templateRoutes, { prefix: '/templates' });
      await api.register(slotRoutes, { prefix: '/slots' });
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(scheduleRoutes, { prefix: '/schedules' });
      await api.register(boardRoutes, { prefix: '/board' });
      await api.register(recommendRoutes, { prefix: '/recommend' });
      await api.register(statsRoutes, { prefix: '/stats' });
      await api.register(dataRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}