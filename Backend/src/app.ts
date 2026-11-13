import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { requireAuth, requirePlayer } from './middlewares/auth';
import { errorHandler, notFoundHandler } from './middlewares/error';
import { apiLimiter } from './middlewares/rateLimit';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { gamesRouter } from './modules/games/games.routes';
import { leaderboardRouter } from './modules/leaderboard/leaderboard.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { referralsRouter } from './modules/referrals/referrals.routes';
import { roomsRouter } from './modules/rooms/rooms.routes';
import { tournamentsRouter } from './modules/tournaments/tournaments.routes';
import { usersRouter } from './modules/users/users.routes';
import { walletRouter } from './modules/wallet/wallet.routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  // Auth is a bearer token in a header (never a cookie), so cross-site requests
  // cannot ride on a session; CORS still restricts which origins may call the API.
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);

  const player = [requireAuth, requirePlayer];
  app.use('/api/users', player, usersRouter);
  app.use('/api/wallet', player, walletRouter);
  app.use('/api/rooms', player, roomsRouter);
  app.use('/api/games', player, gamesRouter);
  app.use('/api/tournaments', player, tournamentsRouter);
  app.use('/api/leaderboard', player, leaderboardRouter);
  app.use('/api/referrals', player, referralsRouter);
  app.use('/api/notifications', player, notificationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
