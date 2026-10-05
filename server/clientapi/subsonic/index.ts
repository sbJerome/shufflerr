// OpenSubsonic API, mounted at /rest (docs/CLIENT_API.md).
// Mounted outside /api/v1: no session, no CSRF, no OpenAPI validation. Auth is
// username + app password (`p` / `t`+`s`) or the `apiKey` extension.
import type { ClientIdentity } from '@server/clientapi/common/credentials';
import {
  noteClientUse,
  signInWithApiKey,
  signInWithPassword,
  signInWithToken,
} from '@server/clientapi/common/credentials';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { Request, Response } from 'express';
import express, { Router } from 'express';
import { PUBLIC_METHODS, handlersByName } from './handlers';
import { Params } from './params';
import {
  SubsonicError,
  SubsonicErrorCode,
  sendError,
  sendOk,
} from './response';

const router = Router();

router.use(express.urlencoded({ extended: false, limit: '2mb' }));

router.use((_req, res, next) => {
  if (!getSettings().clients.openSubsonic) {
    return res
      .status(404)
      .json({ message: 'The OpenSubsonic API is turned off.' });
  }
  next();
});

const decodePassword = (raw: string): string =>
  raw.startsWith('enc:')
    ? Buffer.from(raw.slice(4), 'hex').toString('utf8')
    : raw;

const authenticate = async (params: Params): Promise<ClientIdentity> => {
  const username = params.str('u');
  const apiKey = params.str('apiKey');

  if (apiKey) {
    if (username || params.has('p') || params.has('t')) {
      throw new SubsonicError(
        SubsonicErrorCode.CONFLICTING_AUTH,
        'Send either an API key or a username and password, not both.'
      );
    }
    const identity = await signInWithApiKey(apiKey);
    if (!identity) {
      throw new SubsonicError(
        SubsonicErrorCode.INVALID_API_KEY,
        'That API key is not a valid app password.'
      );
    }
    return identity;
  }

  if (!username) {
    throw new SubsonicError(
      SubsonicErrorCode.MISSING_PARAMETER,
      'Required parameter is missing: u'
    );
  }

  const wrong = new SubsonicError(
    SubsonicErrorCode.WRONG_CREDENTIALS,
    'Wrong username or password. Use an app password from your Shufflerr profile.'
  );

  if (params.has('t') || params.has('s')) {
    const identity = await signInWithToken(
      username,
      params.required('t'),
      params.required('s')
    );
    if (identity === 'unavailable') {
      throw new SubsonicError(
        SubsonicErrorCode.TOKEN_AUTH_UNSUPPORTED,
        'Token sign-in is not available for this account. Create a new app password.'
      );
    }
    if (!identity) {
      throw wrong;
    }
    return identity;
  }

  const identity = await signInWithPassword(
    username,
    decodePassword(params.required('p'))
  );
  if (!identity) {
    throw wrong;
  }
  return identity;
};

const dispatch = async (
  req: Request,
  res: Response,
  method: string
): Promise<void> => {
  try {
    const handler = handlersByName.get(method.toLowerCase());
    const params = new Params(req);

    if (handler && PUBLIC_METHODS.has(method.toLowerCase())) {
      const payload = await handler({
        req,
        res,
        params,
        // Public endpoints never touch the user.
        user: undefined as never,
        identity: undefined as never,
        client: params.str('c') ?? 'unknown',
      });
      return sendOk(req, res, payload ?? {});
    }

    const identity = await authenticate(params);
    const client = params.str('c')?.slice(0, 120) || 'Music app';
    noteClientUse(identity, client);

    if (!handler) {
      throw new SubsonicError(
        SubsonicErrorCode.GENERIC,
        `Shufflerr does not support the "${method}" call.`
      );
    }

    const payload = await handler({
      req,
      res,
      params,
      user: identity.user,
      identity,
      client,
    });
    if (payload !== null && !res.headersSent) {
      sendOk(req, res, payload ?? {});
    }
  } catch (e) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (e instanceof SubsonicError) {
      return sendError(req, res, e.code, e.message);
    }
    logger.error('OpenSubsonic request failed', {
      label: 'Client API',
      method,
      errorMessage: e.message,
    });
    sendError(
      req,
      res,
      SubsonicErrorCode.GENERIC,
      'Shufflerr could not complete that request.'
    );
  }
};

// /rest/ping, /rest/ping.view — GET or POST (formPost extension).
router.all(/^\/([A-Za-z0-9]+)(?:\.view)?\/?$/, (req, res) => {
  const method = (req.params as unknown as string[])[0];
  return dispatch(req, res, method);
});

router.use((req, res) => {
  sendError(
    req,
    res,
    SubsonicErrorCode.GENERIC,
    'Unknown OpenSubsonic endpoint.'
  );
});

export default router;
