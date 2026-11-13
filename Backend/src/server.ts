import { createServer } from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { gameManager } from './modules/games/game.manager';
import { onGameSettled } from './modules/tournaments/tournaments.service';
import { startScheduler } from './services/scheduler';
import { createSocketServer } from './sockets';

async function main() {
  await prisma.$connect();
  const http = createServer(createApp());
  createSocketServer(http);
  gameManager.onFinished(onGameSettled);

  const resumed = await gameManager.resumeAll();
  const stopScheduler = startScheduler();

  http.listen(env.PORT, () => {
    console.log(`PlayerX Ludo API listening on :${env.PORT} (${env.NODE_ENV}, auth=${env.AUTH_PROVIDER}, resumed games=${resumed})`);
  });

  const shutdown = async () => {
    stopScheduler();
    http.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('Fatal startup error', e);
  process.exit(1);
});
