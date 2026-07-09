# TRINITY AI AGENCY — 픽셀 오피스

지시를 내리면 AI 직원이 채용되어 일하는 픽셀 오피스 AI 에이전시.

- **라이브**: https://hq1trinity-arch.github.io/pixel-agency/
- 지시 입력 → 매니저가 직무 분석 → 직원 자동 채용 → 작업 → 사장 결재(승인/반려 재작업)
- 외부 라이브러리 없는 단일 HTML (Canvas + Vanilla JS)

## 직원들을 진짜 AI로 돌리는 두 가지 방법

### 방법 1 — 로컬 Claude Code 브리지 (💰 추가 과금 없음, 구독으로 작동)

Claude Pro/Max 구독이 있다면 API 키 없이 내 PC의 Claude Code로 직원들을 돌릴 수 있습니다.

1. [Claude Code](https://claude.com/claude-code) 설치 후 구독 계정으로 로그인
2. [Node.js](https://nodejs.org) 설치 (LTS)
3. 이 리포에서 `bridge/claude-bridge.mjs` 파일을 내려받기 (또는 리포 전체 클론)
4. 터미널에서 실행:
   ```
   node bridge/claude-bridge.mjs
   ```
5. 픽셀 오피스 접속 → **⚙ API 연결** → "로컬 Claude Code 브리지 주소"에
   `http://127.0.0.1:8787` 입력 → 연결 테스트 → 저장

브리지가 켜져 있는 동안 직원들의 작업이 내 PC의 Claude Code(구독)로 처리됩니다.
브리지는 127.0.0.1(내 PC)에만 열리며, 허용된 페이지 외의 요청은 거부합니다.

### 방법 2 — Anthropic API 키 (종량 과금)

1. [console.anthropic.com](https://console.anthropic.com) 에서 API 키 발급 (크레딧 충전 필요)
2. **⚙ API 연결**에 키 입력 → 저장

키는 브라우저 localStorage에만 저장되며 api.anthropic.com 외에는 전송되지 않습니다.

두 가지 모두 없으면 시뮬레이션 모드(가짜 결과물)로 동작합니다.
브리지 주소와 API 키가 둘 다 있으면 브리지가 우선합니다.
