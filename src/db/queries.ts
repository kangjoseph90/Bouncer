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
    const refilled = checkAndRefillQuota(user.arca_id, user.last_refilled_at);

    // 갱신된 경우에만 최신 크레딧 잔액을 위해 다시 조회
    if (refilled) {
      return db
        .query(
          `
        SELECT arca_id, display_name, credit_balance, status 
        FROM users WHERE id = $id
      `,
        )
        .get({ $id: user.id }) as any;
    }

    // 갱신되지 않은 경우 기존에 불러온 데이터를 필요한 필드만 남겨서 반환
    return {
      arca_id: user.arca_id,
      display_name: user.display_name,
      credit_balance: user.credit_balance,
      status: user.status,
    };
  }

  return user;
}

function checkAndRefillQuota(arcaId: string, lastRefilledAt: number): boolean {
  if (config.USER_QUOTA_REFILL_MODE === "none") return false;

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
    return true;
  }
  return false;
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
  const stats = getServerStats();

  return {
    total: stats.totalUsers,
    active: stats.activeUsers,
  };
}

// 7. 모니터링 통계 쿼리

export function getResolutionConfig(resolution: string | undefined) {
  let days = 30;
  let groupExpr = "date(created_at / 1000, 'unixepoch', 'localtime')";

  if (resolution === "1h") {
    days = 2;
    groupExpr =
      "datetime((created_at / 1000 / 3600) * 3600, 'unixepoch', 'localtime')";
  } else if (resolution === "15m") {
    days = 0.5; // 12시간
    groupExpr =
      "datetime((created_at / 1000 / 900) * 900, 'unixepoch', 'localtime')";
  } else if (resolution === "5m") {
    days = 4 / 24; // 4시간
    groupExpr =
      "datetime((created_at / 1000 / 300) * 300, 'unixepoch', 'localtime')";
  }
  return { days, groupExpr };
}

// 서버 전체 사용량 (해상도 지원)
export function getServerDailyUsage(resolution: string = "1d") {
  const db = getDB();
  const { days, groupExpr } = getResolutionConfig(resolution);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return db
    .query(
      `
    SELECT
      ${groupExpr} as date,
      COUNT(*) as total_requests,
      SUM(tokens_prompt) as total_prompt,
      SUM(tokens_completion) as total_completion,
      SUM(tokens_cached) as total_cached,
      SUM(cost) as total_cost
    FROM usage_logs
    WHERE created_at >= $since
    GROUP BY date
    ORDER BY date ASC
  `,
    )
    .all({ $since: since }) as {
    date: string;
    total_requests: number;
    total_prompt: number;
    total_completion: number;
    total_cached: number;
    total_cost: number;
  }[];
}

// 서버 전체 모델별 사용 집계 (최근 N일)
export function getServerUsageByModel(days: number = 7) {
  const db = getDB();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return db
    .query(
      `
    SELECT
      model_name,
      COUNT(*) as total_requests,
      SUM(COALESCE(tokens_prompt, 0) + COALESCE(tokens_completion, 0) + COALESCE(tokens_cached, 0)) as total_tokens,
      SUM(cost) as total_cost
    FROM usage_logs
    WHERE created_at >= $since
    GROUP BY model_name
    ORDER BY total_cost DESC
  `,
    )
    .all({ $since: since }) as {
    model_name: string;
    total_requests: number;
    total_tokens: number;
    total_cost: number;
  }[];
}

// 글로벌 쿼터 현재 상태
export function getGlobalQuotaStatus() {
  const db = getDB();
  return db
    .query(`SELECT total_used, last_refilled_at FROM server_usage WHERE id = 1`)
    .get() as { total_used: number; last_refilled_at: number } | undefined;
}

// 개인 일별 사용량 (해상도 지원)
export function getUserDailyUsage(arcaId: string, resolution: string = "1d") {
  const db = getDB();
  const { days, groupExpr } = getResolutionConfig(resolution);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return db
    .query(
      `
    SELECT
      ${groupExpr} as date,
      COUNT(*) as total_requests,
      SUM(tokens_prompt) as total_prompt,
      SUM(tokens_completion) as total_completion,
      SUM(tokens_cached) as total_cached,
      SUM(cost) as total_cost
    FROM usage_logs
    WHERE arca_id = $arca_id AND created_at >= $since
    GROUP BY date
    ORDER BY date ASC
  `,
    )
    .all({ $arca_id: arcaId, $since: since }) as {
    date: string;
    total_requests: number;
    total_prompt: number;
    total_completion: number;
    total_cached: number;
    total_cost: number;
  }[];
}

// 개인 모델별 사용 집계 (최근 N일)
export function getUserUsageByModel(arcaId: string, days: number = 7) {
  const db = getDB();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return db
    .query(
      `
    SELECT
      model_name,
      COUNT(*) as total_requests,
      SUM(cost) as total_cost,
      SUM(COALESCE(tokens_prompt, 0) + COALESCE(tokens_completion, 0) + COALESCE(tokens_cached, 0)) as total_tokens
    FROM usage_logs
    WHERE arca_id = $arca_id AND created_at >= $since
    GROUP BY model_name
    ORDER BY total_cost DESC
  `,
    )
    .all({ $arca_id: arcaId, $since: since }) as {
    model_name: string;
    total_requests: number;
    total_cost: number;
    total_tokens: number;
  }[];
}

// 개인 최근 사용 로그
export function getUserRecentLogs(arcaId: string, limit: number = 20) {
  const db = getDB();
  return db
    .query(
      `
    SELECT model_name, tokens_prompt, tokens_completion, tokens_cached, cost, created_at
    FROM usage_logs
    WHERE arca_id = $arca_id
    ORDER BY created_at DESC
    LIMIT $limit
  `,
    )
    .all({ $arca_id: arcaId, $limit: limit }) as {
    model_name: string;
    tokens_prompt: number;
    tokens_completion: number;
    tokens_cached: number;
    cost: number;
    created_at: number;
  }[];
}

// 어드민: 최근 N일 비용 기준 TOP 사용자
export function getTopUsersByCost(days: number = 7, limit: number = 10) {
  const db = getDB();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return db
    .query(
      `
    SELECT
      u.arca_id,
      u.display_name,
      u.credit_balance,
      u.status,
      COUNT(l.id) as total_requests,
      COALESCE(SUM(l.cost), 0) as total_cost
    FROM users u
    LEFT JOIN usage_logs l ON u.arca_id = l.arca_id AND l.created_at >= $since
    GROUP BY u.arca_id
    ORDER BY total_cost DESC
    LIMIT $limit
  `,
    )
    .all({ $since: since, $limit: limit }) as {
    arca_id: string;
    display_name: string;
    credit_balance: number;
    status: string;
    total_requests: number;
    total_cost: number;
  }[];
}

// 어드민: 특정 유저 상세 사용 통계
export function getUserDetailStats(arcaId: string, resolution: string = "1d") {
  const daily = getUserDailyUsage(arcaId, resolution);
  const { days } = getResolutionConfig(resolution);
  const byModel = getUserUsageByModel(arcaId, days);
  const recentLogs = getUserRecentLogs(arcaId, 30);

  const db = getDB();
  const totals = db
    .query(
      `
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(cost), 0) as total_cost,
      COALESCE(SUM(tokens_prompt), 0) as total_prompt,
      COALESCE(SUM(tokens_completion), 0) as total_completion
    FROM usage_logs
    WHERE arca_id = $arca_id
  `,
    )
    .get({ $arca_id: arcaId }) as {
    total_requests: number;
    total_cost: number;
    total_prompt: number;
    total_completion: number;
  };

  return { daily, byModel, recentLogs, totals };
}

// 8. 동적 설정(Settings) 입출력
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
export function adminSearchUser(query: string) {
  const db = getDB();

  // 1. @ 제거하여 실제 저장된 닉네임/ID와 매칭 (예: @nickname -> nickname)
  const cleanQuery = query.startsWith("@") ? query.slice(1) : query;

  // 2. # 태그 분리 처리 (예: nickname#123456 -> nickname 과 123456으로 분리)
  let namePart = cleanQuery;
  let idPart = cleanQuery;

  if (cleanQuery.includes("#")) {
    const parts = cleanQuery.split("#");
    namePart = parts[0];
    idPart = parts[1];
  }

  // 3. 닉네임(display_name) 또는 고유ID(arca_id) 중 하나라도 매칭되면 반환
  // LIKE 연산 시 %를 붙여 부분 일치 검색
  return db
    .query(
      `
    SELECT arca_id, display_name, credit_balance, status, created_at, last_used_at
    FROM users 
    WHERE display_name LIKE $name 
       OR arca_id LIKE $id
    LIMIT 15
  `,
    )
    .all({
      $name: `%${namePart}%`,
      $id: `%${idPart}%`,
    });
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

export function adminUnsuspendUser(arcaId: string) {
  const db = getDB();
  // 정지된 유저를 'revoked' 상태로 복구.
  // 키가 없는 상태이므로 revoked가 더 적절하며, 이후 유저가 인증을 통해 새 키를 발급받으면 active로 전환됨.
  db.query(
    `
    UPDATE users 
    SET status = 'revoked'
    WHERE arca_id = $arca_id
  `,
  ).run({
    $arca_id: arcaId,
  });
}
export function adminRevokeKey(arcaId: string) {
  const db = getDB();
  // 'active' 상태인 유저의 키만 파기할 수 있도록 함 (이미 정지되었거나 파기된 경우 제외)
  db.query(
    `
    UPDATE users 
    SET status = 'revoked', api_key_hash = $random_hash 
    WHERE arca_id = $arca_id AND status = 'active'
  `,
  ).run({
    $arca_id: arcaId,
    $random_hash: "revoked-" + Date.now(),
  });
}

// 9. 화이트리스트 & 밴 명단 조회 및 관리
export function isWhitelisted(arcaId: string): boolean {
  const db = getDB();
  const row = db
    .query(`SELECT arca_id FROM whitelist WHERE arca_id = $arca_id`)
    .get({ $arca_id: arcaId });
  return !!row;
}

export function addWhitelist(arcaId: string, displayName: string) {
  const db = getDB();
  db.query(
    `
    INSERT INTO whitelist (arca_id, display_name, created_at)
    VALUES ($arca_id, $display_name, $now)
    ON CONFLICT(arca_id) DO UPDATE SET display_name = excluded.display_name
    `,
  ).run({
    $arca_id: arcaId,
    $display_name: displayName,
    $now: Date.now(),
  });
}

export function removeWhitelist(arcaId: string) {
  const db = getDB();
  db.query(`DELETE FROM whitelist WHERE arca_id = $arca_id`).run({
    $arca_id: arcaId,
  });
}

export function getWhitelistUsers() {
  const db = getDB();
  return db
    .query(
      `SELECT arca_id, display_name, created_at FROM whitelist ORDER BY created_at DESC`,
    )
    .all() as { arca_id: string; display_name: string; created_at: number }[];
}

export function getSuspendedUsers() {
  const db = getDB();
  return db
    .query(
      `
      SELECT arca_id, display_name, credit_balance, created_at 
      FROM users 
      WHERE status = 'suspended' 
      ORDER BY created_at DESC
    `,
    )
    .all() as {
    arca_id: string;
    display_name: string;
    credit_balance: number;
    created_at: number;
  }[];
}
