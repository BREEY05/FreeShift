import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDefaults } from './seed-defaults.ts';

/**
 * 通过 createRequire 加载 node:sqlite。
 * 原因：vitest 2 / vite-node 2 会错误地把 node:sqlite 的前缀剥离成 "sqlite" 再解析，
 * 导致测试收集阶段报 "Failed to load url sqlite"。运行时 require 不经过 Vite 解析。
 */
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
type DatabaseSyncInstance = import('node:sqlite').DatabaseSync;

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../../../');

export type SqlValue = string | number | null | bigint | Uint8Array;

let instance: DatabaseSyncInstance | null = null;
let transactionDepth = 0;

export function defaultDatabasePath(): string {
  return join(repoRoot, 'data', 'freeshift.db');
}

/**
 * 轻量迁移：schema.sql 只做 CREATE TABLE IF NOT EXISTS，老库需要补列。
 * 每一步都幂等（先查 PRAGMA table_info 再决定是否 ALTER）。
 */
export function migrate(db: DatabaseSyncInstance): void {
  const columnsOf = (table: string): Set<string> => {
    const rows = db.prepare('PRAGMA table_info(' + table + ')').all() as { name: string }[];
    return new Set(rows.map((row) => row.name));
  };

  const hasTable = (table: string): boolean => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    return Boolean(row);
  };

  // migrate() is also callable directly against a legacy database.
  if (!hasTable('organization')) {
    const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
    db.exec(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS organization'), schema.indexOf('CREATE TABLE IF NOT EXISTS slot_template')));
  }
  // Disable FK enforcement outside the transaction while rebuilding referenced tables.
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    let org = db.prepare('SELECT id FROM organization ORDER BY id LIMIT 1').get() as { id: number } | undefined;
    if (!org) {
      const admin = hasTable('auth_account') && columnsOf('auth_account').has('role') && columnsOf('auth_account').has('last_login_at')
        ? db.prepare("SELECT email FROM auth_account WHERE role = 'admin' ORDER BY (last_login_at IS NULL), last_login_at DESC, email LIMIT 1").get() as { email: string } | undefined : undefined;
      const result = db.prepare('INSERT INTO organization(name, code, owner_email) VALUES (?, ?, ?)').run('我的组织', randomBytes(4).toString('hex').toUpperCase(), admin?.email ?? process.env.ADMIN_EMAIL ?? '380154843@qq.com');
      org = { id: Number(result.lastInsertRowid) };
    }
    db.prepare("INSERT OR IGNORE INTO org_member(org_id,email,role,status) SELECT id,owner_email,'owner','approved' FROM organization").run();
    for (const table of ['semester', 'slot_template', 'app_user']) {
      if (!columnsOf(table).has('org_id')) db.exec('ALTER TABLE ' + table + ' ADD COLUMN org_id INTEGER NOT NULL DEFAULT ' + org.id + ' REFERENCES organization(id) ON DELETE CASCADE');
    }
    // Rebuild both formerly globally unique name tables, preserving IDs and FK targets.
    for (const table of ['app_user', 'slot_template']) {
      const definition = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string }).sql;
      if (!/UNIQUE\s*\(org_id,\s*name\)/i.test(definition)) {
        const sql = definition.replace('CREATE TABLE ' + table, 'CREATE TABLE ' + table + '_new').replace('CREATE TABLE IF NOT EXISTS ' + table, 'CREATE TABLE ' + table + '_new').replace(/NOT NULL UNIQUE/g, 'NOT NULL');
        db.exec(sql.slice(0, sql.lastIndexOf(')')) + ', UNIQUE(org_id, name))');
        const columns = [...columnsOf(table)].join(',');
        db.exec('INSERT INTO ' + table + '_new (' + columns + ') SELECT ' + columns + ' FROM ' + table);
        db.exec('DROP TABLE ' + table);
        db.exec('ALTER TABLE ' + table + '_new RENAME TO ' + table);
      }
    }
    db.exec('DROP INDEX IF EXISTS ux_semester_active; CREATE UNIQUE INDEX ux_semester_active ON semester(org_id) WHERE is_active = 1; CREATE INDEX IF NOT EXISTS ix_app_user_active ON app_user(org_id,is_active,sort_order)');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('PRAGMA foreign_keys = ON'); }

  if (hasTable('auth_account')) {
    const columns = columnsOf('auth_account');
    if (!columns.has('role')) {
      db.exec("ALTER TABLE auth_account ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
    }
    if (!columns.has('added_by')) {
      db.exec('ALTER TABLE auth_account ADD COLUMN added_by TEXT');
    }
    if (!columns.has('last_login_at')) {
      db.exec('ALTER TABLE auth_account ADD COLUMN last_login_at INTEGER');
    }
  }
}

export function getDb(): DatabaseSyncInstance {
  if (instance) return instance;
  const file = process.env.DATABASE_PATH ?? defaultDatabasePath();
  if (file !== ':memory:') {
    mkdirSync(dirname(resolve(file)), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  seedDefaults(db);
  instance = db;
  return db;
}

export function closeDb(): void {
  if (!instance) return;
  instance.close();
  instance = null;
}

export function all<T = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []): T[] {
  const statement = getDb().prepare(sql);
  return statement.all(...(params as never[])) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []): T | undefined {
  const statement = getDb().prepare(sql);
  return statement.get(...(params as never[])) as T | undefined;
}

export function run(sql: string, params: readonly SqlValue[] = []): { changes: number; lastInsertRowid: number } {
  const statement = getDb().prepare(sql);
  const result = statement.run(...(params as never[]));
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  if (transactionDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  transactionDepth += 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    transactionDepth -= 1;
  }
}
