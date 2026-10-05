// A tiny in-process Lidarr (API v1) for tests. It listens on loopback, which
// the test setup allows, and is seeded from recorded fixtures under
// server/test/fixtures/lidarr. Every request is recorded in `calls`.
import type { LidarrAlbum, LidarrArtist } from '@server/api/servarr/lidarr';
import type { LidarrSettings } from '@server/lib/settings';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const fixture = <T>(name: string): T =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures/lidarr', name), 'utf8')
  ) as T;

export const lidarrFixtures = {
  /** Lookup result for an artist Lidarr does not have (no id). */
  newArtist: () => fixture<LidarrArtist[]>('artist-lookup-new.json')[0],
  /** Lookup result for an album of that artist (no id). */
  newAlbum: () => fixture<LidarrAlbum[]>('album-lookup-new.json')[0],
  /** An artist Lidarr already manages. */
  existingArtist: () => fixture<LidarrArtist[]>('artist-existing.json')[0],
  existingAlbums: () => fixture<LidarrAlbum[]>('albums-existing.json'),
  queue: () =>
    fixture<{ totalRecords: number; records: Record<string, unknown>[] }>(
      'queue.json'
    ),
  systemStatus: () => fixture<Record<string, unknown>>('system-status.json'),
};

export interface FakeLidarrCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export class FakeLidarr {
  public static readonly API_KEY = 'test-lidarr-key';

  public artists: LidarrArtist[] = [];
  public albums: LidarrAlbum[] = [];
  /** What `artist/lookup` and `album/lookup` can find. */
  public lookupArtists: LidarrArtist[] = [];
  public lookupAlbums: LidarrAlbum[] = [];
  public queue: Record<string, unknown>[] = [];
  public calls: FakeLidarrCall[] = [];
  /** Albums that appear once their artist is added (Lidarr's async refresh). */
  public albumsOnArtistAdd: LidarrAlbum[] = [];
  /** Force every request to fail with this status. */
  public failWith?: number;

  private server?: http.Server;
  private nextId = 1000;

  public async start(): Promise<void> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) =>
      this.server?.listen(0, '127.0.0.1', resolve)
    );
  }

  public async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.closeAllConnections?.();
      this.server.close(() => resolve());
    });
  }

  public get port(): number {
    return (this.server?.address() as AddressInfo).port;
  }

  public reset(): void {
    this.artists = [];
    this.albums = [];
    this.lookupArtists = [];
    this.lookupAlbums = [];
    this.albumsOnArtistAdd = [];
    this.queue = [];
    this.calls = [];
    this.failWith = undefined;
  }

  /** Settings entry pointing at this server. */
  public settings(overrides: Partial<LidarrSettings> = {}): LidarrSettings {
    return {
      id: 0,
      name: 'lidarr-test',
      hostname: '127.0.0.1',
      port: this.port,
      apiKey: FakeLidarr.API_KEY,
      useSsl: false,
      baseUrl: '',
      isDefault: true,
      isHiRes: false,
      activeQualityProfileId: 2,
      activeQualityProfileName: 'Lossless',
      activeMetadataProfileId: 1,
      activeMetadataProfileName: 'Standard',
      activeDirectory: '/music',
      tags: [],
      syncEnabled: true,
      preventSearch: false,
      ...overrides,
    };
  }

  public callsTo(method: string, pathPrefix: string): FakeLidarrCall[] {
    return this.calls.filter(
      (c) => c.method === method && c.path.startsWith(pathPrefix)
    );
  }

  public commands(name: string): FakeLidarrCall[] {
    return this.callsTo('POST', '/command').filter(
      (c) => c.body?.name === name
    );
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const query = Object.fromEntries(url.searchParams.entries());
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : undefined;
      const route = url.pathname.replace(/^\/api\/v1/, '');
      const loggedQuery = { ...query };
      delete loggedQuery.apikey;

      this.calls.push({
        method: req.method ?? 'GET',
        path: route,
        query: loggedQuery,
        body,
      });

      const send = (status: number, data: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      if (!url.pathname.startsWith('/api/v1/')) {
        return send(404, { message: 'Not found' });
      }
      if (query.apikey !== FakeLidarr.API_KEY) {
        return send(401, { error: 'Unauthorized' });
      }
      if (this.failWith) {
        return send(this.failWith, { message: 'Lidarr is unhappy' });
      }

      try {
        send(200, this.route(req.method ?? 'GET', route, query, body));
      } catch (e) {
        send(e.status ?? 500, { message: e.message });
      }
    });
  }

  private route(
    method: string,
    route: string,
    query: Record<string, string>,
    body: any // eslint-disable-line @typescript-eslint/no-explicit-any
  ): unknown {
    const notFound = () =>
      Object.assign(new Error('NotFound'), { status: 404 });

    if (method === 'GET') {
      // Lidarr's routes are case-insensitive (ServarrBase asks for /qualityProfile).
      switch (route.toLowerCase()) {
        case '/system/status':
          return lidarrFixtures.systemStatus();
        case '/qualityprofile':
          return [
            { id: 1, name: 'Any' },
            { id: 2, name: 'Lossless' },
          ];
        case '/metadataprofile':
          return [
            { id: 1, name: 'Standard' },
            { id: 2, name: 'None' },
          ];
        case '/rootfolder':
          return [{ id: 1, path: '/music', freeSpace: 1, totalSpace: 2 }];
        case '/tag':
          return [];
        case '/artist':
          return query.mbId
            ? this.artists.filter((a) => a.foreignArtistId === query.mbId)
            : this.artists;
        case '/artist/lookup': {
          const mbid = (query.term ?? '').replace(/^lidarr:/, '');
          return [...this.artists, ...this.lookupArtists].filter(
            (a) => a.foreignArtistId === mbid
          );
        }
        case '/album':
          if (query.foreignAlbumId) {
            return this.albums.filter(
              (a) => a.foreignAlbumId === query.foreignAlbumId
            );
          }
          return this.albums.filter(
            (a) => !query.artistId || a.artistId === Number(query.artistId)
          );
        case '/album/lookup': {
          const mbid = (query.term ?? '').replace(/^lidarr:/, '');
          return [...this.albums, ...this.lookupAlbums].filter(
            (a) => a.foreignAlbumId === mbid
          );
        }
        case '/queue':
          return {
            page: Number(query.page ?? 1),
            pageSize: Number(query.pageSize ?? 10),
            totalRecords: this.queue.length,
            records: Number(query.page ?? 1) === 1 ? this.queue : [],
          };
      }

      const artistMatch = route.match(/^\/artist\/(\d+)$/);
      if (artistMatch) {
        const artist = this.artists.find(
          (a) => a.id === Number(artistMatch[1])
        );
        if (!artist) throw notFound();
        return artist;
      }
    }

    if (method === 'POST' && route === '/artist') {
      const artist: LidarrArtist = { ...body, id: this.nextId++ };
      delete artist.addOptions;
      this.artists.push(artist);
      for (const album of this.albumsOnArtistAdd) {
        this.albums.push({
          ...album,
          id: this.nextId++,
          artistId: artist.id as number,
          monitored: body.addOptions?.monitor === 'all',
        });
      }
      return artist;
    }

    if (method === 'PUT' && /^\/artist\/\d+$/.test(route)) {
      const index = this.artists.findIndex((a) => a.id === body.id);
      if (index === -1) throw notFound();
      this.artists[index] = body;
      return body;
    }

    if (method === 'POST' && route === '/album') {
      const album: LidarrAlbum = { ...body, id: this.nextId++ };
      delete album.addOptions;
      this.albums.push(album);
      return album;
    }

    if (method === 'PUT' && route === '/album/monitor') {
      for (const album of this.albums) {
        if (body.albumIds.includes(album.id)) {
          album.monitored = body.monitored;
        }
      }
      return this.albums.filter((a) => body.albumIds.includes(a.id));
    }

    if (method === 'POST' && route === '/command') {
      return { id: this.nextId++, name: body.name, status: 'queued' };
    }

    throw notFound();
  }
}
