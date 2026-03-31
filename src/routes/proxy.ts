import { Hono, Next, Context } from "hono";
import { getUserByApiKey, checkGlobalQuotaAllowed } from "../db/queries";
import { checkRateLimits, recordRequestStart, recordRequestEnd } from "../services/ratelimit";
import { modelsRegistry, resolveModelConfig } from "../utils/config";
import { getHandler } from "../handlers/index";

export const proxyRoutes = new Hono<{ Variables: { user: any } }>();

proxyRoutes.use("/v1/*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return await next();
  }

  const authHeader = c.req.header("Authorization") || "";
  const tokenMatched = authHeader.match(/^Bearer\s+(bnc-[A-Za-z0-9]+)$/);

  if (!tokenMatched) {
    return c.json(
      {
        error: {
          message: "Bouncer API 키가 누락되었거나 형식이 잘못되었습니다.",
          type: "invalid_request_error",
        },
      },
      401,
    );
  }

  const user = getUserByApiKey(tokenMatched[1]);
  if (!user || user.status !== "active") {
    return c.json(
      {
        error: {
          message: "만료/정지되었거나 유효하지 않은 Bouncer API 키입니다.",
          type: "invalid_api_key",
        },
      },
      401,
    );
  }

  c.set("user", user);
  await next();
});

// GET Models Endpoint -> models.json의 데이터 기반 (중복 제거된 1번 타자 대표명) 동적 렌더링
proxyRoutes.get("/v1/models", (c) => {
  const modelsList = Array.from(modelsRegistry.values()).map((pool) => pool[0]); // 배열의 첫 번째 값들만 추출

  return c.json({
    object: "list",
    data: modelsList.map((model) => ({
      id: model.id,
      name: model.displayName, // 커스텀 클라이언트(SillyTavern 등) 화면 표기용 확장 모델명
      object: "model",
      created: 1686935002,
      owned_by: "bouncer",
    })),
  });
});

proxyRoutes.post("/v1/chat/completions", async (c) => {
  const user = c.get("user") as { arca_id: string; credit_balance: number };

  // 1. 유저 쿼터 예외 처리
  if (user.credit_balance <= 0) {
    return c.json(
      {
        error: {
          message: "본인의 할당량(크레딧)을 모두 소진하셨습니다.",
          type: "insufficient_quota",
        },
      },
      429,
    );
  }

  // 2. 글로벌 쿼터 예외 처리
  if (!checkGlobalQuotaAllowed(0)) {
    return c.json(
      {
        error: {
          message:
            "서버 전체의 제공 할당량(GLOBAL QUOTA)이 모두 소진되어 일시적으로 이용할 수 없습니다.",
          type: "insufficient_quota",
        },
      },
      429,
    );
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: { message: "Invalid JSON body" } }, 400);
  }

  const modelId = body.model;
  if (!modelId) {
    return c.json(
      {
        error: {
          message: '요청 본문에 "model" 필드가 누락되었습니다.',
          type: "invalid_request_error",
        },
      },
      400,
    );
  }

  // Load Balancing 을 거친 실제 타겟 모델 뽑아줌
  const modelConfig = resolveModelConfig(modelId);

  if (!modelConfig) {
    return c.json(
      {
        error: {
          message: `지원하지 않는 모델명(Alias)입니다: ${modelId}`,
          type: "invalid_request_error",
        },
      },
      400,
    );
  }

  if (!process.env[modelConfig.targetKeyEnv]) {
    return c.json(
      {
        error: {
          message: `해당 연결된 다중 모델 혹은 단일 모델('${modelConfig.targetModel || modelId}')은 서버에 API 키(${modelConfig.targetKeyEnv})가 설정되지 않아 현재 비활성화되어 있습니다.`,
          type: "server_configuration_error",
        },
      },
      503,
    );
  }

  const limitCheck = checkRateLimits(user.arca_id, modelId);
  if (!limitCheck.allowed) {
    return c.json(
      { error: { message: limitCheck.error, type: "rate_limit_exceeded" } },
      429,
    );
  }

  // 1. 요청 락 설정
  recordRequestStart(user.arca_id, modelId);

  // 2. 적절한 핸들러 가져오기
  const handlerInstance = getHandler(modelConfig.handler, {
    c,
    user,
    modelConfig,
    body,
  });

  if (!handlerInstance) {
    // 핸들러가 없으면 락 해제 후 에러 반환
    recordRequestEnd(user.arca_id, modelId);
    return c.json(
      {
        error: {
          message: `Handler '${modelConfig.handler}' not found for model ${modelId}`,
          type: "server_error",
        },
      },
      501,
    );
  }

  // 3. 핸들러에 위임 (에러 처리 및 락 해제는 핸들러가 책임짐)
  return handlerInstance.handleAction();
});
