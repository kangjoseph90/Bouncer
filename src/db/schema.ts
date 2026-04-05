import { Database } from "bun:sqlite";

let db: Database;

export function initDB() {
  db = new Database("bouncer.sqlite");

  // 사용자 테이블: 발급된 API 키와 크레딧 잔액을 보유
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arca_id TEXT UNIQUE NOT NULL,      -- 고유 식별자 (fixed_username 또는 half_12345678)
      arca_type TEXT NOT NULL,           -- 'fixed' | 'half'
      display_name TEXT,                 -- 마지막 확인된 화면 닉네임
      api_key_hash TEXT UNIQUE NOT NULL, -- 발급된 API 키 해시 (보안상 해시만 저장)
      credit_balance INTEGER NOT NULL,   -- 남은 할당량 (크레딧/횟수 공용)
      status TEXT DEFAULT 'active',      -- 'active' | 'revoked' | 'suspended'
      created_at INTEGER NOT NULL,       -- 가입일시 timestamp
      last_used_at INTEGER,              -- 마지막 사용일시
      last_refilled_at INTEGER NOT NULL  -- 마지막 쿼터 리필 타임스탬프 (자동 갱신용)
    )
  `);

  // 사용 로그 테이블 (선택사항, 대시보드 및 통계용)
  db.run(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arca_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      tokens_prompt INTEGER DEFAULT 0,
      tokens_completion INTEGER DEFAULT 0,
      tokens_cached INTEGER DEFAULT 0,   -- 캐시된 토큰 수
      cost INTEGER DEFAULT 0,            -- 차감된 크레딧
      created_at INTEGER NOT NULL,       -- 사용 일시
      FOREIGN KEY(arca_id) REFERENCES users(arca_id)
    )
  `);

  // 서버 전역 사용량(글로벌 쿼터) 통계 테이블
  db.run(`
    CREATE TABLE IF NOT EXISTS server_usage (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_used INTEGER DEFAULT 0,
      last_refilled_at INTEGER NOT NULL
    )
  `);
  db.run(
    `INSERT OR IGNORE INTO server_usage (id, total_used, last_refilled_at) VALUES (1, 0, ${Date.now()})`,
  );

  // 동적 서버 설정 테이블
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // 화이트리스트 테이블
  db.run(`
    CREATE TABLE IF NOT EXISTS whitelist (
      arca_id TEXT PRIMARY KEY,
      display_name TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // WAL 모드 활성화로 동시성 성능 향상
  db.run("PRAGMA journal_mode = WAL;");

  return db;
}

export function getDB() {
  if (!db) return initDB();
  return db;
}
