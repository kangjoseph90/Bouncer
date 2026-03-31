import { Hono } from 'hono';
import { getUserByApiKey, getServerStats, revokeKey } from '../db/queries';

export const dashboardRoutes = new Hono();

// 1. 개인 대시보드 - 남은 쿼터(크레딧) 및 유저 정보
// API 키로 인증하여 조회합니다.
dashboardRoutes.get('/dashboard', (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const apiKey = authHeader.replace('Bearer ', '').trim();

  if (!apiKey || !apiKey.startsWith('bnc-')) {
    return c.json({ success: false, error: '유효한 API 키가 제공되지 않았습니다.' }, 401);
  }

  const user = getUserByApiKey(apiKey);
  if (!user) {
    return c.json({ success: false, error: '존재하지 않거나 정지된 계정입니다.' }, 401);
  }

  return c.json({
    success: true,
    data: {
       arcaId: user.arca_id,
       displayName: user.display_name,
       creditBalance: user.credit_balance,
       status: user.status
    }
  });
});

// 2. 서버 통계 (퍼블릭)
dashboardRoutes.get('/status', (c) => {
  const stats = getServerStats();
  
  return c.json({
    success: true,
    data: {
      totalUsers: stats.totalUsers,
      activeUsers24h: stats.activeUsers,
      serverStatus: 'online',
      message: '서버는 현재 활성 상태이며, 요청을 수신할 수 있습니다.'
    }
  });
});

// 3. API 키 즉시 파기
// 현재 키를 헤더에 실어 요청하면, 해당 키를 무력화시킵니다.
dashboardRoutes.post('/revoke', (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const apiKey = authHeader.replace('Bearer ', '').trim();

  if (!apiKey || !apiKey.startsWith('bnc-')) {
    return c.json({ success: false, error: '유효한 API 키가 제공되지 않았습니다.' }, 401);
  }

  // 이 키가 유효한지 확인 (유효해야 본인 소유임을 증명함)
  const user = getUserByApiKey(apiKey);
  if (!user) {
    return c.json({ success: false, error: '존재하지 않거나 이미 정지/파기된 계정입니다.' }, 401);
  }

  try {
    revokeKey(user.arca_id);
    return c.json({ 
      success: true, 
      message: 'API 키가 성공적으로 파기되었습니다. 더 이상 이 키로 프록시를 사용할 수 없습니다.' 
    });
  } catch (error) {
    console.error('Revoke error:', error);
    return c.json({ success: false, error: '파기 처리 중 서버 오류가 발생했습니다.' }, 500);
  }
});
