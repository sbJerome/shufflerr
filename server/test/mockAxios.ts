import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import axios, { AxiosError } from 'axios';

/**
 * Canned HTTP for API-client tests, installed as the default axios adapter.
 *
 * server/test/setup.ts refuses every outbound socket, and nock 14 still opens
 * one through http.request before answering, so the two cannot be combined.
 * Swapping the adapter answers before any socket exists. Install it at the top
 * of the test file, before the client under test is constructed (axios
 * instances copy the default adapter when they are created).
 *
 *   const http = installHttpMock();
 *   beforeEach(() => http.reset());
 *   http.get('https://api.deezer.com/album/1', () => [200, fixture]);
 */
export interface MockRequest {
  method: string;
  /** Full URL including the query string. */
  url: URL;
  params: URLSearchParams;
  /** Parsed JSON body, URLSearchParams for form posts, or the raw value. */
  body: unknown;
  headers: Record<string, string>;
}

export type MockReply = [
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
];
type Handler = (request: MockRequest) => MockReply | Promise<MockReply>;

interface Route {
  method: string;
  match: string | RegExp;
  handler: Handler;
}

const parseBody = (config: InternalAxiosRequestConfig): unknown => {
  const { data } = config;
  if (typeof data !== 'string') {
    return data;
  }
  const type = String(config.headers?.['Content-Type'] ?? '');
  if (type.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(data);
  }
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

export class HttpMock {
  private routes: Route[] = [];
  /** Every request seen since the last reset, in order. */
  public calls: MockRequest[] = [];

  public reset(): void {
    this.routes = [];
    this.calls = [];
  }

  public on(method: string, match: string | RegExp, handler: Handler): this {
    this.routes.push({ method: method.toUpperCase(), match, handler });
    return this;
  }

  public get(match: string | RegExp, handler: Handler): this {
    return this.on('GET', match, handler);
  }

  public post(match: string | RegExp, handler: Handler): this {
    return this.on('POST', match, handler);
  }

  /** Requests to URLs matching the pattern (path without query for strings). */
  public callsTo(match: string | RegExp): MockRequest[] {
    return this.calls.filter((c) => this.matches(match, c.url));
  }

  private matches(match: string | RegExp, url: URL): boolean {
    const bare = `${url.origin}${url.pathname}`;
    return typeof match === 'string' ? bare === match : match.test(url.href);
  }

  public adapter = async (
    config: InternalAxiosRequestConfig
  ): Promise<AxiosResponse> => {
    const url = new URL(axios.getUri(config));
    const request: MockRequest = {
      method: (config.method ?? 'get').toUpperCase(),
      url,
      params: url.searchParams,
      body: parseBody(config),
      headers: Object.fromEntries(
        Object.entries(config.headers?.toJSON?.() ?? {}).map(([k, v]) => [
          k.toLowerCase(),
          String(v),
        ])
      ),
    };
    this.calls.push(request);

    // later registrations win, so a test can override a default route
    const route = [...this.routes]
      .reverse()
      .find((r) => r.method === request.method && this.matches(r.match, url));
    if (!route) {
      throw new AxiosError(
        `No mock for ${request.method} ${url.href}`,
        'ERR_NETWORK',
        config
      );
    }

    const [status, data, headers] = await route.handler(request);
    const response: AxiosResponse = {
      data,
      status,
      statusText: String(status),
      headers: headers ?? {},
      config,
      request: { res: { responseUrl: url.href } },
    };
    const ok = config.validateStatus
      ? config.validateStatus(status)
      : status >= 200 && status < 300;
    if (!ok) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
        config,
        response.request,
        response
      );
    }
    return response;
  };
}

/** Route every axios call in this process to a HttpMock. */
export const installHttpMock = (): HttpMock => {
  const mock = new HttpMock();
  axios.defaults.adapter = mock.adapter;
  return mock;
};
