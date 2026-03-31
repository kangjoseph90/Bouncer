import * as fs from "fs";
import * as path from "path";

export const config = {
  // Server
  PORT: parseInt(process.env.PORT || "3000", 10),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "",

  // Crawler (활성 유저 조건)
  ALLOW_HALF_NICK: process.env.ALLOW_HALF_NICK !== "false", // 기본: true (반고닉 허용)
  MIN_ACTIVE_DAYS: process.env.MIN_ACTIVE_DAYS
    ? parseInt(process.env.MIN_ACTIVE_DAYS, 10)
    : Infinity,
  MAX_INACTIVE_DAYS: process.env.MAX_INACTIVE_DAYS
    ? parseInt(process.env.MAX_INACTIVE_DAYS, 10)
    : Infinity,
  TARGET_CHANNELS: (process.env.TARGET_CHANNELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  MIN_CHANNEL_POSTS: process.env.MIN_CHANNEL_POSTS
    ? parseInt(process.env.MIN_CHANNEL_POSTS, 10)
    : Infinity,

  // APIs (Hardcoded removed)

  // Global Limits (서버 전체)
  GLOBAL_MAX_USERS: process.env.GLOBAL_MAX_USERS
    ? parseInt(process.env.GLOBAL_MAX_USERS, 10)
    : Infinity,
  GLOBAL_MAX_ACTIVE_USERS: process.env.GLOBAL_MAX_ACTIVE_USERS
    ? parseInt(process.env.GLOBAL_MAX_ACTIVE_USERS, 10)
    : Infinity,
  GLOBAL_MAX_CONCURRENCY: process.env.GLOBAL_MAX_CONCURRENCY
    ? parseInt(process.env.GLOBAL_MAX_CONCURRENCY, 10)
    : Infinity,
  GLOBAL_MAX_RPM: process.env.GLOBAL_MAX_RPM
    ? parseInt(process.env.GLOBAL_MAX_RPM, 10)
    : Infinity,
  GLOBAL_MAX_RPD: process.env.GLOBAL_MAX_RPD
    ? parseInt(process.env.GLOBAL_MAX_RPD, 10)
    : Infinity,
  GLOBAL_QUOTA: process.env.GLOBAL_QUOTA
    ? parseInt(process.env.GLOBAL_QUOTA, 10)
    : Infinity,
  GLOBAL_QUOTA_REFILL_MODE: (process.env.GLOBAL_QUOTA_REFILL_MODE || "none") as
    | "none"
    | "daily"
    | "monthly",

  // Per-User Limits
  USER_MAX_CONCURRENCY: process.env.USER_MAX_CONCURRENCY
    ? parseInt(process.env.USER_MAX_CONCURRENCY, 10)
    : Infinity,
  USER_MAX_RPM: process.env.USER_MAX_RPM
    ? parseInt(process.env.USER_MAX_RPM, 10)
    : Infinity,
  USER_MAX_RPD: process.env.USER_MAX_RPD
    ? parseInt(process.env.USER_MAX_RPD, 10)
    : Infinity,
  USER_QUOTA: parseInt(process.env.USER_QUOTA || "0", 10),
  USER_QUOTA_REFILL_MODE: (process.env.USER_QUOTA_REFILL_MODE || "none") as
    | "none"
    | "daily"
    | "monthly",

  // Load Balancing
  LOAD_BALANCING_STRATEGY: (process.env.LOAD_BALANCING_STRATEGY || "random") as
    | "random"
    | "round-robin",

  // Auth
  AUTH_TOKEN_TTL_MINS: parseInt(process.env.AUTH_TOKEN_TTL_MINS || "5", 10),
  AUTH_TOKEN_VERIFY_LIMIT: parseInt(
    process.env.AUTH_TOKEN_VERIFY_LIMIT || "5",
    10,
  ),
};

// ==========================================
// Model Registry Loading
// ==========================================

export interface ModelConfig {
  id: string; // 프론트엔드(클라이언트)가 요청하는 모델 Alias 명
  displayName: string; // 메뉴에 표시되는 표시용 이름
  targetModel: string; // 실제 업스트림(OpenAI 등)으로 넘길 진짜 모델 ID (치환용)
  targetUrl: string;
  targetKeyEnv: string;
  billingType: "token" | "request";
  cost: {
    prompt?: number;
    completion?: number;
    cached?: number;
    request?: number;
  };
  limits: { concurrency: number };
  handler: string;
}

export const modelsRegistry = new Map<string, ModelConfig[]>();
const roundRobinCounters = new Map<string, number>();

export function loadModels() {
  try {
    const rawData = fs.readFileSync(
      path.join(process.cwd(), "models.json"),
      "utf-8",
    );
    const parsed = JSON.parse(rawData);

    modelsRegistry.clear();
    roundRobinCounters.clear();

    for (const model of parsed.models) {
      if (!modelsRegistry.has(model.id)) {
        modelsRegistry.set(model.id, []);
      }
      modelsRegistry.get(model.id)!.push(model);
    }
    console.log(
      `Loaded ${parsed.models.length} models grouped into ${modelsRegistry.size} aliases from models.json`,
    );
  } catch (error: any) {
    console.error(
      "모델 로스터(models.json) 구조나 파싱 중 치명적 오류:",
      error.message,
    );
  }
}

export function resolveModelConfig(modelId: string): ModelConfig | undefined {
  const pool = modelsRegistry.get(modelId);
  if (!pool || pool.length === 0) return undefined;

  if (pool.length === 1) return pool[0];

  if (config.LOAD_BALANCING_STRATEGY === "round-robin") {
    const currentIndex = roundRobinCounters.get(modelId) || 0;
    const selected = pool[currentIndex];
    roundRobinCounters.set(modelId, (currentIndex + 1) % pool.length);
    return selected;
  } else {
    // 기본 전략: 랜덤
    const randomIndex = Math.floor(Math.random() * pool.length);
    return pool[randomIndex];
  }
}

// Initial load
loadModels();

// 환경변수 추출 편의 함수 (targetKeyEnv의 값을 런타임에 리턴)
export function getEnv(keyName: string): string {
  return process.env[keyName] || "";
}
