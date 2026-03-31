# 🛡️ Bouncer: ArcaLive Community AI Proxy

Bouncer는 아카라이브(ArcaLive) 커뮤니티 전용 AI API 프록시 서버입니다. 고정닉/반고닉 사용자의 활동량을 검증하여 API 키를 발급하고, 여러 AI 모델(OpenAI, Anthropic, Gemini)의 사용량을 통합 관리할 수 있게 해줍니다.

## 🚀 주요 기능

-   **멀티 제공자 지원**: OpenAI, Anthropic, Google Gemini (추론 토큰 및 캐시 대응 포함)
-   **커뮤니티 연동**: 아카라이브 게시글 작성을 통한 본인 인증 및 활동량 기반 필터링
-   **강력한 관리 도구**: 실시간 유저 검색, 영구 정지, 전역 설정 변경 기능 제공
-   **정밀한 과금 정책**: 토큰 기반 또는 요청 횟수 기반 과금, 글로벌/개별 쿼터 제한
-   **고성능 아키텍처**: Bun + Hono + SQLite (WAL 모드) 기반의 빠른 응답 속도

## 📦 설치 및 시작하기

### 방법 1: Windows 초보자용 (원클릭 실행)
Windows 환경에서는 복잡한 명령어 입력이나 도구 설치 없이 `start.bat` 스크립트 하나로 배포가 가능합니다.

1. 프로젝트 소스코드를 다운로드하고 압축을 해제합니다.
2. 폴더 내의 `start.bat` 파일을 **더블 클릭하여 실행**합니다.
3. 스크립트의 안내에 따라 자동으로 열리는 메모장에서 `.env` 파일과 `models.json`을 알맞게 설정합니다.
4. **외부 배포 모드(2번)**를 선택하면 원클릭으로 Cloudflare 터널 URL까지 발급되어 바로 사람들에게 공유할 수 있습니다.

### 방법 2: Docker 환경 (Linux / 고급 사용자 권장)
가장 안정적이고 권장되는 서버 배포 방법은 Docker Compose를 사용하는 것입니다.

1.  **리포지토리 클론 및 이동**
    ```bash
    git clone https://github.com/your-repo/bouncer.git
    cd bouncer
    ```

2.  **환경 변수 설정**
    `.env.example` 파일을 `.env`로 복사하고 필요한 값을 수정합니다.
    ```bash
    cp .env.example .env
    ```
    - `ADMIN_PASSWORD`: 관리자 패널 접속 및 API 호출에 사용될 비밀번호 (필수)
    - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`: 각 서비스의 API 키 (필요한 것만 입력)

3.  **실행**
    ```bash
    docker-compose up -d
    ```

4.  **외부 공유 링크 확인 (자동 터널 기능)**
    Bouncer는 실행 시 번거로운 네트워크 설정 없이 외부에서 접속할 수 있도록 **자동으로 클라우드플레어 임시 터널(Quick Tunnel)을 생성**합니다.
    다음 명령어로 로그를 확인하여 발급된 URL을 찾으세요:
    ```bash
    docker-compose logs tunnel | grep "trycloudflare.com"
    ```
    - 출력된 `https://...trycloudflare.com` 링크를 복사하여 커뮤니티에 공유하시기 바랍니다. 해당 URL 뒤에 `/v1/chat/completions`를 붙여 AI 클라이언트 API 주소로 사용할 수 있습니다.

### ✨ 접속 엔드포인트
-   **대시보드 관리자 패널**: `http://localhost:3000` 또는 터널 URL
-   **프록시 엔드포인트**: `https://발급된-터널-주소.trycloudflare.com/v1/chat/completions` (OpenAI 형식 호환)

---

## 🌐 장기 운영을 위한 배포 가이드 (필독)

기본 스크립트 도구나 Docker에 포함된 **Cloudflare 임시 터널(`trycloudflare.com`)은 몇 시간~며칠 단위의 단기 테스트 용도로만 적합**합니다. 재부팅이나 인터넷 끊김 시 주소가 무작위로 변경되어 유저들이 매우 불편해할 수 있습니다. 

방해 없이 24시간 계속 운영하시려면 다음 방법 중 하나로 **영구 배포(Hosting)**를 구성하시길 강력히 권장합니다.

1. **개인 도메인 + Cloudflare Zero Trust (가장 추천)**
   - 개인 컴퓨터(집 컴퓨터)를 계속 켜둘 수 있다면, 저렴한 도메인을 하나 구입하여 Cloudflare Zero Trust(무료)에 연결하세요.
   - 공유기 포트포워딩 없이도 디도스 방어가 적용된 **고정 HTTPS 주소(`https://ai.your-domain.com`)**를 평생 무료로 유지할 수 있습니다.
2. **저가형 VPS 임대 + Nginx 또는 Caddy**
   - 오라클 클라우드(무료), Vultr, Hetzner 등의 가상 서버(VPS)를 월 5천원~1만원대에 대여하여 24시간 가동합니다.
   - Nginx Proxy Manager나 Caddy를 띄워 자동으로 HTTPS를 연동하는 정석적인 클라우드 배포 방식입니다.
3. **홈 서버 + 포트포워딩 & DDNS**
   - 24시간 가동되는 NAS나 개인 서버가 있다면, 공유기에서 80/443 포트를 개방(포트포워딩)하고 DuckDNS나 IPTIME DDNS 등으로 고정 주소를 발급받아 사용합니다.

## ⚙️ 설정 (Configuration)

### `models.json`
제공할 모델 목록과 과금 정책을 설정합니다. `models.json` 파일을 수정하여 새로운 모델을 추가하거나 가격을 조정할 수 있습니다. 수정한 후 관리자 패널의 **[Reload Models]** 버튼을 누르면 서버 재시작 없이 즉시 반영됩니다.

### 환경 변수
`.env` 파일에서 다음과 같은 중요한 설정을 조정할 수 있습니다:
-   `USER_QUOTA`: 신규 유저에게 지급될 기본 크레딧 양
-   `GLOBAL_QUOTA`: 서버 전체에서 사용할 수 있는 일일/월간 최대 크레딧
-   `ALLOW_HALF_NICK`: 반고닉(유동 닉네임) 허용 여부

## 🛠️ 관리자 기능
`/api/admin/*` 엔드포인트는 `Authorization: Admin <ADMIN_PASSWORD>` 헤더를 통해 보호됩니다.
기본 제공되는 관리자 탭을 통해 다음과 같은 작업을 수행할 수 있습니다:
-   인증용 게시글 URL 동적 변경
-   유저 검색 및 부정 사용자 영구 정지
-   `models.json` 실시간 리로드

## ⚖️ 라이선스
이 프로젝트는 커뮤니티 배포 및 개인 학습용으로 제작되었습니다.
