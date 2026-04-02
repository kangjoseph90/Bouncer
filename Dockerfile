# 1. Base image (Bun)
FROM oven/bun:latest-slim AS base
WORKDIR /app

# 2. 의존성 설치
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# 3. 소스 코드 복사
COPY . .

# 4. models.json 기본값 생성 (없으면 example에서 복사)
RUN if [ ! -f models.json ]; then cp models.example.json models.json; fi

# 5. 환경 변수 기본값 설정
ENV PORT=3000
ENV NODE_ENV=production

# 5. 포트 노출
EXPOSE 3000

# 6. 실행 (SQLite DB는 /app 디렉토리에 bouncer.sqlite로 생성됨)
CMD ["bun", "run", "src/index.ts"]
