import { Context } from 'hono';
import { ModelConfig, config } from '../utils/config';
import { chargeUsage } from '../db/queries';
import { recordRequestEnd } from '../services/ratelimit';

export interface HandlerParams {
  c: Context;
  user: { arca_id: string; credit_balance: number };
  modelConfig: ModelConfig;
  body: any;
}

export abstract class BaseHandler {
  // 모델 런타임 환경 (Subclass 사용 편의성)
  protected arcaId: string;
  protected modelId: string;
  protected targetModel: string;
  protected targetUrl: string;
  protected apiKey: string;
  protected billingType: 'token' | 'request';
  protected cost: { prompt?: number; completion?: number; request?: number };
  
  // 컨텍스트 접근 (Hono 및 Request Body)
  protected c: Context;
  protected body: any;

  constructor(protected params: HandlerParams) {
    this.c = params.c;
    this.body = params.body;
    this.arcaId = params.user.arca_id;
    
    // Model 설정 해체 및 주입
    const mc = params.modelConfig;
    this.modelId = mc.id;
    this.targetModel = mc.targetModel;
    this.targetUrl = mc.targetUrl;
    this.billingType = mc.billingType;
    this.cost = mc.cost;

    // 환경 변수 실시간 추출 (API Key 파싱)
    this.apiKey = process.env[mc.targetKeyEnv] || '';
  }

  // 메인 라우팅 함수
  abstract handleAction(): Promise<Response>;

  // 과금 유틸리티
  protected applyCharge(pTokens: number, cTokens: number) {
    let finalCost = 0;
    
    // 모델스펙이 request 면 무조건 횟수과금으로 판정
    if (this.billingType === 'request') {
       finalCost = this.cost.request || 1;
    } else {
       // Token billing 모델
       const p = this.cost.prompt || 1;
       const c = this.cost.completion || 1;
       finalCost = (pTokens * p) + (cTokens * c);
    }
    
    chargeUsage(this.arcaId, this.modelId, pTokens, cTokens, Math.ceil(finalCost));
  }

  // 요청 종료 라이프사이클 훅
  protected releaseLock() {
    recordRequestEnd(this.arcaId, this.modelId);
  }
}
