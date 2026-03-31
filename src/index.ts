import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { authRoutes } from './routes/auth';
import { proxyRoutes } from './routes/proxy';
import { dashboardRoutes } from './routes/dashboard';
import { adminRoutes } from './routes/admin';
import { initDB } from './db/schema';
import { config } from './utils/config';

const app = new Hono();

// 1. Database Initialization
console.log('Initializing SQLite Database...');
initDB();

// 2. Static File Serving (Frontend)
app.use('/*', serveStatic({ root: './public' }));

// 3. API Routing
// 대시보드 및 상태 조회
app.route('/api', dashboardRoutes);

// 관리자 패널
app.route('/api/admin', adminRoutes);

// 인증 서버
app.route('/api/auth', authRoutes);

// LLM 프록시 서버 (OpenAI 형식 호환)
app.route('/', proxyRoutes);

// 4. Server Start
console.log(`Bouncer Proxy is running on port ${config.PORT}`);
console.log(`API URL: http://localhost:${config.PORT}/v1/chat/completions`);

export default {
  port: config.PORT,
  fetch: app.fetch,
};
