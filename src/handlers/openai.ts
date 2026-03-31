import { BaseHandler } from "./base";

export class OpenAIHandler extends BaseHandler {
  async handleAction(): Promise<Response> {
    const bodyArgs = { ...this.body };

    // LiteLLM 라우팅 방식: Bouncer의 Model Alias 치환
    // 유저가 보낸 가짜/별명 모델명을 진짜 백엔드(업스트림) 모델로 강제로 덮어씌워서 전송
    if (this.targetModel) {
      bodyArgs.model = this.targetModel;
    }

    // Bouncer 프록시 정책: RisuAI 등 메인 클라이언트 환경과 과금 정밀도, 그리고 관리의 용이성을 위해 통신 스트리밍을 강제로 차단하고 대기형 JSON 전송으로 변경합니다.
    bodyArgs.stream = false;
    delete bodyArgs.stream_options; // 불필요 옵션 안전 제거

    try {
      const upstreamReq = new Request(this.targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(bodyArgs),
      });

      const response = await fetch(upstreamReq);

      if (!response.ok) {
        this.releaseLock();
        return new Response(response.body, {
          status: response.status,
          headers: response.headers,
        });
      }

      // 100% 안전한 완전체 JSON 파싱과 토큰 추출 로직
      const respData = (await response.json()) as any;
      const usage = respData.usage;

      if (usage) {
        const totalPromptTokens = usage.prompt_tokens || 0;
        const cachedTokens =
          usage.prompt_tokens_details?.cached_tokens ||
          usage.prompt_cache_hit_tokens ||
          0;
        const promptTokens = Math.max(0, totalPromptTokens - cachedTokens);
        const completionTokens = usage.completion_tokens || 0;

        this.applyCharge(promptTokens, completionTokens, cachedTokens);
      } else {
        this.applyCharge(0, 0, 0); // usage 필드가 없으면 기본 차감치 적용
      }

      this.releaseLock();
      return this.c.json(respData, response.status as any);
    } catch (e: any) {
      this.releaseLock();
      return this.c.json(
        {
          error: {
            message: "서버 업스트림 통신 오류 (Upstream Fetch Error)",
            type: "server_error",
          },
        },
        502,
      );
    }
  }
}
