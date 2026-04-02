import { Hono } from "hono";
import {
  getSetting,
  setSetting,
  adminSearchUser,
  adminSuspendUser,
  adminUnsuspendUser,
} from "../db/queries";
import { config, loadModels, reloadEnvConfig } from "../utils/config";

export const adminRoutes = new Hono<{ Variables: { isAdmin: boolean } }>();

// 관리자 권한 확인 미들웨어
adminRoutes.use("/*", async (c, next) => {
  const authHeader = c.req.header("Authorization") || "";
  const tokenMatched = authHeader.match(/^Admin\s+(.+)$/);

  // config.ADMIN_PASSWORD가 설정되어 있지 않으면 관리자 기능 전면 비활성화 (보안)
  if (!config.ADMIN_PASSWORD) {
    return c.json(
      {
        success: false,
        error:
          "서버 환경변수에 ADMIN_PASSWORD가 설정되지 않아 관리자 기능을 사용할 수 없습니다.",
      },
      403,
    );
  }

  if (!tokenMatched || tokenMatched[1] !== config.ADMIN_PASSWORD) {
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
