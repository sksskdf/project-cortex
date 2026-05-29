# dev 서버 속도 진단 (Phase 9 후속)

사용자 시그널(2026-05-29): "phase-9 테스트 못 해봤고 dev 서버라 그런지 조금 느린데 어떤 fix가
있을까."

## 진단

`npm run dev` = `tsx server.ts` → 커스텀 Next 서버(`next({ dev })`, server.ts). 즉:

1. **커스텀 서버는 Turbopack 이 아니라 webpack 으로 dev 컴파일한다.** Next 15 의 빠른 dev 는
   `next dev --turbopack`(CLI) 에서 오는데, PTY WebSocket 때문에 커스텀 서버(`next()` 프로그래매틱
   API)를 쓰고 있어 webpack 경로다. 초기 컴파일·HMR 이 Turbopack 대비 느린 주원인일 가능성 큼.
2. better-sqlite3·node-pty 네이티브 모듈 + 모듈 로드 시 마이그레이션은 **서버 부팅** 비용이지
   HMR 비용은 아니다(페이지 편집 반응 속도와는 별개).
3. `reactStrictMode` 의 dev 이중 렌더는 체감 가능하나 정상 동작 검증용.

## 시도해볼 옵션 (사용자 머신에서 측정 필요 — 이 환경엔 dev 실행 불가)

- **A. 커스텀 서버 + Turbopack 지원 여부 확인**: 설치된 Next 15.x 에서 `next({ dev, turbopack: true })`
  (또는 `turbo: true`) 가 지원되면 적용. 버전에 따라 미지원/경고일 수 있으니 **먼저 확인**.
  미지원이면 B/C 로.
- **B. dev 와 PTY 분리(가장 확실)**: UI 개발 중엔 표준 `next dev --turbopack`(Turbopack) 로 띄우고,
  PTY/WebSocket 기능 테스트가 필요할 때만 커스텀 서버로. package.json 에 `dev:next`(turbopack,
  PTY 없음) + `dev:full`(현재 커스텀 서버) 두 스크립트. 일상 UI 작업은 Turbopack 의 빠른 HMR.
- **C. 측정 후 판단**: `next dev` 의 컴파일 로그(라우트별 compiled in Xms)로 병목 라우트 확인.
  `/reports`(Recharts 117kB) 등 무거운 라우트가 첫 컴파일을 끌면 lazy import 로 분리.
- **D. 부팅 비용 절감**: dev 에서 매번 마이그레이션 실행을 스킵 옵션(이미 최신이면 빠르게 통과)
  — 부팅만 빨라지고 HMR 엔 영향 없음. 우선순위 낮음.

## 권고

- 일상 UI 개발 속도가 목적이면 **B(스크립트 분리)** 가 가장 확실·저위험. Turbopack HMR 을
  대부분의 작업에서 누리고, PTY 가 필요할 때만 커스텀 서버.
- A 는 한 줄로 끝나지만 커스텀 서버 Turbopack 지원이 버전 의존 → 먼저 확인.
- 별도 측정·검증이 필요해 **블라인드 코드 변경 대신 위 옵션을 제시**. 방향 정해지면 스크립트
  추가는 자율 구현 가능.

## Phase 9 패키징 테스트 (병행 메모)

dev 서버(hot-reload)로 돌려서 NSSM/launchd 서비스 패키징을 실검증 못 한 상태. 검증은
`npm run build` → `NODE_ENV=production tsx server.ts`(현재 start) 또는 서비스 등록 스크립트
경로로 해야 하며, **프로덕션 빌드 산출물 기준 + 실제 OS 서비스 등록**이 필요해 사용자 머신에서
진행. dev 와 분리(B)하면 패키징 테스트도 깔끔해진다.
