#!/usr/bin/env node
/**
 * SQLite 在线备份：VACUUM INTO 生成一致性快照，并保留最近 N 份。
 * 用法（容器内）：node scripts/backup.mjs [保留份数]
 * 用法（宿主机）：docker compose exec -T api node scripts/backup.mjs 7
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const dbPath = process.env.DATABASE_PATH ?? join(repoRoot, 'data', 'freeshift.db');
const backupDir = process.env.BACKUP_DIR ?? '/backups';
const keep = Number(process.argv[2] ?? 7);

mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = join(backupDir, 'freeshift-' + stamp + '.db');

const db = new DatabaseSync(dbPath);
db.prepare('VACUUM INTO ?').run(target);
db.close();

const files = readdirSync(backupDir)
  .filter((name) => name.startsWith('freeshift-') && name.endsWith('.db'))
  .map((name) => ({ name, path: join(backupDir, name), mtime: statSync(join(backupDir, name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

for (const file of files.slice(keep)) {
  unlinkSync(file.path);
}

console.log('[backup] 已生成 ' + target + '，保留最近 ' + keep + ' 份');
