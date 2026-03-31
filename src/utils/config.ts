import * as fs from 'fs';
import * as path from 'path';

export const config = {
  // Server
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Crawler (활성 유저 조건)
  ARCA_POST_URL: process.env.ARCA_POST_URL || '',
  ALLOW_HALF_NICK: process.env.ALLOW_HALF_NICK !== 'false',  // 기본: true (반고닉 허용)
  MIN_ACTIVE_DAYS: process.env.MIN_ACTIVE_DAYS ? parseInt(process.env.MIN_ACTIVE_DAYS, 10) : Infinity,
  MAX_INACTIVE_DAYS: process.env.MAX_INACTIVE_DAYS ? parseInt(process.env.MAX_INACTIVE_DAYS, 10) : Infinity,
  TARGET_CHANNELS: (process.env.TARGET_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean),
  MIN_CHANNEL_POSTS: process.env.MIN_CHANNEL_POSTS ? parseInt(process.env.MIN_CHANNEL_POSTS, 10) : Infinity,
  
  // APIs (Hardcoded removed)
  
  // Global Rates (Fallback to Infinity if not set)
  MAX_USERS: process.env.MAX_USERS ? parseInt(process.env.MAX_USERS, 10) : Infinity,
  MAX_ACTIVE_USERS: process.env.MAX_ACTIVE_USERS ? parseInt(process.env.MAX_ACTIVE_USERS, 10) : Infinity,
  MAX_TOTAL_CONCURRENCY: process.env.MAX_TOTAL_CONCURRENCY ? parseInt(process.env.MAX_TOTAL_CONCURRENCY, 10) : Infinity,
  MAX_TOTAL_RPM: process.env.MAX_TOTAL_RPM ? parseInt(process.env.MAX_TOTAL_RPM, 10) : Infinity,
  MAX_TOTAL_RPD: process.env.MAX_TOTAL_RPD ? parseInt(process.env.MAX_TOTAL_RPD, 10) : Infinity,

  // Per-User Rates
  MAX_USER_CONCURRENCY: process.env.MAX_USER_CONCURRENCY ? parseInt(process.env.MAX_USER_CONCURRENCY, 10) : Infinity,
  MAX_USER_RPM: process.env.MAX_USER_RPM ? parseInt(process.env.MAX_USER_RPM, 10) : Infinity,
  MAX_USER_RPD: process.env.MAX_USER_RPD ? parseInt(process.env.MAX_USER_RPD, 10) : Infinity,
  
  // Quota Refill Mode
  QUOTA_REFILL_MODE: (process.env.QUOTA_REFILL_MODE || 'none') as 'none' | 'daily' | 'monthly',
  SERVER_QUOTA_REFILL_MODE: (process.env.SERVER_QUOTA_REFILL_MODE || 'none') as 'none' | 'daily' | 'monthly',
  USER_QUOTA: parseInt(process.env.USER_QUOTA || '0', 10),
  GLOBAL_QUOTA: process.env.GLOBAL_QUOTA ? parseInt(process.env.GLOBAL_QUOTA, 10) : Infinity,

  // Load Balancing
  LOAD_BALANCING_STRATEGY: (process.env.LOAD_BALANCING_STRATEGY || 'random') as 'random' | 'round-robin',
};

// ==========================================
// Model Registry Loading
// ==========================================

export interface ModelConfig {
  id: string;               // 프론트엔드(클라이언트)가 요청하는 모델 Alias 명
  displayName: string;      // 메뉴에 표시되는 표시용 이름
  targetModel: string;      // 실제 업스트림(OpenAI 등)으로 넘길 진짜 모델 ID (치환용)
  targetUrl: string;
  targetKeyEnv: string;
  billingType: 'token' | 'request';
  cost: { prompt?: number; completion?: number; request?: number };
  limits: { concurrency: number };
  handler: string;
}

export const modelsRegistry = new Map<string, ModelConfig[]>();
const roundRobinCounters = new Map<string, number>();

export function loadModels() {
  try {
    const rawData = fs.readFileSync(path.join(process.cwd(), 'models.json'), 'utf-8');
    const parsed = JSON.parse(rawData);
    
    modelsRegistry.clear();
    roundRobinCounters.clear();

    for (const model of parsed.models) {
      if (!modelsRegistry.has(model.id)) {
        modelsRegistry.set(model.id, []);
      }
      modelsRegistry.get(model.id)!.push(model);
    }
    console.log(`Loaded ${parsed.models.length} models grouped into ${modelsRegistry.size} aliases from models.json`);
  } catch (error: any) {
    console.error('모델 로스터(models.json) 구조나 파싱 중 치명적 오류:', error.message);
  }
}

export function resolveModelConfig(modelId: string): ModelConfig | undefined {
  const pool = modelsRegistry.get(modelId);
  if (!pool || pool.length === 0) return undefined;
  
  if (pool.length === 1) return pool[0];

  if (config.LOAD_BALANCING_STRATEGY === 'round-robin') {
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
  return process.env[keyName] || '';
}
