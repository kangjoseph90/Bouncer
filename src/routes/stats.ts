import { Hono } from "hono";
import * as crypto from "crypto";
import {
  getServerDailyUsage,
  getServerUsageByModel,
  getGlobalQuotaStatus,
  getUserDailyUsage,
  getUserUsageByModel,
  getUserRecentLogs,
  getTopUsersByCost,
  getUserDetailStats,
  getServerStats,
  getResolutionConfig,
} from "../db/queries";
import { getUserByApiKey } from "../db/queries";
import { config, modelsRegistry, getTotalConcurrency } from "../utils/config";

export const statsRoutes = new Hono();

// ─── 공개 엔드포인트 ───────────────────────────────────────────────

// 모델 카탈로그 & 가격표
statsRoutes.get("/models", (c) => {
  const models = Array.from(modelsRegistry.values()).map((pool) => {
    const m = pool[0];
    const hasKey = !!process.env[m.targetKeyEnv];
    return {
      id: m.id,
      displayName: m.displayName,
      billingType: m.billingType,
      cost: m.cost,
      concurrency: getTotalConcurrency(m.id),
      active: hasKey,
    };
  });
  return c.json({ success: true, data: models });
});

const CACHE_TTL_MS = 60 * 1000; // 1분

interface CacheEntry {
  data: any;
  lastUpdatedAt: number;
}

let serverStatsCache: CacheEntry | null = null;
const serverUsageCache = new Map<string, CacheEntry>();
let topUsersCache: CacheEntry | null = null;

// 유저별 통계 캐시
const userUsageCache = new Map<string, CacheEntry>();
const adminUserDetailCache = new Map<string, CacheEntry>();

// 주기적 캐시 정리 (10분마다 실행)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of userUsageCache.entries()) {
    if (now - entry.lastUpdatedAt > CACHE_TTL_MS) userUsageCache.delete(key);
  }
  for (const [key, entry] of adminUserDetailCache.entries()) {
    if (now - entry.lastUpdatedAt > CACHE_TTL_MS) adminUserDetailCache.delete(key);
  }
}, 10 * 60 * 1000);
/* [CACHE_CLEARER_ADDED] */
export function clearStatsCache() {
  serverStatsCache = null;
  serverUsageCache.clear();
  topUsersCache = null;
  userUsageCache.clear();
  adminUserDetailCache.clear();
  console.log("Runtime configuration reload triggered: Stats caches cleared.");
}

// 서버 전체 현황 (유저 수, 쿼터, Rate Limit 설정)
statsRoutes.get("/server", (c) => {
  const now = Date.now();
  if (serverStatsCache && now - serverStatsCache.lastUpdatedAt < CACHE_TTL_MS) {
    return c.json({ success: true, data: serverStatsCache.data, lastUpdatedAt: serverStatsCache.lastUpdatedAt });
  }

  const stats = getServerStats();
  const quota = getGlobalQuotaStatus();

  const data = {
      users: {
        total: stats.totalUsers,
        active24h: stats.activeUsers,
      },
      globalQuota: {
        used: quota?.total_used ?? 0,
        limit: config.GLOBAL_QUOTA === Infinity ? null : config.GLOBAL_QUOTA,
        refillMode: config.GLOBAL_QUOTA_REFILL_MODE,
        lastRefilledAt: quota?.last_refilled_at ?? null,
      },
      limits: {
        global: {
          maxUsers: config.GLOBAL_MAX_USERS === Infinity ? null : config.GLOBAL_MAX_USERS,
          maxActiveUsers: config.GLOBAL_MAX_ACTIVE_USERS === Infinity ? null : config.GLOBAL_MAX_ACTIVE_USERS,
          maxConcurrency: config.GLOBAL_MAX_CONCURRENCY === Infinity ? null : config.GLOBAL_MAX_CONCURRENCY,
          maxRpm: config.GLOBAL_MAX_RPM === Infinity ? null : config.GLOBAL_MAX_RPM,
          maxRph: config.GLOBAL_MAX_RPH === Infinity ? null : config.GLOBAL_MAX_RPH,
          maxRpd: config.GLOBAL_MAX_RPD === Infinity ? null : config.GLOBAL_MAX_RPD,
        },
        perUser: {
          quota: config.USER_QUOTA,
          quotaRefillMode: config.USER_QUOTA_REFILL_MODE,
          maxConcurrency: config.USER_MAX_CONCURRENCY === Infinity ? null : config.USER_MAX_CONCURRENCY,
          maxRpm: config.USER_MAX_RPM === Infinity ? null : config.USER_MAX_RPM,
          maxRph: config.USER_MAX_RPH === Infinity ? null : config.USER_MAX_RPH,
          maxRpd: config.USER_MAX_RPD === Infinity ? null : config.USER_MAX_RPD,
      },
    },
  };

  serverStatsCache = { data, lastUpdatedAt: now };
  return c.json({ success: true, data, lastUpdatedAt: now });
});

// 서버 전체 그래프 데이터
statsRoutes.get("/server/usage", (c) => {
  const res = c.req.query("res") || "1h";
  const now = Date.now();
  const cached = serverUsageCache.get(res);
  if (cached && now - cached.lastUpdatedAt < CACHE_TTL_MS) {
    return c.json({ success: true, data: cached.data, lastUpdatedAt: cached.lastUpdatedAt });
  }

  const daily = getServerDailyUsage(res);
  const { days } = getResolutionConfig(res);
  const byModel = getServerUsageByModel(days);

  const data = { daily, byModel };
  serverUsageCache.set(res, { data, lastUpdatedAt: now });

  return c.json({ success: true, data, lastUpdatedAt: now });
});

// ─── 유저 인증 엔드포인트 ─────────────────────────────────────────

// 개인 사용 통계 (최근 7일)
statsRoutes.get("/user/usage", (c) => {
  const authHeader = c.req.header("Authorization") || "";
  const apiKey = authHeader.replace("Bearer ", "").trim();

  if (!apiKey || !apiKey.startsWith("bnc-")) {
    return c.json({ success: false, error: "유효한 API 키가 필요합니다." }, 401);
  }

  const user = getUserByApiKey(apiKey);
  if (!user || user.status !== "active") {
    return c.json({ success: false, error: "유효하지 않거나 정지된 계정입니다." }, 401);
  }

  const res = c.req.query("res") || "1h";
  const now = Date.now();
  const cacheKey = `${user.arca_id}:${res}`;
  const cached = userUsageCache.get(cacheKey);
  if (cached && now - cached.lastUpdatedAt < CACHE_TTL_MS) {
    return c.json({ success: true, data: cached.data, lastUpdatedAt: cached.lastUpdatedAt });
  }

  const daily = getUserDailyUsage(user.arca_id, res);
  const { days } = getResolutionConfig(res);
  const byModel = getUserUsageByModel(user.arca_id, days);
  const recentLogs = getUserRecentLogs(user.arca_id, 20);

  // 전체 누적 합산 기반 (daily 응답 기준)
  const totalRequests = daily.reduce((s, d) => s + d.total_requests, 0);
  const totalCost = daily.reduce((s, d) => s + d.total_cost, 0);

  const data = { daily, byModel, recentLogs, totals: { totalRequests, totalCost } };
  userUsageCache.set(cacheKey, { data, lastUpdatedAt: now });

  return c.json({ success: true, data, lastUpdatedAt: now });
});

// ─── 어드민 통계 엔드포인트 ──────────────────────────────────────

export const adminStatsRoutes = new Hono();

// 관리자 인증 미들웨어
adminStatsRoutes.use("/*", async (c, next) => {
  const authHeader = c.req.header("Authorization") || "";
  const tokenMatched = authHeader.match(/^Admin\s+(.+)$/);

  const inputHash = crypto.createHash("sha256").update(tokenMatched?.[1] || "").digest("hex");
  if (!config.ADMIN_PASSWORD_HASH || !tokenMatched || inputHash !== config.ADMIN_PASSWORD_HASH) {
    return c.json({ success: false, error: "관리자 인증이 필요합니다." }, 401);
  }
  await next();
});

// TOP 사용자 (최근 7일)
adminStatsRoutes.get("/top-users", (c) => {
  const now = Date.now();
  if (topUsersCache && now - topUsersCache.lastUpdatedAt < CACHE_TTL_MS) {
    return c.json({ success: true, data: topUsersCache.data, lastUpdatedAt: topUsersCache.lastUpdatedAt });
  }

  const topUsers = getTopUsersByCost(7, 10);
  topUsersCache = { data: topUsers, lastUpdatedAt: now };

  return c.json({ success: true, data: topUsers, lastUpdatedAt: now });
});

// 특정 유저 상세 통계 (최근 7일)
adminStatsRoutes.get("/user/:arcaId", (c) => {
  const arcaId = c.req.param("arcaId");
  const res = c.req.query("res") || "1h";
  if (!arcaId) {
    return c.json({ success: false, error: "arcaId가 지정되지 않았습니다." }, 400);
  }

  const now = Date.now();
  const cacheKey = `${arcaId}:${res}`;
  const cached = adminUserDetailCache.get(cacheKey);
  if (cached && now - cached.lastUpdatedAt < CACHE_TTL_MS) {
    return c.json({ success: true, data: cached.data, lastUpdatedAt: cached.lastUpdatedAt });
  }

  const stats = getUserDetailStats(arcaId, res);
  adminUserDetailCache.set(cacheKey, { data: stats, lastUpdatedAt: now });

  return c.json({ success: true, data: stats, lastUpdatedAt: now });
});
