import { Router } from 'express';
import { z } from 'zod';
import { h, parse } from '../../utils/http';
import { setFirstTurn, joinPrizePool, listPrizePools, createRoom, getActiveContext, getRoomView, joinRoom, leaveRoom, listPublicRooms, quickMatch, setReady, startRoom } from './rooms.service';

export const roomsRouter = Router();

const spec = {
  modeKey: z.string().min(1).max(40),
  maxPlayers: z.number().int().min(2).max(4),
  entryPoints: z.number().int().min(0).max(1_000_000),
};
const createSchema = z.object({
  ...spec,
  name: z.string().trim().min(3, 'Room name needs at least 3 characters').max(30),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PRIVATE'),
});
const code = z.string().trim().min(4).max(10);

roomsRouter.get('/public', h(async (_req, res) => res.json({ items: await listPublicRooms() })));
roomsRouter.get('/pools', h(async (_req, res) => res.json({ items: await listPrizePools() })));
roomsRouter.post('/pools/:id/join', h(async (req, res) => res.json(await joinPrizePool(req.user!.id, req.params.id))));
roomsRouter.get('/active', h(async (req, res) => res.json(await getActiveContext(req.user!.id))));
roomsRouter.post('/', h(async (req, res) => res.status(201).json(await createRoom(req.user!.id, parse(createSchema, req.body)))));
roomsRouter.post('/quick-match', h(async (req, res) => res.json(await quickMatch(req.user!.id, parse(z.object(spec), req.body)))));
roomsRouter.post('/join', h(async (req, res) => res.json(await joinRoom(req.user!.id, parse(z.object({ code }), req.body).code))));
roomsRouter.get('/:code', h(async (req, res) => res.json(await getRoomView(parse(code, req.params.code)))));
roomsRouter.post('/:code/ready', h(async (req, res) => {
  const { ready } = parse(z.object({ ready: z.boolean() }), req.body);
  res.json(await setReady(req.user!.id, req.params.code, ready));
}));
roomsRouter.post('/:code/first-turn', h(async (req, res) => {
  const { userId } = parse(z.object({ userId: z.string().max(40).nullable() }), req.body);
  res.json(await setFirstTurn(req.params.code, userId, 'HOST', req.user!.id));
}));
roomsRouter.post('/:code/start', h(async (req, res) => res.json({ gameId: await startRoom(req.user!.id, req.params.code) })));
roomsRouter.post('/:code/leave', h(async (req, res) => {
  await leaveRoom(req.user!.id, req.params.code);
  res.json({ ok: true });
}));
