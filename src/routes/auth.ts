import { Hono } from 'hono';
import { generateVerificationToken, isValidToken, consumeToken } from '../utils/token';
import { findTokenInPost, validateProfileActivity } from '../services/crawler';
import { config } from '../utils/config';
import { getUserByArcaId, createUser, revokeAndReissue, getSetting, getUserCounts } from '../db/queries';

export const authRoutes = new Hono();

// 1. 임시 토큰 발급
authRoutes.get('/token', (c) => {
  const data = generateVerificationToken();
  const currentPostUrl = getSetting('ARCA_POST_URL');
  return c.json({
    success: true,
    token: data.token,
    postUrl: currentPostUrl,
    expiresIn: data.expiresIn
  });
});

// 2. 인증 완료 및 키 발급/재발급
authRoutes.post('/verify', async (c) => {
  try {
    const { token } = await c.req.json<{ token: string }>();

    if (!token) {
      return c.json({ success: false, error: '토큰이 제공되지 않았습니다.' }, 400);
    }

    if (!isValidToken(token)) {
      return c.json({ success: false, error: '만료되었거나 유효하지 않은 토큰입니다.' }, 400);
    }

    const currentPostUrl = getSetting('ARCA_POST_URL');
    if (!currentPostUrl) {
      return c.json({ success: false, error: '서버에 ARCA_POST_URL(인증 게시글 위치)이 아직 설정되지 않았습니다. 관리자에게 문의하세요.' }, 500);
    }

    // 아카라이브 게시글 크롤링으로 토큰 찾기
    let profileData: { type: 'fixed' | 'half'; arcaId: string; displayName?: string } | null = null;
    
    try {
       profileData = await findTokenInPost(currentPostUrl, token);
    } catch(e: any) {
       return c.json({ success: false, error: e.message || '게시글 크롤링 중 오류' }, 500);
    }

    if (!profileData) {
      return c.json({ 
        success: false, 
        error: '지정된 게시글에서 해당 토큰을 포함한 유효한 프로필(유동닉 제외)을 찾지 못했습니다.' + 
               (!config.ALLOW_HALF_NICK ? ' (현재 고정닉만 허용)' : '')
      }, 400);
    }

    // 프로필 활동량 검증 (ENV 조건이 하나라도 설정되어 있을 때만 실행)
    const hasProfileChecks = 
      config.MIN_ACTIVE_DAYS !== Infinity || 
      config.MAX_INACTIVE_DAYS !== Infinity || 
      (config.TARGET_CHANNELS.length > 0 && config.MIN_CHANNEL_POSTS !== Infinity);

    if (hasProfileChecks) {
      try {
        // profileData.arcaId에서 원래 href 복원
        const profileHref = profileData.type === 'half' 
          ? `/u/@${encodeURIComponent(profileData.displayName || '')}/${profileData.arcaId.replace('half_', '')}`
          : `/u/@${encodeURIComponent(profileData.displayName || '')}`;

        const validation = await validateProfileActivity(profileHref);
        if (!validation.passed) {
          return c.json({ 
            success: false, 
            error: `활동 조건 미달: ${validation.reason}` 
          }, 403);
        }
      } catch (e: any) {
        return c.json({ success: false, error: e.message || '프로필 검증 중 오류' }, 500);
      }
    }

    // 기존 유저인지 확인
    const existing = getUserByArcaId(profileData.arcaId);
    let resultApiKey = '';
    let isReissue = false;

    if (existing) {
      if (existing.status === 'suspended') {
        return c.json({ success: false, error: '관리자에 의해 영구 정지된 계정입니다. API를 사용할 수 없습니다.' }, 403);
      }
      // 기존 유저면 새 키 발급 (기존 키 파기 및 상태 active 복구)
      const data = revokeAndReissue(profileData.arcaId, profileData.displayName || '');
      resultApiKey = data.apiKey;
      isReissue = true;
    } else {
      // 유저 수 제한 체크
      const counts = getUserCounts();
      if (counts.total >= config.GLOBAL_MAX_USERS) {
        return c.json({ success: false, error: '유저 등록 한도 초과 (GLOBAL_MAX_USERS)' }, 403);
      }
      if (counts.active >= config.GLOBAL_MAX_ACTIVE_USERS) {
        return c.json({ success: false, error: '활성 유저 한도 초과 (GLOBAL_MAX_ACTIVE_USERS)' }, 403);
      }
      // 신규 유저 생성
      const data = createUser(profileData.arcaId, profileData.type, profileData.displayName || '');
      resultApiKey = data.apiKey;
    }

    // 성공 시 토큰 메모리에서 삭제
    consumeToken(token);

    return c.json({
      success: true,
      data: {
        arcaId: profileData.arcaId,
        isReissue,
        apiKey: resultApiKey
      }
    });

  } catch (error: any) {
    console.error('Verify error:', error);
    return c.json({ success: false, error: '인증 처리 중 서버 오류가 발생했습니다.' }, 500);
  }
});

