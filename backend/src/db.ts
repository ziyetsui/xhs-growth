import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AnalysisJob, FeishuRecord, CreateRecordPayload } from './types';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');

let db: Database.Database;

function ensureColumnExists(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id            TEXT PRIMARY KEY,
      keyword       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'IDLE',
      mode          TEXT,
      target_note_id TEXT,
      notes_json    TEXT,
      analysis_json TEXT,
      error_code    TEXT,
      error_stage   TEXT,
      error_message TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feishu_records (
      id                TEXT PRIMARY KEY,
      job_id            TEXT NOT NULL,
      note_id           TEXT NOT NULL,
      note_url          TEXT NOT NULL,
      title             TEXT NOT NULL,
      author            TEXT NOT NULL,
      cover_url         TEXT NOT NULL,
      like_count        INTEGER NOT NULL,
      follower_count    INTEGER NOT NULL,
      potential_score   REAL NOT NULL DEFAULT 0,
      note_content      TEXT NOT NULL,
      analysis_result   TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'PENDING',
      feishu_app_token  TEXT,
      feishu_table_id   TEXT,
      feishu_record_url TEXT,
      platform_error_code TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
  `);

  ensureColumnExists('feishu_records', 'potential_score', 'REAL NOT NULL DEFAULT 0');
  ensureColumnExists('feishu_records', 'feishu_app_token', 'TEXT');
  ensureColumnExists('feishu_records', 'feishu_table_id', 'TEXT');
  ensureColumnExists('analysis_jobs', 'error_message', 'TEXT');

  console.log('✅ 数据库初始化完成');
}

// ==================== AnalysisJob CRUD ====================

export function createJob(keyword: string): AnalysisJob {
  const now = new Date().toISOString();
  const job: AnalysisJob = {
    id: uuidv4(),
    keyword,
    status: 'IDLE',
    mode: null,
    target_note_id: null,
    notes_json: null,
    analysis_json: null,
    error_code: null,
    error_stage: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO analysis_jobs (id, keyword, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(job.id, job.keyword, job.status, job.created_at, job.updated_at);

  return job;
}

export function getJob(id: string): AnalysisJob | undefined {
  return db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(id) as AnalysisJob | undefined;
}

export function updateJob(id: string, fields: Partial<AnalysisJob>): void {
  const sets: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'id') continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE analysis_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function listJobs(limit = 20): AnalysisJob[] {
  return db.prepare('SELECT * FROM analysis_jobs ORDER BY created_at DESC LIMIT ?').all(limit) as AnalysisJob[];
}

// ==================== FeishuRecord CRUD ====================

export function createRecord(payload: CreateRecordPayload): FeishuRecord {
  const now = new Date().toISOString();
  const record: FeishuRecord = {
    id: uuidv4(),
    job_id: payload.job_id,
    note_id: payload.note_id,
    note_url: payload.note_url,
    title: payload.title,
    author: payload.author,
    cover_url: payload.cover_url,
    like_count: payload.like_count,
    follower_count: payload.follower_count,
    potential_score: payload.potential_score,
    note_content: payload.note_content,
    analysis_result: JSON.stringify(payload.analysis_result),
    status: 'PENDING',
    feishu_app_token: payload.feishu_app_token || null,
    feishu_table_id: payload.feishu_table_id || null,
    feishu_record_url: null,
    platform_error_code: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO feishu_records
    (id, job_id, note_id, note_url, title, author, cover_url, like_count, follower_count, potential_score, note_content, analysis_result, status, feishu_app_token, feishu_table_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id, record.job_id, record.note_id, record.note_url,
    record.title, record.author, record.cover_url,
    record.like_count, record.follower_count, record.potential_score, record.note_content,
    record.analysis_result, record.status, record.feishu_app_token, record.feishu_table_id,
    record.created_at, record.updated_at
  );

  return record;
}

export function getRecord(id: string): FeishuRecord | undefined {
  return db.prepare('SELECT * FROM feishu_records WHERE id = ?').get(id) as FeishuRecord | undefined;
}

export function updateRecord(id: string, fields: Partial<FeishuRecord>): void {
  const sets: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'id') continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE feishu_records SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function listRecords(jobId?: string, limit = 50): FeishuRecord[] {
  if (jobId) {
    return db.prepare('SELECT * FROM feishu_records WHERE job_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(jobId, limit) as FeishuRecord[];
  }
  return db.prepare('SELECT * FROM feishu_records ORDER BY created_at DESC LIMIT ?')
    .all(limit) as FeishuRecord[];
}
