import { getDB } from "./schema";
import * as crypto from "crypto";
import { config } from "../utils/config";

// 1. 보안 함수: API 키 생성 및 해싱
export function generateApiKey(): string {
  // 32바이트(256비트) 안전한 난수를 헥스 문자열로 변환 (총 64글자 + 접두사)
  return "bnc-" + crypto.randomBytes(32).toString("hex");
}

export function hashApiKey(apiKey: string): string {
  // 저장용은 SHA-256 해시값만 저장
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function checkAndRefillServerQuota() {
  if (config.GLOBAL_QUOTA_REFILL_MODE === "none") return;

  const db = getDB();
  const usage = db
    .query(`SELECT last_refilled_at FROM server_usage WHERE id = 1`)
    .get() as { last_refilled_at: number } | undefined;
  if (!usage) return;

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  let shouldRefill = false;

  if (config.GLOBAL_QUOTA_REFILL_MODE === "daily") {
    // 하루 이상 지났으면 리필
    shouldRefill = now - usage.last_refilled_at >= oneDayMs;
  } else if (config.GLOBAL_QUOTA_REFILL_MODE === "monthly") {
    const nowDate = new Date(now);
    const lastDate = new Date(usage.last_refilled_at);
    // 월이 바뀌었거나, 연도가 바뀌었으면 리필
    shouldRefill =
      nowDate.getMonth() !== lastDate.getMonth() ||
      nowDate.getFullYear() !== lastDate.getFullYear();
  }

  if (shouldRefill) {
    db.query(
      `
      UPDATE server_usage
      SET total_used = 0, last_refilled_at = $now
      WHERE id = 1
    `,
    ).run({
      $now: now,
    });
  }
}

export function checkGlobalQuotaAllowed(cost: number = 0): boolean {
  if (config.GLOBAL_QUOTA === Infinity) return true;

  checkAndRefillServerQuota(); // 지연 갱신 체크

  const db = getDB();
  const usage = db
    .query(`SELECT total_used FROM server_usage WHERE id = 1`)
    .get() as { total_used: number } | undefined;
  if (!usage) return true;
  return usage.total_used + cost <= config.GLOBAL_QUOTA;
}

export function incrementGlobalQuota(cost: number) {
  if (config.GLOBAL_QUOTA === Infinity) return;
  const db = getDB();
  db.query(
    `UPDATE server_usage SET total_used = total_used + $cost WHERE id = 1`,
  ).run({ $cost: cost });
}

// 2. DB 작업: 유저 생성 및 키 발급
export function createUser(
  arcaId: string,
  arcaType: string,
  displayName: string,
): { apiKey: string } {
  const apiKey = generateApiKey();
  const apiHash = hashApiKey(apiKey);
  const db = getDB();

  db.query(
    `
    INSERT INTO users (arca_id, arca_type, display_name, api_key_hash, credit_balance, created_at, last_refilled_at)
    VALUES ($arca_id, $arca_type, $display_name, $api_key_hash, $credit_balance, $created_at, $last_refilled_at)
  `,
  ).run({
    $arca_id: arcaId,
    $arca_type: arcaType,
    $display_name: displayName,
    $api_key_hash: apiHash,
    $credit_balance: config.USER_QUOTA,
    $created_at: Date.now(),
    $last_refilled_at: Date.now(),
  });

  return { apiKey };
}

// 3. DB 작업: 기존 유저 키 재발급(Rotation) - 쿼터 유지
// 정지(suspended)된 유저가 아닌 경우에만 새 키를 발급하고, 혹시 파기(revoked) 상태였다면 다시 active로 복구
export function revokeAndReissue(
  arcaId: string,
  displayName: string,
): { apiKey: string } {
  const apiKey = generateApiKey();
  const apiHash = hashApiKey(apiKey);
  const db = getDB();

  db.query(
    `
    UPDATE users 
    SET api_key_hash = $api_key_hash, display_name = $display_name, status = 'active'
    WHERE arca_id = $arca_id AND status != 'suspended'
  `,
  ).run({
    $arca_id: arcaId,
    $display_name: displayName,
    $api_key_hash: apiHash,
  });

  return { apiKey };
}

// 4. DB 작업: 유저가 스스로 키 영구 파기(Revoke)
export function revokeKey(arcaId: string) {
  const db = getDB();

  db.query(
    `
    UPDATE users 
    SET status = 'revoked'
    WHERE arca_id = $arca_id AND status = 'active'
  `,
  ).run({
    $arca_id: arcaId,
  });
}

// 4. DB 작업: 지연 할당량 충전 및 유저 조회 (API 프록시 인증용)
export function getUserByApiKey(rawApiKey: string) {
  const hash = hashApiKey(rawApiKey);
  const db = getDB();

  const user = db
    .query(
      `
    SELECT id, arca_id, arca_type, display_name, credit_balance, status, last_refilled_at 
    FROM users 
    WHERE api_key_hash = $hash
  `,
    )
    .get({ $hash: hash }) as
    | {
        id: number;
        arca_id: string;
        arca_type: string;
        display_name: string;
        credit_balance: number;
        status: string;
        last_refilled_at: number;
      }
    | undefined;

  if (user && user.status === "active") {
    checkAndRefillQuota(user.arca_id, user.last_refilled_at);
    // 갱신되었을 수도 있으므로 최신 크레딧 잔액을 위해 다시 조회
    return db
      .query(
        `
      SELECT arca_id, display_name, credit_balance, status 
      FROM users WHERE id = $id
    `,
      )
      .get({ $id: user.id }) as any;
  }

  return user;
}

function checkAndRefillQuota(arcaId: string, lastRefilledAt: number) {
  if (config.USER_QUOTA_REFILL_MODE === "none") return;

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  let shouldRefill = false;

  if (config.USER_QUOTA_REFILL_MODE === "daily") {
    // 하루 이상 지났으면 리필
    shouldRefill = now - lastRefilledAt >= oneDayMs;
  } else if (config.USER_QUOTA_REFILL_MODE === "monthly") {
    const nowDate = new Date(now);
    const lastDate = new Date(lastRefilledAt);
    // 월이 바뀌었거나, 연도가 바뀌었으면 리필
    shouldRefill =
      nowDate.getMonth() !== lastDate.getMonth() ||
      nowDate.getFullYear() !== lastDate.getFullYear();
  }

  if (shouldRefill) {
    getDB()
      .query(
        `
      UPDATE users
      SET credit_balance = $quota, last_refilled_at = $now
      WHERE arca_id = $arca_id
    `,
      )
      .run({
        $quota: config.USER_QUOTA,
        $now: now,
        $arca_id: arcaId,
      });
  }
}

export function getUserByArcaId(arcaId: string) {
  const db = getDB();
  return db
    .query(`SELECT id, status FROM users WHERE arca_id = $arca_id`)
    .get({ $arca_id: arcaId }) as { id: number; status: string } | undefined;
}

// 5. DB 작업: 크레딧 차감 및 로깅
export function chargeUsage(
  arcaId: string,
  modelName: string,
  promptTokens: number,
  completionTokens: number,
  totalCost: number,
  cachedTokens: number = 0,
) {
  const db = getDB();

  // 1. 유저 쿼터 차감
  db.query(
    `
    UPDATE users 
    SET credit_balance = credit_balance - $cost, last_used_at = $now
    WHERE arca_id = $arca_id
  `,
  ).run({
    $cost: totalCost,
    $now: Date.now(),
    $arca_id: arcaId,
  });

  // 2. 로그 인서트 (지연 쓰기로 최적화 가능하지만 현재는 동시 처리)
  db.query(
    `
    INSERT INTO usage_logs (arca_id, model_name, tokens_prompt, tokens_completion, tokens_cached, cost, created_at)
    VALUES ($arca_id, $model, $prompt, $completion, $cached, $cost, $now)
  `,
  ).run({
    $arca_id: arcaId,
    $model: modelName,
    $prompt: promptTokens,
    $completion: completionTokens,
    $cached: cachedTokens,
    $cost: totalCost,
    $now: Date.now(),
  });

  // 3. 서버 전역 쿼터 차감
  incrementGlobalQuota(totalCost);
}

// 6. DB 통계 (대시보드 / 메인 페이지 용)
export function getServerStats() {
  const db = getDB();
  const totalUsers = db.query(`SELECT COUNT(*) as count FROM users`).get() as {
    count: number;
  };
  const last24Hours = Date.now() - 24 * 60 * 60 * 1000;
  const activeUsers = db
    .query(`SELECT COUNT(*) as count FROM users WHERE last_used_at > $time`)
    .get({ $time: last24Hours }) as { count: number };

  return {
    totalUsers: totalUsers?.count || 0,
    activeUsers: activeUsers?.count || 0,
  };
}

export function getUserCounts() {
  const db = getDB();
  const totalUsers = db.query(`SELECT COUNT(*) as count FROM users`).get() as {
    count: number;
  };
  const last24Hours = Date.now() - 24 * 60 * 60 * 1000;
  const activeUsers = db
    .query(`SELECT COUNT(*) as count FROM users WHERE last_used_at > $time`)
    .get({ $time: last24Hours }) as { count: number };

  return {
    total: totalUsers?.count || 0,
    active: activeUsers?.count || 0,
  };
}

// 7. 동적 설정(Settings) 입출력
export function getSetting(key: string, defaultValue?: string): string {
  const db = getDB();
  const row = db
    .query(`SELECT value FROM settings WHERE key = $key`)
    .get({ $key: key }) as { value: string } | undefined;
  return row ? row.value : defaultValue || "";
}

export function setSetting(key: string, value: string) {
  const db = getDB();
  db.query(
    `
    INSERT INTO settings (key, value) VALUES ($key, $value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run({ $key: key, $value: value });
}

// 8. 어드민: 유저 관리
export function adminSearchUser(targetId: string) {
  const db = getDB();
  // id, arca_id, display_name 에 매치되는지 확인
  return db
    .query(
      `
    SELECT arca_id, display_name, credit_balance, status, created_at, last_used_at
    FROM users 
    WHERE arca_id LIKE $target OR display_name LIKE $target
    LIMIT 10
  `,
    )
    .all({ $target: `%${targetId}%` });
}

export function adminSuspendUser(arcaId: string) {
  const db = getDB();
  // suspended 처리 후 키 삭제(해시는 무작위로 날려서 무력화)
  db.query(
    `
    UPDATE users 
    SET status = 'suspended', api_key_hash = $random_hash 
    WHERE arca_id = $arca_id
  `,
  ).run({
    $arca_id: arcaId,
    $random_hash: "suspended-" + Date.now(),
  });
}
