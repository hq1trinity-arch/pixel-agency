# TRINITY AI AGENCY — 픽셀 오피스

지시를 내리면 AI 직원이 채용되어 일하는 픽셀 오피스 AI 에이전시 데모.

- **라이브**: https://hq1trinity-arch.github.io/pixel-agency/
- 지시 입력 → 매니저가 직무 분석 → 직원 자동 채용 → 작업 → 사장 결재(승인/반려 재작업)
- ⚙ API 연결에서 본인의 Anthropic API 키를 등록하면 실제 Claude API로 결과물 생성
- 키가 없으면 시뮬레이션 모드로 동작

외부 라이브러리 없는 단일 HTML 파일 (Canvas + Vanilla JS).
API 키는 브라우저 localStorage에만 저장되며 api.anthropic.com 외에는 전송되지 않습니다.
