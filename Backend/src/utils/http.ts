import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors';

/** Wraps an async route so rejections reach the error middleware. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Validates input with zod and returns the typed value, or throws a 400. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first.path.length ? `${first.path.join('.')}: ` : '';
    throw badRequest('VALIDATION_ERROR', `${where}${first.message}`, r.error.flatten());
  }
  return r.data;
}

export function pageParams(q: Record<string, unknown>, max = 100) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(max, Math.max(1, Number(q.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
