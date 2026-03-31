import * as crypto from "crypto";
import { config } from "./config";

interface TokenData {
  token: string;
  createdAt: number;
  ip: string;
  verifyCount: number;
}

// IP -> TokenData
const ipTokenStore = new Map<string, TokenData>();
// Token -> IP (for lookup by token)
const tokenToIpStore = new Map<string, string>();

export function generateVerificationToken(ip: string): {
  token: string;
  expiresIn: number;
} {
  const EXPIRES_IN_MS = config.AUTH_TOKEN_TTL_MINS * 60 * 1000;
  const now = Date.now();

  const existingData = ipTokenStore.get(ip);
  if (existingData) {
    const elapsed = now - existingData.createdAt;
    if (elapsed < EXPIRES_IN_MS) {
      return { token: existingData.token, expiresIn: EXPIRES_IN_MS - elapsed };
    } else {
      tokenToIpStore.delete(existingData.token);
      ipTokenStore.delete(ip);
    }
  }

  // 알아보기 쉬운 랜덤 토큰 문자열 (예: BNC-AUTH-1AB2C3)
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  const token = `BNC-AUTH-${code}`;

  const newData: TokenData = { token, createdAt: now, ip, verifyCount: 0 };
  ipTokenStore.set(ip, newData);
  tokenToIpStore.set(token, ip);

  return { token, expiresIn: EXPIRES_IN_MS };
}

export function isValidToken(token: string): boolean {
  const ip = tokenToIpStore.get(token);
  if (!ip) return false;

  const data = ipTokenStore.get(ip);
  if (!data || data.token !== token) return false;

  const EXPIRES_IN_MS = config.AUTH_TOKEN_TTL_MINS * 60 * 1000;
  // 만료 체크
  if (Date.now() - data.createdAt > EXPIRES_IN_MS) {
    tokenToIpStore.delete(token);
    ipTokenStore.delete(ip);
    return false;
  }

  return true;
}

export function checkTokenRateLimit(token: string): boolean {
  const ip = tokenToIpStore.get(token);
  if (!ip) return false;

  const data = ipTokenStore.get(ip);
  if (!data || data.token !== token) return false;

  data.verifyCount += 1;
  if (data.verifyCount > config.AUTH_TOKEN_VERIFY_LIMIT) {
    return false;
  }
  return true;
}

export function consumeToken(token: string) {
  const ip = tokenToIpStore.get(token);
  if (ip) {
    ipTokenStore.delete(ip);
    tokenToIpStore.delete(token);
  }
}

// 만료 토큰 자동 청소 스케줄러 (1분 주기)
setInterval(() => {
  const now = Date.now();
  const EXPIRES_IN_MS = config.AUTH_TOKEN_TTL_MINS * 60 * 1000;
  for (const [ip, data] of ipTokenStore.entries()) {
    if (now - data.createdAt > EXPIRES_IN_MS) {
      tokenToIpStore.delete(data.token);
      ipTokenStore.delete(ip);
    }
  }
}, 60 * 1000);
