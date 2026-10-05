import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { AxiosError } from 'axios';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(__dirname, 'fixtures');

/** A recorded response from server/test/fixtures. */
export const fixture = <T = unknown>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;

export const ok = <T>(
  config: InternalAxiosRequestConfig,
  data: T
): AxiosResponse<T> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
  request: {},
});

export const httpError = (
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown = {}
): AxiosError =>
  new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_RESPONSE',
    config,
    {},
    { data, status, statusText: String(status), headers: {}, config }
  );

export interface RecordedCall {
  url: string;
  method: string;
  params: Record<string, unknown>;
  headers: Record<string, unknown>;
  data: unknown;
}

/**
 * An axios adapter that answers from fixtures instead of the network and
 * records what was asked. `route` returns the response body, or throws.
 */
export const fixtureAdapter = (
  route: (call: RecordedCall, config: InternalAxiosRequestConfig) => unknown
): { adapter: AxiosAdapter; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  const adapter: AxiosAdapter = async (config) => {
    const call: RecordedCall = {
      url: config.url ?? '',
      method: (config.method ?? 'get').toLowerCase(),
      params: { ...(config.params ?? {}) },
      headers: { ...(config.headers?.toJSON?.() ?? {}) },
      data: config.data,
    };
    calls.push(call);
    return ok(config, route(call, config));
  };
  return { adapter, calls };
};
