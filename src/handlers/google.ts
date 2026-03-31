import { BaseHandler } from "./base";

export class GoogleHandler extends BaseHandler {
  async handleAction(): Promise<Response> {
    const bodyArgs = { ...this.body };

    // Bouncer 프록시 정책: 과금 관리를 위해 스트리밍 비활성화
    bodyArgs.stream = false;

    // 1. OpenAI 규격 -> Gemini(Google AI) 규격 변환
    const geminiPayload: any = {
      contents: [],
      generationConfig: {},
    };

    const messages = bodyArgs.messages || [];
    let systemInstruction = "";

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction += (msg.content || "") + "\n";
      } else {
        // OpenAI 'assistant' -> Gemini 'model'
        const role = msg.role === "assistant" ? "model" : "user";
        geminiPayload.contents.push({
          role: role,
          parts: [{ text: msg.content || "" }],
        });
      }
    }

    if (systemInstruction.trim()) {
      geminiPayload.system_instruction = {
        parts: [{ text: systemInstruction.trim() }],
      };
    }

    // Generation Config 매핑
    if (bodyArgs.temperature !== undefined)
      geminiPayload.generationConfig.temperature = bodyArgs.temperature;
    if (bodyArgs.top_p !== undefined)
      geminiPayload.generationConfig.topP = bodyArgs.top_p;
    if (
      bodyArgs.max_tokens !== undefined ||
      bodyArgs.max_completion_tokens !== undefined
    ) {
      geminiPayload.generationConfig.maxOutputTokens =
        bodyArgs.max_tokens || bodyArgs.max_completion_tokens;
    }
    if (bodyArgs.stop) {
      geminiPayload.generationConfig.stopSequences = Array.isArray(
        bodyArgs.stop,
      )
        ? bodyArgs.stop
        : [bodyArgs.stop];
    }

    // 2. 업스트림 통신 URL 구성 (자동 조합)
    // targetUrl: https://generativelanguage.googleapis.com/v1beta
    // targetModel: gemini-3-flash
    // Result: https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=...
    const baseUrl = this.targetUrl.endsWith("/")
      ? this.targetUrl.slice(0, -1)
      : this.targetUrl;
    const modelPath = `/models/${this.targetModel}:generateContent`;
    const finalUrl = `${baseUrl}${modelPath}${baseUrl.includes("?") ? "&" : "?"}key=${this.apiKey}`;

    try {
      const response = await fetch(finalUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 헤더로도 상호 보완적으로 전송 (Vertex AI 등 호환성 고려)
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(geminiPayload),
      });

      if (!response.ok) {
        this.releaseLock();
        const errorData = await response.json().catch(() => ({}));
        return new Response(JSON.stringify(errorData), {
          status: response.status,
          headers: response.headers,
        });
      }

      const geminiData = (await response.json()) as any;

      // 3. 과금 처리 (usageMetadata 추출)
      const usage = geminiData.usageMetadata;
      const totalPromptTokens = usage?.promptTokenCount || 0;
      const cachedTokens = usage?.cachedContentTokenCount || 0;

      // pensamientos/추론 토큰(thoughtsTokenCount)이 있으면 출력 토큰에 합산 (Gemini 2.0+ 대응)
      const outputTokens =
        (usage?.candidatesTokenCount || 0) + (usage?.thoughtsTokenCount || 0);

      // 일반 프롬프트 토큰 = 전체 프롬프트 - 캐시된 토큰
      const promptTokens = Math.max(0, totalPromptTokens - cachedTokens);

      this.applyCharge(promptTokens, outputTokens, cachedTokens);
      this.releaseLock();

      // 4. Gemini 응답 -> OpenAI 규격 역변환
      const candidate = geminiData.candidates?.[0];
      const textContent = candidate?.content?.parts?.[0]?.text || "";

      let finishReason = "stop";
      if (candidate?.finishReason === "MAX_TOKENS") finishReason = "length";
      else if (candidate?.finishReason === "SAFETY")
        finishReason = "content_filter";

      const openaiResponse = {
        id: `chatcmpl-gemini-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: this.targetModel || this.modelId,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: textContent,
            },
            finish_reason: finishReason,
          },
        ],
        usage: {
          prompt_tokens: promptTokens + cachedTokens,
          completion_tokens: outputTokens,
          total_tokens: promptTokens + cachedTokens + outputTokens,
        },
      };

      return this.c.json(openaiResponse, 200);
    } catch (e: any) {
      this.releaseLock();
      return this.c.json(
        {
          error: {
            message: `Google Gemini 업스트림 통신 오류: ${e.message}`,
            type: "server_error",
          },
        },
        502,
      );
    }
  }
}
