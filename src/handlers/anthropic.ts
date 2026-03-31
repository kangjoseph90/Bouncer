import { BaseHandler } from './base';

export class AnthropicHandler extends BaseHandler {
  async handleAction(): Promise<Response> {
    const bodyArgs = { ...this.body };
    
    // 1. 모델명 리볼빙 치환
    const anthropicModel = this.targetModel || this.modelId;

    // 2. OpenAI 규격을 Anthropic 규격으로 어댑팅(Translation)
    let systemPrompt = '';
    const anthropicMessages: { role: string; content: string }[] = [];

    const messages = bodyArgs.messages || [];
    let lastRole = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (msg.content || '') + '\n';
      } else {
        // Anthropic은 user와 assistant 롤만 허용
        const targetRole = msg.role === 'assistant' ? 'assistant' : 'user';
        // Anthropic은 빈 문자열을 허용하지 않음 방어
        const content = msg.content || ' ';
        
        if (anthropicMessages.length > 0 && lastRole === targetRole) {
          // Anthropic은 연속된 롤(user-user)을 엄격히 금지함. 병합 처리로 강제 해결
          anthropicMessages[anthropicMessages.length - 1].content += '\n\n' + content;
        } else {
          anthropicMessages.push({ role: targetRole, content: content });
          lastRole = targetRole;
        }
      }
    }

    const anthropicPayload: any = {
      model: anthropicModel,
      messages: anthropicMessages,
      max_tokens: bodyArgs.max_tokens || bodyArgs.max_completion_tokens || 4096, // 필수 파라미터 강제 방어
      stream: false
    };

    if (systemPrompt.trim() !== '') {
      anthropicPayload.system = systemPrompt.trim();
    }
    if (bodyArgs.temperature !== undefined) anthropicPayload.temperature = bodyArgs.temperature;
    if (bodyArgs.top_p !== undefined) anthropicPayload.top_p = bodyArgs.top_p;
    if (bodyArgs.top_k !== undefined) anthropicPayload.top_k = bodyArgs.top_k;

    // 3. 업스트림 통신 (Anthropic API 규격 헤더)
    try {
      const upstreamReq = new Request(this.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(anthropicPayload)
      });

      const response = await fetch(upstreamReq);
      
      if (!response.ok) {
        this.releaseLock();
        // Anthropic의 원본 에러(예: 키 만료 등)를 클라이언트에게 그대로 반환
        return new Response(response.body, { status: response.status, headers: response.headers });
      }

      const anthropicData = await response.json() as any;

      // 4. 과금 처리 (Anthropic은 input_tokens / output_tokens 로 명칭 표기 다름)
      const inputTokens = anthropicData.usage?.input_tokens || 0;
      const outputTokens = anthropicData.usage?.output_tokens || 0;
      this.applyCharge(inputTokens, outputTokens);
      this.releaseLock();

      // 5. Anthropic 응답을 역으로 OpenAI 형식으로 포장(Reversing)
      const textContent = anthropicData.content?.find((c: any) => c.type === 'text')?.text || '';
      let finishReason = 'stop';
      if (anthropicData.stop_reason === 'max_tokens') finishReason = 'length';

      const openaiCompatibleResponse = {
        id: `chatcmpl-${anthropicData.id || Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: anthropicData.model || anthropicModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: textContent
            },
            finish_reason: finishReason
          }
        ],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens
        }
      };

      return this.c.json(openaiCompatibleResponse, 200);

    } catch (e: any) {
      this.releaseLock();
      return this.c.json({ error: { message: '업스트림 Anthropic 서버 치명적 오류', type: 'server_error' } }, 502);
    }
  }
}
