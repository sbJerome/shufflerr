import type { RequestHandler } from 'express';

/**
 * Placeholder handler for routes whose owning stream has not implemented them
 * yet. Search the code base for `notImplemented(` to find what is left;
 * delete this file when nothing uses it.
 */
export const notImplemented =
  (stream: string): RequestHandler =>
  (_req, res) => {
    res.status(501).json({ message: 'Not implemented', stream });
  };
