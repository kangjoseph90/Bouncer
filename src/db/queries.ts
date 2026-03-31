import { getDB } from './schema';
import * as crypto from 'crypto';
import { config } from '../utils/config';

// 1. 보안 함수: API 키 생성 및 해싱
export function generateApiKey(): string {
  // 32바이트(256비트) 안전한 난수를 헥스 문자열로 변환 (총 64글자 + 접두사)
  return 'bnc-' + crypto.randomBytes(32).toString('hex');
}

export function hashApiKey(apiKey: string): string {
  // 저장용은 SHA-256 해시값만 저장
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function checkAndRefillServerQuota() {
  if (config.SERVER_QUOTA_REFILL_MODE === 'none') return;
  
  const db = getDB();
  const usage = db.query(`SELECT last_refilled_at FROM server_usage WHERE id = 1`).get() as { last_refilled_at: number } | undefined;
  if (!usage) return;

  const now = new Date();
  const last = new Date(usage.last_refilled_at);
  let shouldRefill = false;

  if (config.SERVER_QUOTA_REFILL_MODE === 'daily') {
    if (now.getDate() !== last.getDate() || now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear()) {
      shouldRefill = true;
    }
  } else if (config.SERVER_QUOTA_REFILL_MODE === 'monthly') {
    if (now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear()) {
      shouldRefill = true;
    }
  }

  if (shouldRefill) {
    db.query(`
      UPDATE server_usage 
      SET total_used = 0, last_refilled_at = $now
      WHERE id = 1
    `).run({
      $now: Date.now()
    });
  }
}

export function checkGlobalQuotaAllowed(cost: number = 0): boolean {
  if (config.GLOBAL_QUOTA === Infinity) return true;
  
  checkAndRefillServerQuota(); // 지연 갱신 체크
  
  const db = getDB();
  const usage = db.query(`SELECT total_used FROM server_usage WHERE id = 1`).get() as { total_used: number } | undefined;
  if (!usage) return true;
  return (usage.total_used + cost) <= config.GLOBAL_QUOTA;
}

export function incrementGlobalQuota(cost: number) {
  if (config.GLOBAL_QUOTA === Infinity) return;
  const db = getDB();
  db.query(`UPDATE server_usage SET total_used = total_used + $cost WHERE id = 1`).run({ $cost: cost });
}

// 2. DB 작업: 유저 생성 및 키 발급
export function createUser(arcaId: string, arcaType: string, displayName: string): { apiKey: string } {
  const apiKey = generateApiKey();
  const apiHash = hashApiKey(apiKey);
  const db = getDB();

  db.query(`
    INSERT INTO users (arca_id, arca_type, display_name, api_key_hash, credit_balance, created_at, last_refilled_at)
    VALUES ($arca_id, $arca_type, $display_name, $api_key_hash, $credit_balance, $created_at, $last_refilled_at)
  `).run({
    $arca_id: arcaId,
    $arca_type: arcaType,
    $display_name: displayName,
    $api_key_hash: apiHash,
    $credit_balance: config.USER_QUOTA,
    $created_at: Date.now(),
    $last_refilled_at: Date.now()
  });

  return { apiKey };
}

// 3. DB 작업: 기존 유저 키 재발급(Rotation) - 쿼터 유지
// 정지(suspended)된 유저가 아닌 경우에만 새 키를 발급하고, 혹시 파기(revoked) 상태였다면 다시 active로 복구
export function revokeAndReissue(arcaId: string, displayName: string): { apiKey: string } {
  const apiKey = generateApiKey();
  const apiHash = hashApiKey(apiKey);
  const db = getDB();

  db.query(`
    UPDATE users 
    SET api_key_hash = $api_key_hash, display_name = $display_name, status = 'active'
    WHERE arca_id = $arca_id AND status != 'suspended'
  `).run({
    $arca_id: arcaId,
    $display_name: displayName,
    $api_key_hash: apiHash
  });

  return { apiKey };
}

// 4. DB 작업: 유저가 스스로 키 영구 파기(Revoke)
export function revokeKey(arcaId: string) {
  const db = getDB();

  db.query(`
    UPDATE users 
    SET status = 'revoked'
    WHERE arca_id = $arca_id AND status = 'active'
  `).run({
    $arca_id: arcaId
  });
}

// 4. DB 작업: 지연 할당량 충전 및 유저 조회 (API 프록시 인증용)
export function getUserByApiKey(rawApiKey: string) {
  const hash = hashApiKey(rawApiKey);
  const db = getDB();
  
  const user = db.query(`
    SELECT id, arca_id, arca_type, display_name, credit_balance, status, last_refilled_at 
    FROM users 
    WHERE api_key_hash = $hash
  `).get({ $hash: hash }) as {
    id: number, arca_id: string, arca_type: string, display_name: string, credit_balance: number, status: string, last_refilled_at: number
  } | undefined;

  if (user && user.status === 'active') {
    checkAndRefillQuota(user.arca_id, user.last_refilled_at);
    // 갱신되었을 수도 있으므로 최신 크레딧 잔액을 위해 다시 조회
    return db.query(`
      SELECT arca_id, display_name, credit_balance, status 
      FROM users WHERE id = $id
    `).get({ $id: user.id }) as any;
  }

  return user;
}

function checkAndRefillQuota(arcaId: string, lastRefilledAt: number) {
  if (config.QUOTA_REFILL_MODE === 'none') return;
  
  const now = new Date();
  const last = new Date(lastRefilledAt);
  let shouldRefill = false;

  if (config.QUOTA_REFILL_MODE === 'daily') {
    if (now.getDate() !== last.getDate() || now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear()) {
      shouldRefill = true;
    }
  } else if (config.QUOTA_REFILL_MODE === 'monthly') {
    if (now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear()) {
      shouldRefill = true;
    }
  }

  if (shouldRefill) {
    getDB().query(`
      UPDATE users 
      SET credit_balance = $quota, last_refilled_at = $now
      WHERE arca_id = $arca_id
    `).run({
      $quota: config.USER_QUOTA,
      $now: Date.now(),
      $arca_id: arcaId
    });
  }
}

export function getUserByArcaId(arcaId: string) {
  const db = getDB();
  return db.query(`SELECT id, status FROM users WHERE arca_id = $arca_id`).get({ $arca_id: arcaId }) as { id: number, status: string } | undefined;
}

// 5. DB 작업: 크레딧 차감 및 로깅
export function chargeUsage(arcaId: string, modelName: string, promptTokens: number, completionTokens: number, totalCost: number) {
  const db = getDB();
  
  // 1. 유저 쿼터 차감
  db.query(`
    UPDATE users 
    SET credit_balance = credit_balance - $cost, last_used_at = $now
    WHERE arca_id = $arca_id
  `).run({
    $cost: totalCost,
    $now: Date.now(),
    $arca_id: arcaId
  });

  // 2. 로그 인서트 (지연 쓰기로 최적화 가능하지만 현재는 동시 처리)
  db.query(`
    INSERT INTO usage_logs (arca_id, model_name, tokens_prompt, tokens_completion, cost, created_at)
    VALUES ($arca_id, $model, $prompt, $completion, $cost, $now)
  `).run({
    $arca_id: arcaId,
    $model: modelName,
    $prompt: promptTokens,
    $completion: completionTokens,
    $cost: totalCost,
    $now: Date.now()
  });

  // 3. 서버 전역 쿼터 차감
  incrementGlobalQuota(totalCost);
}

// 6. DB 통계 (대시보드 / 메인 페이지 용)
export function getServerStats() {
  const db = getDB();
  const totalUsers = db.query(`SELECT COUNT(*) as count FROM users`).get() as { count: number };
  const last24Hours = Date.now() - (24 * 60 * 60 * 1000);
  const activeUsers = db.query(`SELECT COUNT(*) as count FROM users WHERE last_used_at > $time`).get({ $time: last24Hours }) as { count: number };
  
  return {
    totalUsers: totalUsers?.count || 0,
    activeUsers: activeUsers?.count || 0
  };
}
