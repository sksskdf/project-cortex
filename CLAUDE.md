# CLAUDE.md

이 파일의 지침은 기본 동작보다 우선한다.

## 워크플로

- **작업이 끝나면 사용자가 따로 요청하지 않아도 항상 PR 을 생성한다.** 커밋만 하고
  끝내지 말 것. 작업 완료 = 커밋 + 푸시 + PR 생성까지.
- **PR 생성 전에 `typecheck` · `prettier` · 전체 테스트(`npm test`)를 돌려 실패를 모두
  수정한 뒤 PR 을 만든다.** (PR 생성 후 CI 실패가 잦아 추가된 지침.)
- 별도 지시가 없으면 진행 중인 관련 작업은 같은 PR 로 묶는다.
- 큰 구조 변경(예: Anthropic API 경로 전면 제거)은 별도 PR 로 분리한다.

## 로컬 검증 환경

- `typecheck` (`tsc --noEmit`) · `prettier` · `test` (`vitest`) 모두 로컬 실행 가능.
  `better-sqlite3` 등 네이티브 모듈도 로컬에서 정상 동작한다.
- 단, Windows 에서 npm optional-deps 버그로 `@rollup/rollup-win32-x64-msvc` 와 vite 가
  쓰는 `esbuild` 플랫폼 바이너리가 누락되면 vitest 가 안 뜬다. lockfile 변경 없이 복구:
  `npm install --no-save @rollup/rollup-win32-x64-msvc @esbuild/win32-x64@<vite esbuild 버전>`
