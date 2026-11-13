import { sweepExpiredRooms } from '../modules/rooms/rooms.service';
import { startDueTournaments } from '../modules/tournaments/tournaments.service';

/** Background housekeeping: matchmaking / lobby timeouts and tournament start times. */
export function startScheduler(intervalMs = 5_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweepExpiredRooms();
      await startDueTournaments();
    } catch (e) {
      console.error('[scheduler]', e);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
