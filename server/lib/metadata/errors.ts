import logger from '@server/logger';
import type { NextFunction } from 'express';
import { InvalidMbidError } from './index';

/**
 * Turn a metadata failure into the `{status, message}` error the API returns.
 * Copy says what happened and what to do next.
 */
export const metadataError = (
  e: unknown,
  next: NextFunction,
  what: 'artist' | 'album' | 'track' | 'search'
): void => {
  const err = e as {
    message?: string;
    response?: { status?: number };
    code?: string;
  };
  if (e instanceof InvalidMbidError) {
    return next({ status: 400, message: err.message });
  }
  const status = err.response?.status;
  if (status === 404 || status === 400) {
    return next({
      status: 404,
      message:
        what === 'search'
          ? 'MusicBrainz could not run that search. Try different words.'
          : `MusicBrainz has no ${what} with that ID. Check the link and try again.`,
    });
  }
  logger.error('Metadata lookup failed', {
    label: 'Metadata',
    what,
    status,
    errorMessage: err.message,
  });
  if (status === 503 || status === 429) {
    return next({
      status: 503,
      message:
        'MusicBrainz is busy right now. Wait a few seconds and try again.',
    });
  }
  return next({
    status: 502,
    message:
      'MusicBrainz could not be reached. Check the server URL in Settings → MusicBrainz and Last.fm, then try again.',
  });
};
