import { resolveModelConfig, config } from '../utils/config';

interface RateLimitStore {
  timestamps: number[];
  dailyTimestamps: number[];
  activeRequests: number;
  modelRequests: Map<string, number>; // 모델별 동시성 추적
}

const globalState: RateLimitStore = {
  timestamps: [],
  dailyTimestamps: [],
  activeRequests: 0,
  modelRequests: new Map<string, number>()
};

const userState = new Map<string, RateLimitStore>();

export function checkRateLimits(arcaId: string, modelId: string): { allowed: boolean; error?: string } {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  // Cleanup globals
  globalState.timestamps = globalState.timestamps.filter((t) => t > oneMinuteAgo);
  globalState.dailyTimestamps = globalState.dailyTimestamps.filter((t) => t > oneDayAgo);

  // 모델 제원 확인
  const modelConfig = resolveModelConfig(modelId);
  if (!modelConfig) return { allowed: false, error: '존재하지 않거나 비활성화된 모델입니다.' };

  // Global Check
  if (globalState.activeRequests >= config.GLOBAL_MAX_CONCURRENCY) return { allowed: false, error: '서버 전체 동시 요청 한도 초과' };
  if (globalState.timestamps.length >= config.GLOBAL_MAX_RPM) return { allowed: false, error: '서버 분당 요청 한도 초과' };
  if (globalState.dailyTimestamps.length >= config.GLOBAL_MAX_RPD) return { allowed: false, error: '서버 일일 요청 한도 초과' };
  
  // Model Global Check (모델별 할당된 Concurrency)
  const currentModelRequests = globalState.modelRequests.get(modelId) || 0;
  if (currentModelRequests >= modelConfig.limits.concurrency) {
    return { allowed: false, error: `'${modelId}' 모델의 전역 할당 슬롯(Concurrency)이 모두 찼습니다. 잠시 후 재시도하세요.` };
  }

  // User Init
  if (!userState.has(arcaId)) {
    userState.set(arcaId, { timestamps: [], dailyTimestamps: [], activeRequests: 0, modelRequests: new Map() });
  }
  const uState = userState.get(arcaId)!;
  uState.timestamps = uState.timestamps.filter((t) => t > oneMinuteAgo);
  uState.dailyTimestamps = uState.dailyTimestamps.filter((t) => t > oneDayAgo);

  // User Check
  if (uState.activeRequests >= config.USER_MAX_CONCURRENCY) return { allowed: false, error: '유저 동시 요청 한도 초과' };
  if (uState.timestamps.length >= config.USER_MAX_RPM) return { allowed: false, error: '유저 분당 요청 한도 초과' };
  if (uState.dailyTimestamps.length >= config.USER_MAX_RPD) return { allowed: false, error: '유저 일일 요청 한도 초과' };

  return { allowed: true };
}

export function recordRequestStart(arcaId: string, modelId: string) {
  const now = Date.now();
  globalState.activeRequests++;
  globalState.timestamps.push(now);
  globalState.dailyTimestamps.push(now);
  globalState.modelRequests.set(modelId, (globalState.modelRequests.get(modelId) || 0) + 1);

  const uState = userState.get(arcaId);
  if (uState) {
    uState.activeRequests++;
    uState.timestamps.push(now);
    uState.dailyTimestamps.push(now);
  }
}

export function recordRequestEnd(arcaId: string, modelId: string) {
  if (globalState.activeRequests > 0) globalState.activeRequests--;
  
  const currentM = globalState.modelRequests.get(modelId) || 0;
  if (currentM > 0) globalState.modelRequests.set(modelId, currentM - 1);

  const uState = userState.get(arcaId);
  if (uState && uState.activeRequests > 0) {
    uState.activeRequests--;
  }
}
