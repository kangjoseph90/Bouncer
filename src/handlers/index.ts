import { BaseHandler, HandlerParams } from './base';
import { OpenAIHandler } from './openai';
import { AnthropicHandler } from './anthropic';
import { GoogleHandler } from './google';

export function getHandler(handlerType: string, params: HandlerParams): BaseHandler | null {
  switch (handlerType.toLowerCase()) {
    case 'openai':
      return new OpenAIHandler(params);
    case 'anthropic':
      return new AnthropicHandler(params);
    case 'google':
      return new GoogleHandler(params);
    default:
      return null;
  }
}
