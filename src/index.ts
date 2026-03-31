import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";

import { authRoutes } from "./routes/auth";
import { proxyRoutes } from "./routes/proxy";
import { dashboardRoutes } from "./routes/dashboard";
import { adminRoutes } from "./routes/admin";
import { initDB } from "./db/schema";
import { config } from "./utils/config";

const app = new Hono();

// Global Middleware
// Private Network Access (PNA) 대응: 브라우저가 http://localhost 접근 시 검사하는 PNA 헤더 응답
app.use("/*", async (c, next) => {
  if (c.req.method === "OPTIONS" && c.req.header("Access-Control-Request-Private-Network")) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, HTTP-Referer, X-Title, Access-Control-Request-Private-Network",
        "Access-Control-Max-Age": "86400",
        "Access-Control-Allow-Private-Network": "true"
      }
    });
  }
  await next();
});

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "HTTP-Referer",
      "X-Title",
      "Access-Control-Request-Private-Network",
    ],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }),
);

// 1. Database Initialization
console.log("Initializing SQLite Database...");
initDB();

// 2. Static File Serving (Frontend)
app.use("/*", serveStatic({ root: "./public" }));

// 3. Health Check (Infrastructure Monitoring)
app.get("/health", (c) => {
  try {
    const db = initDB();
    db.query("SELECT 1").get();
    return c.json({
      status: "ok",
      database: "connected",
      timestamp: Date.now(),
    });
  } catch (e) {
    return c.json(
      { status: "error", message: "Database connection failed" },
      500,
    );
  }
});

// 4. API Routing
// 대시보드 및 상태 조회
app.route("/api", dashboardRoutes);

// 관리자 패널
app.route("/api/admin", adminRoutes);

// 인증 서버
app.route("/api/auth", authRoutes);

// LLM 프록시 서버 (OpenAI 형식 호환)
app.route("/", proxyRoutes);

// 4. Server Start
console.log(`Bouncer Proxy is running on port ${config.PORT}`);
console.log(`API URL: http://localhost:${config.PORT}/v1/chat/completions`);

export default {
  port: config.PORT,
  fetch: app.fetch,
};
