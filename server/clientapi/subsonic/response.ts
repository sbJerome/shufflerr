import { getAppVersion } from '@server/utils/appVersion';
import type { Request, Response } from 'express';

export const SUBSONIC_API_VERSION = '1.16.1';

/** Subsonic error codes (plus the OpenSubsonic API-key ones). */
export enum SubsonicErrorCode {
  GENERIC = 0,
  MISSING_PARAMETER = 10,
  WRONG_CREDENTIALS = 40,
  TOKEN_AUTH_UNSUPPORTED = 41,
  AUTH_MECHANISM_UNSUPPORTED = 42,
  CONFLICTING_AUTH = 43,
  INVALID_API_KEY = 44,
  NOT_AUTHORIZED = 50,
  NOT_FOUND = 70,
}

export class SubsonicError extends Error {
  constructor(
    public code: SubsonicErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type Payload = Record<string, unknown>;

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

/**
 * The JSON shape is the source of truth; XML is derived from it the way the
 * Subsonic schema does: scalars become attributes, objects become child
 * elements, arrays repeat the element, and a `value` key is the text content.
 */
export const toXmlElement = (name: string, value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => toXmlElement(name, item)).join('');
  }
  if (isPrimitive(value)) {
    return `<${name}>${escapeXml(String(value))}</${name}>`;
  }

  let attributes = '';
  let children = '';
  let text = '';
  for (const [key, child] of Object.entries(value as Payload)) {
    if (child === undefined || child === null) {
      continue;
    }
    if (key === 'value' && isPrimitive(child)) {
      text = escapeXml(String(child));
    } else if (isPrimitive(child)) {
      attributes += ` ${key}="${escapeXml(String(child))}"`;
    } else {
      children += toXmlElement(key, child);
    }
  }

  return children || text
    ? `<${name}${attributes}>${text}${children}</${name}>`
    : `<${name}${attributes}/>`;
};

const envelope = (status: 'ok' | 'failed', payload: Payload): Payload => ({
  status,
  version: SUBSONIC_API_VERSION,
  type: 'shufflerr',
  serverVersion: getAppVersion(),
  openSubsonic: true,
  ...payload,
});

const formatOf = (req: Request): { format: string; callback?: string } => {
  const source = { ...(req.body ?? {}), ...req.query } as Record<
    string,
    unknown
  >;
  const pick = (key: string): string | undefined => {
    const value = source[key];
    return Array.isArray(value)
      ? String(value[0])
      : value === undefined
        ? undefined
        : String(value);
  };
  return {
    format: (pick('f') ?? 'xml').toLowerCase(),
    callback: pick('callback'),
  };
};

const send = (
  req: Request,
  res: Response,
  status: 'ok' | 'failed',
  payload: Payload
): void => {
  const body = envelope(status, payload);
  const { format, callback } = formatOf(req);

  // Subsonic reports errors inside the envelope with HTTP 200.
  res.status(200);
  if (format === 'json') {
    res.type('application/json').send({ 'subsonic-response': body });
  } else if (format === 'jsonp' && callback && /^[\w$.]+$/.test(callback)) {
    res
      .type('application/javascript')
      .send(`${callback}(${JSON.stringify({ 'subsonic-response': body })});`);
  } else {
    res.type('application/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        toXmlElement('subsonic-response', {
          xmlns: 'http://subsonic.org/restapi',
          ...body,
        })
    );
  }
};

export const sendOk = (
  req: Request,
  res: Response,
  payload: Payload = {}
): void => send(req, res, 'ok', payload);

export const sendError = (
  req: Request,
  res: Response,
  code: SubsonicErrorCode,
  message: string
): void => send(req, res, 'failed', { error: { code, message } });
