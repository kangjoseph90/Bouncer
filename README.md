# Bouncer

아카라이브 커뮤니티 전용 AI API 프록시.  
OpenAI, Anthropic, Gemini 포맷을 지원하며, 이 포맷을 따르는 어떤 AI 서비스든 자유롭게 연결할 수 있습니다.  
고정닉/반고닉 사용자의 활동량을 검증하여 API 키를 발급하고, 사용량을 통합 관리합니다.

> **Bun + Hono + SQLite(WAL)** 기반 — 단일 바이너리 수준의 가벼운 배포가 가능합니다.

---

## 목차

1. [빠른 시작](#빠른-시작)
2. [환경 변수 레퍼런스](#환경-변수-레퍼런스)
3. [모델 설정 (`models.json`)](#모델-설정-modelsjson)
4. [배포 가이드](#배포-가이드)
5. [관리자 대시보드](#관리자-대시보드)
6. [API 엔드포인트](#api-엔드포인트)
7. [프로젝트 구조](#프로젝트-구조)
8. [트러블슈팅](#트러블슈팅)

---

## 빠른 시작

### Windows (원클릭)

```
start.bat 더블 클릭
```

스크립트가 자동으로 다음을 수행합니다:

1. `.env` / `models.json` 미존재 시 예제 파일에서 복사 → 메모장으로 편집 유도
2. Bun 런타임 미설치 시 자동 설치
3. `bun install` → 의존성 설치
4. 실행 모드 선택:
   - **1) Local** — `http://localhost:3000` 에서 내부망 전용 실행
   - **2) Public** — Cloudflare Quick Tunnel로 임시 공개 URL 자동 발급

### Docker (Linux / 고급 사용자)

```bash
git clone <repo-url> && cd bouncer
cp .env.example .env    # 편집 필수
cp models.example.json models.json
docker compose up -d
```

터널 URL 확인:

```bash
docker compose logs tunnel | grep "trycloudflare.com"
```

### 수동 (Bun 직접 실행)

```bash
bun install
cp .env.example .env    # 편집 필수
cp models.example.json models.json
bun run start           # 또는 bun run dev (watch 모드)
```

> 서버 기동 후 `http://localhost:3000` 에서 대시보드에 접속할 수 있습니다.

---

## 환경 변수 레퍼런스

`.env` 파일에서 설정합니다. 전체 예시는 `.env.example`을 참고하세요.

### 서버 기본

| 변수                      | 기본값   | 설명                                                             |
| ------------------------- | -------- | ---------------------------------------------------------------- |
| `PORT`                    | `3000`   | 서버 포트                                                        |
| `ADMIN_PASSWORD`          | —        | **필수.** 관리자 패널 및 Admin API 인증 비밀번호                 |
| `LOAD_BALANCING_STRATEGY` | `random` | 동일 alias 모델이 여럿일 때 선택 방식 (`random` / `round-robin`) |

### 아카라이브 인증 조건

| 변수                | 기본값 | 설명                                               |
| ------------------- | ------ | -------------------------------------------------- |
| `ALLOW_HALF_NICK`   | `true` | 반고닉 허용 여부                                   |
| `MIN_ACTIVE_DAYS`   | —      | 프로필 히트맵 최소 활동 일수 (미입력 = 제한 없음)  |
| `MAX_INACTIVE_DAYS` | —      | 마지막 활동 이후 허용 경과일 (미입력 = 제한 없음)  |
| `TARGET_CHANNELS`   | —      | 확인 대상 채널 (쉼표 구분, 미입력 = 제한 없음)     |
| `MIN_CHANNEL_POSTS` | —      | 대상 채널 최소 게시글+댓글 수 (미입력 = 제한 없음) |

### 인증 보안

| 변수                      | 기본값 | 설명                       |
| ------------------------- | ------ | -------------------------- |
| `AUTH_TOKEN_TTL_MINS`     | `5`    | 인증 토큰 유효 시간(분)    |
| `AUTH_TOKEN_VERIFY_LIMIT` | `5`    | 토큰당 검증 시도 허용 횟수 |

### API 키

API 키 변수명은 **고정이 아닙니다.** `models.json`의 `targetKeyEnv`에서 참조할 이름을 자유롭게 정의하고, `.env`에 같은 이름으로 값을 넣으면 됩니다.

```bash
# 예시: 원하는 이름으로 자유롭게 추가
OPENAI_API_KEY=sk-...
ZAI_API_KEY=abc123...
COPILOT_API_KEY=ghu_...
MY_CUSTOM_KEY=xyz...
```

### 서버 전체 제한 (Global)

| 변수                       | 기본값     | 설명                                     |
| -------------------------- | ---------- | ---------------------------------------- |
| `GLOBAL_MAX_USERS`         | `1000`     | 최대 등록 유저 수                        |
| `GLOBAL_MAX_ACTIVE_USERS`  | `500`      | 최대 활성 유저 수                        |
| `GLOBAL_MAX_CONCURRENCY`   | `50`       | 동시 요청 수                             |
| `GLOBAL_MAX_RPM`           | `1000`     | 분당 요청 수                             |
| `GLOBAL_MAX_RPH`           | `50000`    | 시간당 요청 수                           |
| `GLOBAL_MAX_RPD`           | `100000`   | 일일 요청 수                             |
| `GLOBAL_QUOTA`             | `10000000` | 서버 전체 크레딧 (≈ 100만/$1)            |
| `GLOBAL_QUOTA_REFILL_MODE` | `none`     | 리필 주기 (`none` / `daily` / `monthly`) |

### 유저별 제한 (Per-User)

| 변수                     | 기본값    | 설명                                     |
| ------------------------ | --------- | ---------------------------------------- |
| `USER_MAX_CONCURRENCY`   | `2`       | 동시 요청 수                             |
| `USER_MAX_RPM`           | `20`      | 분당 요청 수                             |
| `USER_MAX_RPH`           | `1000`    | 시간당 요청 수                           |
| `USER_MAX_RPD`           | `1000`    | 일일 요청 수                             |
| `USER_QUOTA`             | `5000000` | 기본 크레딧 할당량                       |
| `USER_QUOTA_REFILL_MODE` | `none`    | 리필 주기 (`none` / `daily` / `monthly`) |

---

## 모델 설정 (`models.json`)

`models.json`에서 프록시할 모델과 과금 정책을 정의합니다. 예시 파일: `models.example.json`

### 핵심 개념: `handler`는 API 포맷이다

`handler`는 특정 AI 회사를 뜻하는 것이 **아닙니다.** 대상 API가 사용하는 **프로토콜(요청/응답 형식)**을 지정하는 것입니다.

| handler       | 의미                              | 해당 포맷을 쓰는 서비스 예시                             |
| ------------- | --------------------------------- | -------------------------------------------------------- |
| `"openai"`    | OpenAI Chat Completions 호환 포맷 | OpenAI, Z.AI, GitHub Copilot, Groq, Together AI, vLLM 등 |
| `"anthropic"` | Anthropic Messages 포맷           | Anthropic, AWS Bedrock(Anthropic)                        |
| `"google"`    | Gemini generateContent 포맷       | Google Gemini                                            |

따라서 OpenAI 포맷을 따르는 서비스라면 어디든 `handler: "openai"`로 연결할 수 있습니다.

### 설정 예시

**토큰 과금 모델 (Z.AI — OpenAI 포맷 사용):**

```jsonc
{
  "id": "zai/glm-5.1", // 유저에게 노출되는 모델 ID
  "displayName": "ZAI GLM-5.1", // 대시보드 표시명
  "targetModel": "glm-5.1", // 실제 API에 전달되는 모델명
  "targetUrl": "https://api.z.ai/api/coding/paas/v4/chat/completions",
  "targetKeyEnv": "ZAI_API_KEY", // .env에서 읽어올 키 변수명 (자유 정의)
  "billingType": "token",
  "cost": { "prompt": 1, "completion": 3.2, "cached": 0.2 },
  "limits": { "concurrency": 3 },
  "handler": "openai", // ← Z.AI지만 OpenAI 포맷이므로 "openai"
}
```

**요청 횟수 과금 모델 (GitHub Copilot):**

```jsonc
{
  "id": "copilot/gpt-4.1",
  "displayName": "GitHub Copilot GPT-4.1",
  "targetModel": "gpt-4.1",
  "targetUrl": "https://api.githubcopilot.com/chat/completions",
  "targetKeyEnv": "COPILOT_API_KEY",
  "billingType": "request", // 토큰이 아닌 요청 1건당 과금
  "cost": { "request": 100 },
  "limits": { "concurrency": 2 },
  "handler": "openai",
}
```

### 필드 레퍼런스

| 필드                 | 필수 | 설명                                                    |
| -------------------- | ---- | ------------------------------------------------------- |
| `id`                 | ✅   | 유저에게 노출되는 고유 모델 ID                          |
| `displayName`        | ✅   | 대시보드에 표시되는 이름                                |
| `targetModel`        | ✅   | 실제 API에 전달되는 모델 식별자                         |
| `targetUrl`          | ✅   | 프록시 대상 API 엔드포인트 URL                          |
| `targetKeyEnv`       | ✅   | `.env`에서 API 키를 읽어올 변수명 (자유 정의)           |
| `handler`            | ✅   | API 포맷: `"openai"` / `"anthropic"` / `"google"`       |
| `billingType`        | ✅   | `"token"` (토큰 기반) 또는 `"request"` (요청 횟수 기반) |
| `cost.prompt`        | —    | 입력 토큰당 크레딧 (`billingType: "token"` 시)          |
| `cost.completion`    | —    | 출력 토큰당 크레딧 (`billingType: "token"` 시)          |
| `cost.cached`        | —    | 캐시 히트 토큰당 크레딧 (선택, 미입력 시 prompt와 동일) |
| `cost.request`       | —    | 요청 1건당 크레딧 (`billingType: "request"` 시)         |
| `limits.concurrency` | —    | 이 모델의 동시 요청 수 제한                             |

> **핫 리로드:** 관리자 대시보드에서 **Reload Models** 버튼을 누르면 서버 재시작 없이 즉시 반영됩니다.

---

## 배포 가이드

`start.bat`이나 Docker에 포함된 **Cloudflare Quick Tunnel은 임시 URL**입니다.  
재부팅/네트워크 변경 시 주소가 바뀌므로, 장기 운영에는 아래 방법을 권장합니다.

| 방법                                    | 비용          | 난이도 | 특징                                           |
| --------------------------------------- | ------------- | ------ | ---------------------------------------------- |
| **Cloudflare Zero Trust + 개인 도메인** | 도메인 비용만 | ★★☆    | 포트포워딩 불필요, DDoS 방어, 고정 HTTPS       |
| **VPS + Caddy/Nginx**                   | 월 $3~10      | ★★★    | 정석 클라우드 배포, 오라클 무료 티어 활용 가능 |
| **홈 서버 + 포트포워딩 + DDNS**         | 무료          | ★★☆    | NAS/개인 서버 활용, DuckDNS 등                 |

---

## 관리자 대시보드

`http://localhost:3000` 접속 → Admin 탭에서 `ADMIN_PASSWORD`로 로그인

**주요 기능:**

- **유저 관리** — 실시간 검색, 영구 정지(Suspend), API 키 폐기(Revoke)
- **서버 설정** — 인증 글 URL 변경, `.env` / `models.json` 핫 리로드
- **모니터링** — 서버/유저별 통계 대시보드, 요청량·크레딧 소비 차트

---

## API 엔드포인트

### 프록시 (클라이언트용)

| Method | Path                   | 설명                                      |
| ------ | ---------------------- | ----------------------------------------- |
| `POST` | `/v1/chat/completions` | OpenAI 호환 채팅 완성 (SSE 스트리밍 지원) |
| `GET`  | `/v1/models`           | 사용 가능한 모델 목록                     |

> **Authorization:** `Bearer <user-api-key>`

### 인증

| Method | Path               | 설명                                 |
| ------ | ------------------ | ------------------------------------ |
| `GET`  | `/api/auth/token`  | 인증 토큰 발급                       |
| `POST` | `/api/auth/verify` | 아카라이브 프로필 검증 → API 키 발급 |

### 관리자

| Method | Path                       | 설명                    |
| ------ | -------------------------- | ----------------------- |
| `GET`  | `/api/admin/users`         | 유저 검색               |
| `POST` | `/api/admin/suspend`       | 유저 영구 정지          |
| `POST` | `/api/admin/revoke`        | API 키 폐기             |
| `POST` | `/api/admin/reload-env`    | `.env` 핫 리로드        |
| `POST` | `/api/admin/reload-models` | `models.json` 핫 리로드 |

> **Authorization:** `Admin <ADMIN_PASSWORD>`

### 상태 확인

| Method | Path           | 설명            |
| ------ | -------------- | --------------- |
| `GET`  | `/health`      | 서버 및 DB 상태 |
| `GET`  | `/api/stats/*` | 서버/유저 통계  |

---

## 프로젝트 구조

```
bouncer/
├── src/
│   ├── index.ts            # 앱 엔트리포인트 (Hono 라우팅)
│   ├── routes/
│   │   ├── proxy.ts        # /v1/* 프록시 라우팅
│   │   ├── auth.ts         # 인증 토큰 발급 & 검증
│   │   ├── admin.ts        # 관리자 API
│   │   ├── dashboard.ts    # 대시보드 데이터
│   │   └── stats.ts        # 통계 API
│   ├── handlers/
│   │   ├── base.ts         # 공통 핸들러 인터페이스
│   │   ├── openai.ts       # OpenAI 형식 핸들러
│   │   ├── anthropic.ts    # Anthropic 형식 핸들러
│   │   └── google.ts       # Gemini 형식 핸들러
│   ├── services/
│   │   ├── crawler.ts      # 아카라이브 프로필 크롤러
│   │   └── ratelimit.ts    # 레이트 리미터
│   ├── db/                 # SQLite 스키마 & 쿼리
│   └── utils/              # 설정, 유틸리티
├── public/                 # 프론트엔드 (SPA)
├── models.json             # 모델 & 과금 설정
├── .env                    # 환경 변수
├── docker-compose.yml      # Docker 배포 설정
├── start.bat               # Windows 원클릭 실행
└── Dockerfile
```

---

## 트러블슈팅

### 서버가 시작되지 않음

```bash
bun run start
# → "Database connection failed" 에러 시:
# bouncer.sqlite 파일의 쓰기 권한을 확인하세요.
```

### Cloudflare Tunnel URL이 바뀜

Quick Tunnel은 임시 URL입니다. 고정 URL이 필요하면 [배포 가이드](#배포-가이드)를 참조하세요.

### `context canceled` 에러 (Tunnel 로그)

클라이언트(SillyTavern 등)가 응답 수신 전 연결을 끊은 경우 발생합니다.  
서버 측 오류가 아니며, 크레딧은 실제 소비된 토큰만큼만 차감됩니다.

### 모델 변경이 반영되지 않음

`models.json` 수정 후 관리자 패널에서 **Reload Models** 버튼을 누르세요.  
`.env` 변경도 마찬가지로 **Reload Env** 버튼으로 핫 리로드 가능합니다.

---

## 라이선스

이 프로젝트는 커뮤니티 배포 및 개인 학습용으로 제작되었습니다.
