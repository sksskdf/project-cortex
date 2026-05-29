# 웹훅 전달 / Cloudflare 제거 검토 (Phase 19)

사용자 질문(2026-05-29): "클라우드플레어 로컬 터널링으로 웹훅 받는데 게스트라 URL 이 계속
달라진다. 왠만하면 클라우드플레어 빼고 싶은데, 깃헙 앱으로 해결할 방법이 있는지 검토."

## 핵심 결론

**웹훅(GitHub→내 서버)은 본질적으로 인바운드 HTTP 라, 어떤 방식이든 "공개 도달 주소"가
필요하다.** GitHub App 으로 바꾼다고 웹훅 수신 자체의 공개 엔드포인트 요구가 사라지지 않는다.
즉 "GitHub App + 웹훅" 조합으로는 터널을 못 없앤다.

**하지만 웹훅을 폴링(polling)으로 대체하면 공개 엔드포인트가 아예 필요 없어진다** — 이게
사용자가 찾던 "Cloudflare 제거" 답이다. Cortex 가 GitHub App 설치 토큰으로 주기적으로 GitHub
API 를 당겨오면(아웃바운드만), 인바운드 터널 0.

## 옵션 비교

### A) 폴링 모드 (터널 완전 제거) ★ 추천

GitHub App 설치 토큰으로 관리 중인 레포의 PR/체크 상태를 주기적으로 조회 → 기존 `sync` 흐름
재사용. 인바운드 엔드포인트 불필요 → Cloudflare/터널 제거.

- **레이트 한도**: 설치 토큰은 5,000 req/hr(비-EGC 기준, 레포·유저 수에 따라 가산). 단일 사용자가
  6개 레포를 1분마다 폴링해도 시간당 수백 건 수준 — 여유 충분.
- **조건부 요청(ETag)**: `If-None-Match` 로 보내 변경 없으면 **304 응답은 주(primary) 레이트
  한도에 차감되지 않는다**(GitHub 문서). 변경 없을 땐 사실상 공짜 → 폴링 비용 최소화.
- **단점**: 근실시간이 아님 — 폴링 주기(예: 30~60초)만큼 지연. 단일 사용자 dev 툴엔 충분.
- **구현 스케치**:
  - 스케줄러(서버 `setInterval` 또는 작업 큐)가 N초마다 관리 레포별 `syncProject` 호출.
  - 레포·엔드포인트별 ETag 캐시 저장(메모리 or 작은 테이블) → 조건부 요청.
  - 설정에 "수신 모드: 웹훅 | 폴링" 토글 + 폴링 주기. 폴링 모드면 webhook 라우트 무시.
  - 백오프: 레이트/에러 시 주기 자동 연장.

### B) 고정 URL 터널 (웹훅 유지, URL 가변성만 해결)

게스트 quick-tunnel 의 랜덤 URL 문제만 푼다 — 터널 자체는 유지.

- **Named Cloudflare Tunnel**: 본인 도메인 + `cloudflared` named tunnel → 고정 hostname. 무료.
  GitHub App webhook URL 을 한 번만 등록하면 끝.
- 대안 터널: ngrok 예약 도메인(유료), Tailscale Funnel(고정 호스트) 등.
- **장점**: 근실시간 웹훅 유지. **단점**: 도메인/설정 필요, Cloudflare 의존은 (A 와 달리) 유지.

### C) 하이브리드

웹훅(있으면) + 주기적 폴링 안전망(조건부 요청). 웹훅 누락/터널 다운 시 폴링이 메움. 가장
견고하나 둘 다 운영해야 함.

## 권고

- **Cloudflare 를 빼는 게 1순위 목표라면 → 옵션 A(폴링 모드).** GitHub App 토큰은 이미 있으므로
  (github-apps), 스케줄러 + ETag 조건부 요청만 추가하면 된다. webhook 인프라(`sync.ts`)는 그대로
  재사용 — 폴링은 "주기적으로 sync 를 호출"하는 얇은 레이어.
- **근실시간이 꼭 필요하면 → 옵션 B(named tunnel)** 로 URL 가변성만 해소(Cloudflare 유지).
- 단일 사용자 localhost 자동화 도구 성격상 **A 가 가장 잘 맞는다**(지연 수십 초 허용, 운영 단순,
  외부 노출 0 → Phase 19 인증 부담도 줄어듦).

## 사용자 결정 필요

1. 수신 모드: **폴링(A, Cloudflare 제거)** vs **고정 터널(B)** vs **하이브리드(C)**.
2. (A 선택 시) 폴링 주기 기본값(예: 60초)과 폴링 대상(관리 중·뮤트 아님 레포만).

결정되면 옵션 A 는 자율 구현 가능(스케줄러 + ETag 캐시 + 설정 토글). 별도 PR.

## 참고

- [Rate limits for the REST API - GitHub Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Best practices for creating a GitHub App - GitHub Docs](https://docs.github.com/en/enterprise-server@3.16/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
- [Best practices for handling rate limits when using the REST API for frequent polling (community #156480)](https://github.com/orgs/community/discussions/156480)
