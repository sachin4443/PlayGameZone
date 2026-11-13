import { Router } from 'express';
import { h } from '../../utils/http';
import { getTournament, listTournaments, registerForTournament, unregisterFromTournament } from './tournaments.service';

export const tournamentsRouter = Router();

tournamentsRouter.get('/', h(async (_req, res) => res.json({ items: await listTournaments() })));
tournamentsRouter.get('/:id', h(async (req, res) => res.json(await getTournament(req.params.id, req.user!.id))));
tournamentsRouter.post('/:id/register', h(async (req, res) => {
  await registerForTournament(req.user!.id, req.params.id);
  res.json(await getTournament(req.params.id, req.user!.id));
}));
tournamentsRouter.post('/:id/unregister', h(async (req, res) => {
  await unregisterFromTournament(req.user!.id, req.params.id);
  res.json(await getTournament(req.params.id, req.user!.id));
}));
