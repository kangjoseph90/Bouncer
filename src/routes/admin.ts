import { Hono } from "hono";
import * as crypto from "crypto";
import {
  getSetting,
  setSetting,
  adminSearchUser,
  adminSuspendUser,
  adminUnsuspendUser,
  adminRevokeKey,
  getWhitelistUsers,
  getSuspendedUsers,
  addWhitelist,
  removeWhitelist,
  adminAddCredit,
  adminResetGlobalQuota,
  getGlobalQuotaStatus,
} from "../db/queries";
import { config, loadModels, reloadEnvConfig } from "../utils/config";
import { clearStatsCache } from "./stats";
import { parseArcaIdFromHref } from "../services/crawler";

export const adminRoutes = new Hono<{ Variables: { isAdmin: boolean } }>();

// 관리자 권한 확인 미들웨어
adminRoutes.use("/*", async (c, next) => {
  const authHeader = c.req.header("Authorization") || "";
  const tokenMatched = authHeader.match(/^Admin\s+(.+)$/);

  // config.ADMIN_PASSWORD_HASH가 설정되어 있지 않으면 관리자 기능 전면 비활성화 (보안)
  if (!config.ADMIN_PASSWORD_HASH) {
    return c.json(
      {
        success: false,
        error:
          "서버 환경변수에 ADMIN_PASSWORD가 설정되지 않아 관리자 기능을 사용할 수 없습니다.",
      },
      403,
    );
  }

  // 입력받은 비밀번호를 해시해서 저장된 해시와 비교
  const inputHash = crypto.createHash("sha256").update(tokenMatched?.[1] || "").digest("hex");
  if (!tokenMatched || inputHash !== config.ADMIN_PASSWORD_HASH) {
    return c.json(
      { success: false, error: "관리자 비밀번호가 일치하지 않습니다." },
      401,
    );
  }

  c.set("isAdmin", true);
  await next();
});

// 1. 설정: 현재 상태 조회
adminRoutes.get("/settings", (c) => {
  return c.json({
    success: true,
    data: {
      arcaPostUrl: getSetting("ARCA_POST_URL"),
    },
  });
});

// 2. 설정: 게시글 URL 갱신
adminRoutes.post("/settings/arca-post-url", async (c) => {
  try {
    const { url } = await c.req.json<{ url: string }>();
    if (typeof url !== "string") {
      return c.json(
        { success: false, error: "올바른 url 값이 제공되지 않았습니다." },
        400,
      );
    }
    setSetting("ARCA_POST_URL", url);
    return c.json({
      success: true,
      message: "게시글 URL이 성공적으로 업데이트되었습니다.",
    });
  } catch (e) {
    return c.json(
      {
        success: false,
        error: "잘못된 요청 형식이거나 데이터 베이스 오류입니다.",
      },
      400,
    );
  }
});

// 3. 모델: 즉각 리로드
adminRoutes.post("/models/reload", (c) => {
  try {
    loadModels();
    return c.json({
      success: true,
      message: "models.json 설정을 성공적으로 다시 불러왔습니다.",
    });
  } catch (e) {
    return c.json({ success: false, error: "models.json 불러오기 실패" }, 500);
  }
});

// 3.5. 환경변수 .env: 즉각 리로드
adminRoutes.post("/env/reload", (c) => {
  try {
    reloadEnvConfig();
    clearStatsCache();
    return c.json({
      success: true,
      message: ".env 설정을 런타임에 성공적으로 최신화했습니다.",
    });
  } catch (e) {
    return c.json({ success: false, error: ".env 리로드 실패" }, 500);
  }
});

// 4. 유저 관리: 닉네임 또는 ARCA ID로 검색
adminRoutes.get("/users/search", (c) => {
  const query = c.req.query("q");
  if (!query) {
    return c.json({ success: false, error: "검색어(q)를 입력해주세요." }, 400);
  }

  const results = adminSearchUser(query);
  return c.json({ success: true, data: results });
});

// 5. 유저 관리: 영구 정지(Suspend) 및 키 파기
adminRoutes.post("/users/:arcaId/suspend", (c) => {
  const arcaId = c.req.param("arcaId");
  if (!arcaId) {
    return c.json(
      { success: false, error: "대상이 지정되지 않았습니다." },
      400,
    );
  }

  try {
    adminSuspendUser(arcaId);
    return c.json({
      success: true,
      message: `${arcaId} 유저가 영구 정지 처리되었으며, 기존 발급된 API 키는 모두 즉시 무력화되었습니다.`,
    });
  } catch (e) {
    return c.json(
      { success: false, error: "유저 차단 처리 중 에러가 발생했습니다." },
      500,
    );
  }
});

// 6. 유저 관리: 정지 해제(Unsuspend)
adminRoutes.post("/users/:arcaId/unsuspend", (c) => {
  const arcaId = c.req.param("arcaId");
  if (!arcaId) {
    return c.json(
      { success: false, error: "대상이 지정되지 않았습니다." },
      400,
    );
  }

  try {
    adminUnsuspendUser(arcaId);
    return c.json({
      success: true,
      message: `${arcaId} 유저의 정지가 해제되었습니다. 이제 유저가 직접 키를 다시 발급받을 수 있습니다.`,
    });
  } catch (e) {
    return c.json(
      { success: false, error: "정지 해제 처리 중 에러가 발생했습니다." },
      500,
    );
  }
});

// 7. 유저 관리: API 키만 파기(Revoke)
adminRoutes.post("/users/:arcaId/revoke", (c) => {
  const arcaId = c.req.param("arcaId");
  if (!arcaId) {
    return c.json(
      { success: false, error: "대상이 지정되지 않았습니다." },
      400,
    );
  }

  try {
    adminRevokeKey(arcaId);
    return c.json({
      success: true,
      message: `${arcaId} 유저의 현재 API 키가 파기되었습니다. 사용자는 다시 키를 발급받을 수 있습니다.`,
    });
  } catch (e) {
    return c.json(
      { success: false, error: "키 파기 처리 중 에러가 발생했습니다." },
      500,
    );
  }
});

// 8. 명단 관리: 화이트리스트 및 밴 명단 조회
adminRoutes.get("/users/lists", (c) => {
  try {
    const whitelist = getWhitelistUsers();
    const suspended = getSuspendedUsers();
    return c.json({ success: true, data: { whitelist, suspended } });
  } catch (e) {
    return c.json({ success: false, error: "명단 조회 중 에러가 발생했습니다." }, 500);
  }
});

// 9. 명단 관리: 화이트리스트 추가
adminRoutes.post("/whitelist", async (c) => {
  try {
    const { url } = await c.req.json<{ url: string }>();
    if (!url) {
      return c.json({ success: false, error: "URL이 제공되지 않았습니다." }, 400);
    }
    
    // 프로필 URL에서 arcaId 추출 (예: https://arca.live/u/@nickname/12345)
    // URL만 입력하기도 하고, 직접 arcaId 형식을 입력하기도 하므로 분기 처리
    let targetArcaId = url.trim();
    let displayName = targetArcaId;
    
    if (url.includes("arca.live/u/@")) {
      const parsed = parseArcaIdFromHref(url);
      if (!parsed) {
        return c.json({ success: false, error: "올바른 아카라이브 프로필 URL이 아닙니다." }, 400);
      }
      targetArcaId = parsed.arcaId;
      displayName = parsed.displayName || targetArcaId;
    } else {
      // URL이 아니고 arcaId나 닉네임인 경우의 예외 처리 (원하는 대로)
      // 예: fixed_닉네임, half_12345
      if (!targetArcaId.startsWith("fixed_") && !targetArcaId.startsWith("half_")) {
        // 그냥 닉네임만 쓴 경우 기본적으로 fixed_ 취급
        targetArcaId = "fixed_" + targetArcaId;
      }
    }

    addWhitelist(targetArcaId, displayName);
    return c.json({ success: true, message: `${displayName} 님이 화이트리스트에 추가되었습니다.` });
  } catch (e) {
    return c.json({ success: false, error: "화이트리스트 추가 중 에러가 발생했습니다." }, 500);
  }
});

// 10. 명단 관리: 화이트리스트에서 삭제
adminRoutes.delete("/whitelist/:arcaId", (c) => {
  const arcaId = c.req.param("arcaId");
  if (!arcaId) {
    return c.json({ success: false, error: "대상이 지정되지 않았습니다." }, 400);
  }

  try {
    removeWhitelist(arcaId);
    return c.json({ success: true, message: "화이트리스트에서 제외되었습니다." });
  } catch (e) {
    return c.json({ success: false, error: "화이트리스트 삭제 중 에러가 발생했습니다." }, 500);
  }
});

// 11. 유저 크레딧 충전/차감
adminRoutes.post("/users/:arcaId/credit", async (c) => {
  const arcaId = c.req.param("arcaId");
  if (!arcaId) {
    return c.json({ success: false, error: "대상이 지정되지 않았습니다." }, 400);
  }

  try {
    const { amount } = await c.req.json<{ amount: number }>();
    if (typeof amount !== "number" || isNaN(amount)) {
      return c.json({ success: false, error: "올바른 amount 값이 필요합니다." }, 400);
    }

    const result = adminAddCredit(arcaId, amount);
    if (!result) {
      return c.json({ success: false, error: "해당 유저를 찾을 수 없습니다." }, 404);
    }

    const action = amount >= 0 ? "충전" : "차감";
    return c.json({
      success: true,
      message: `${arcaId} 유저에게 ${Math.abs(amount)} 크레딧이 ${action}되었습니다.`,
      newBalance: result.newBalance,
    });
  } catch (e) {
    return c.json({ success: false, error: "크레딧 조정 중 에러가 발생했습니다." }, 500);
  }
});

// 12. 서버 전역 사용량 리셋
adminRoutes.post("/quota/reset", (c) => {
  try {
    adminResetGlobalQuota();
    return c.json({
      success: true,
      message: "서버 전역 사용량이 0으로 리셋되었습니다.",
    });
  } catch (e) {
    return c.json({ success: false, error: "사용량 리셋 중 에러가 발생했습니다." }, 500);
  }
});

// 13. 서버 전역 사용량 조회
adminRoutes.get("/quota", (c) => {
  try {
    const status = getGlobalQuotaStatus();
    if (!status) {
      return c.json({ success: false, error: "사용량 정보를 찾을 수 없습니다." }, 404);
    }
    return c.json({
      success: true,
      data: {
        totalUsed: status.total_used,
        lastRefilledAt: status.last_refilled_at,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: "사용량 조회 중 에러가 발생했습니다." }, 500);
  }
});
