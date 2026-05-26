// Phase 13 — 커스텀 Next 서버. App Router route handler 는 WebSocket upgrade 를 못 하므로
// 터미널 PTY 스트리밍(/api/pty)을 위해 Next 와 ws 를 한 프로세스에서 띄웁니다.
// 일반 HTTP 는 Next 가, /api/pty WebSocket 은 pty 매니저가 처리하고, 그 외 upgrade(HMR 등)는
// Next upgrade 핸들러로 위임합니다. dev/start 모두 이 서버를 통해 실행됩니다 (package.json).

import { createServer } from 'node:http';
import next from 'next';
import { handlePtyUpgrade } from '@/server/pty';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? 'localhost';

const app = next({ dev, hostname, port });

app.prepare().then(() => {
  // getUpgradeHandler 는 prepare() 이후에만 호출 가능 (Next 내부 init 필요).
  const handle = app.getRequestHandler();
  const upgradeNext = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    handle(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    if (handlePtyUpgrade(req, socket, head)) return;
    upgradeNext(req, socket, head);
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Cortex ready on http://${hostname}:${port}`);
  });
});
