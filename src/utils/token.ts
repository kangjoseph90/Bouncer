import * as crypto from "crypto";
import { config } from "./config";

interface TokenData {
  token: string;
  createdAt: number;
  verifyCount: number;
}

// 서버 부팅 시 1회 생성 (메모리에만 저장, 재시작마다 변경)
const IP_SALT = crypto.randomBytes(16).toString("hex");

// IP를 단방향 해시 (복원 불가, 같은 IP인지만 확인 가능)
function hashIp(ip: string): string {
  return crypto.createHash("sha256")
    .update(ip + IP_SALT)
    .digest("hex");
}

// Hashed IP -> TokenData
const ipTokenStore = new Map<string, TokenData>();
// Token -> Hashed IP (for lookup by token)
const tokenToIpStore = new Map<string, string>();

export function generateVerificationToken(ip: string): {
  token: string;
  expiresIn: number;
} {
  const hashedIp = hashIp(ip);
  const EXPIRES_IN_MS = config.AUTH_TOKEN_TTL_MINS * 60 * 1000;
  const now = Date.now();

  const existingData = ipTokenStore.get(hashedIp);
  if (existingData) {
    const elapsed = now - existingData.createdAt;
    if (elapsed < EXPIRES_IN_MS) {
      return { token: existingData.token, expiresIn: EXPIRES_IN_MS - elapsed };
    } else {
      tokenToIpStore.delete(existingData.token);
      ipTokenStore.delete(hashedIp);
    }
  }

  // 알아보기 쉬운 랜덤 토큰 문자열 (예: BNC-AUTH-1AB2C3)
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  const token = `BNC-AUTH-${code}`;

  const newData: TokenData = { token, createdAt: now, verifyCount: 0 };
  ipTokenStore.set(hashedIp, newData);
  tokenToIpStore.set(token, hashedIp);

  return { token, expiresIn: EXPIRES_IN_MS };
}

export function isValidToken(token: string): boolean {
  const hashedIp = tokenToIpStore.get(token);
  if (!hashedIp) return false;

  const data = ipTokenStore.get(hashedIp);
  if (!data || data.token !== token) return false;

  const EXPIRES_IN_MS = config.AUTH_TOKEN_TTL_MINS * 60 * 1000;
  // 만료 체크
  if (Date.now() - data.createdAt > EXPIRES_IN_MS) {
    tokenToIpStore.delete(token);
    ipTokenStore.delete(hashedIp);
    return false;
  }

  return true;
}

export function checkTokenRateLimit(token: string): boolean {
  const hashedIp = tokenToIpStore.get(token);
  if (!hashedIp) return false;

  const data = ipTokenStore.get(hashedIp);
  if (!data || data.token !== token) return false;

  data.verifyCount += 1;
  if (data.verifyCount > config.AUTH_TOKEN_VERIFY_LIMIT) {
    return false;
  }
  return true;
}

export function consumeToken(token: string) {
  const hashedIp = tokenToIpStore.get(token);
  if (hashedIp) {
    ipTokenStore.delete(hashedIp);
    tokenToIpStore.delete(token);
  }
}

// 만료 토큰 자동 청소 스케줄러 (1분 주기)
setInterval(() => {
  const now = Date.now();
  const EXPIRES_IN_MS = config.AUTH_TOKEN_TTL_MINS * 60 * 1000;
  for (const [hashedIp, data] of ipTokenStore.entries()) {
    if (now - data.createdAt > EXPIRES_IN_MS) {
      tokenToIpStore.delete(data.token);
      ipTokenStore.delete(hashedIp);
    }
  }
}, 60 * 1000);
