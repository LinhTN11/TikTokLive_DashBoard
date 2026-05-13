import path from 'node:path';
import express from 'express';
import next from 'next';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { LiveManager } from './src/server/live-manager';

async function main() {
  const appDir = __dirname;
  const rootDir = path.resolve(appDir, '../..');
  const dev = process.env.NODE_ENV !== 'production';
  const port = Number(process.env.PORT || 3000);

  const nextApp = next({ dev, dir: appDir });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  const app = express();
  app.use(express.static(path.join(rootDir, 'public'), { index: false, maxAge: dev ? 0 : '30d' }));
  app.use('/legacy', express.static(path.join(rootDir, 'public'), { maxAge: dev ? 0 : '30d' }));

  app.use((req, res) => handle(req, res));

  const httpServer = createServer(app);

  const io = new Server(httpServer, {
    cors: {
      origin: true,
    },
  });
  const liveManager = new LiveManager(io);

  io.on('connection', (socket) => {
    socket.emit('live:state', liveManager.getState());

    socket.on('live:start', async (payload: { uniqueId?: string }, ack?: (response: unknown) => void) => {
      try {
        await liveManager.start(payload.uniqueId || '');
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on('live:stop', async (payload: { uniqueId?: string } = {}, ack?: (response: unknown) => void) => {
      try {
        await liveManager.stop(payload.uniqueId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on('test:gift', async (payload = {}, ack?: (response: unknown) => void) => {
      try {
        await liveManager.testGift(payload);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on('test:chat', async (payload = {}, ack?: (response: unknown) => void) => {
      try {
        await liveManager.testChat(payload);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on('test:follow', async (payload: { channelUniqueId?: string } = {}, ack?: (response: unknown) => void) => {
      try {
        await liveManager.testFollow(payload);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on('session:reset', async (payload: { uniqueId?: string } = {}, ack?: (response: unknown) => void) => {
      try {
        await liveManager.resetSessionCounters(payload.uniqueId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on('settings:update', async (payload: { rules?: Parameters<LiveManager['updateSettings']>[0] } = {}, ack?: (response: unknown) => void) => {
      try {
        await liveManager.updateSettings(payload.rules || []);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  httpServer.listen(port, () => {
    console.log(`Live overlay server running at http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
