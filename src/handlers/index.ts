import { BaseHandler, HandlerParams } from './base';
import { OpenAIHandler } from './openai';
import { AnthropicHandler } from './anthropic';

export function getHandler(handlerType: string, params: HandlerParams): BaseHandler | null {
  switch (handlerType.toLowerCase()) {
    case 'openai':
      return new OpenAIHandler(params);
    case 'anthropic':
      return new AnthropicHandler(params);
    default:
      return null;
  }
}
