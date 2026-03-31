import * as crypto from 'crypto';

interface TokenData {
  createdAt: number;
}

// 토큰 저장용 인메모리 스토어 (Redis 대체)
const tokenStore = new Map<string, TokenData>();

// 만료 시간: 10분 (600,000ms)
const EXPIRES_IN_MS = 10 * 60 * 1000;

export function generateVerificationToken(): { token: string; expiresIn: number } {
  // 알아보기 쉬운 랜덤 토큰 문자열 (예: bnc-auth-1ab2c3)
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const token = `BNC-AUTH-${code}`;
  
  tokenStore.set(token, { createdAt: Date.now() });
  
  return { token, expiresIn: EXPIRES_IN_MS };
}

export function isValidToken(token: string): boolean {
  const data = tokenStore.get(token);
  if (!data) return false;
  
  // 만료 체크
  if (Date.now() - data.createdAt > EXPIRES_IN_MS) {
    tokenStore.delete(token);
    return false;
  }
  
  return true;
}

export function consumeToken(token: string) {
  tokenStore.delete(token);
}

// 만료 토큰 자동 청소 스케줄러 (1분 주기)
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of tokenStore.entries()) {
    if (now - data.createdAt > EXPIRES_IN_MS) {
      tokenStore.delete(token);
    }
  }
}, 60 * 1000);
