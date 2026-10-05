// Test-only helpers for the client API contract tests (never imported by the app).
import { clearCredentialCache } from '@server/clientapi/common/credentials';
import { invalidateLibrary } from '@server/clientapi/common/library';
import { clearNowPlaying } from '@server/clientapi/common/userData';
import jellyfinApi from '@server/clientapi/jellyfin';
import subsonicApi from '@server/clientapi/subsonic';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import Track from '@server/entity/Track';
import { User } from '@server/entity/User';
import { createAppPassword } from '@server/lib/auth/appPasswords';
import * as imageSources from '@server/lib/imageSources';
import * as streamLib from '@server/lib/library/stream';
import type { PlayEvent } from '@server/lib/scrobble';
import * as scrobbleLib from '@server/lib/scrobble';
import { getSettings } from '@server/lib/settings';
import type { Express, Request, Response } from 'express';
import express from 'express';
import { mock } from 'node:test';

export const ARTIST_MBID = '11111111-1111-4111-8111-111111111111';
export const ALBUM_ONE_MBID = '22222222-2222-4222-8222-222222222222';
export const ALBUM_TWO_MBID = '33333333-3333-4333-8333-333333333333';
export const ALBUM_THREE_MBID = '44444444-4444-4444-8444-444444444444';

export const FAKE_AUDIO = Buffer.from('not-really-audio-bytes');
export const FAKE_IMAGE = Buffer.from('not-really-a-jpeg');

export interface SeededLibrary {
  admin: User;
  demo: User;
  adminPassword: string;
  demoPassword: string;
  adminAppPasswordId: number;
  artist: Media;
  albumOne: Media;
  albumTwo: Media;
  /** Album by an artist without a MusicBrainz id. */
  albumThree: Media;
  /** AVAILABLE + playable tracks of album one, in order. */
  tracksOne: Track[];
  tracksTwo: Track[];
  tracksThree: Track[];
  /** On the tracklist but not in the library. */
  missingTrack: Track;
  /** Marked available, but nothing the streamer would serve. */
  unplayableTrack: Track;
}

export interface Recorded {
  streams: {
    trackId: number;
    options: streamLib.StreamOptions;
    range?: string;
  }[];
  plays: PlayEvent[];
  nowPlaying: PlayEvent[];
  covers: string[];
}

export const createClientApiApp = (): Express => {
  const app = express();
  app.use('/rest', subsonicApi);
  app.use('/jellyfin', jellyfinApi);
  return app;
};

export const enableClientApis = (
  overrides: Partial<ReturnType<typeof getSettings>['clients']> = {}
): void => {
  const settings = getSettings();
  const data = (
    settings as unknown as {
      data: {
        serverSecret: string;
        plex: { enabled: boolean; ip: string };
        localFiles: { enabled: boolean; folders: string[] };
      };
    }
  ).data;
  // The secret normally appears on first boot; tests don't load settings.json.
  data.serverSecret = 'client-api-test-secret';
  // Sources the seeded tracks live on (see seedLibrary).
  data.localFiles.enabled = true;
  data.localFiles.folders = ['/music'];
  data.plex.enabled = true;
  data.plex.ip = '192.0.2.10';
  settings.clients = {
    openSubsonic: true,
    jellyfinApi: true,
    allowDownloads: true,
    mobileTranscode: 'original',
    ...overrides,
  };
};

/**
 * Replace the pieces other streams own (file streaming, image fetching, the
 * scrobble pipeline) with recorders, so these tests only cover the protocol
 * layer and never touch the network or the filesystem.
 */
export const installRecorders = (): Recorded => {
  const recorded: Recorded = {
    streams: [],
    plays: [],
    nowPlaying: [],
    covers: [],
  };

  mock.method(
    streamLib,
    'streamTrack',
    async (
      req: Request,
      res: Response,
      trackId: number,
      options: streamLib.StreamOptions = {}
    ) => {
      recorded.streams.push({
        trackId,
        options,
        range: req.header('range') ?? undefined,
      });
      if (req.header('range')) {
        res
          .status(206)
          .set('Content-Type', 'audio/flac')
          .set('Accept-Ranges', 'bytes')
          .set('Content-Range', `bytes 0-3/${FAKE_AUDIO.length}`)
          .end(FAKE_AUDIO.subarray(0, 4));
      } else {
        res.status(200).set('Content-Type', 'audio/flac').end(FAKE_AUDIO);
      }
    }
  );

  mock.method(imageSources, 'getImageSource', (type: string) =>
    type === 'caa'
      ? {
          getImage: async (path: string) => {
            recorded.covers.push(path);
            if (path.includes(ALBUM_TWO_MBID)) {
              throw new Error('404');
            }
            return {
              imageBuffer: FAKE_IMAGE,
              meta: { extension: 'jpeg', curRevalidate: 60, cacheKey: path },
            };
          },
        }
      : null
  );

  mock.method(scrobbleLib, 'recordPlay', async (event: PlayEvent) => {
    recorded.plays.push(event);
    return [];
  });
  mock.method(scrobbleLib, 'nowPlaying', async (event: PlayEvent) => {
    recorded.nowPlaying.push(event);
  });

  return recorded;
};

const saveTrack = (
  media: Media,
  number: number,
  title: string,
  init: Partial<Track> = {}
): Promise<Track> =>
  getRepository(Track).save(
    new Track({
      media,
      position: String(number).padStart(2, '0'),
      discNumber: 1,
      trackNumber: number,
      title,
      artistCredit: media.artistName ?? '',
      lengthMs: 180000 + number * 1000,
      status: MediaStatus.AVAILABLE,
      fileFormat: 'FLAC 16/44.1',
      sourceIds: { localPath: `/music/${media.title}/${number}.flac` },
      recordingMbid: `aaaaaaaa-0000-4000-8000-${String(
        media.id * 100 + number
      ).padStart(12, '0')}`,
      createdAt: new Date(Date.UTC(2026, 0, media.id, 0, number)),
      ...init,
    })
  );

/** Rows a scanner would have produced for a small library. Call after the test DB reset. */
export const seedLibrary = async (): Promise<SeededLibrary> => {
  invalidateLibrary();
  clearCredentialCache();
  clearNowPlaying();

  const users = getRepository(User);
  const admin = await users.findOneOrFail({
    where: { email: 'admin@shufflerr.test' },
  });
  const demo = await users.findOneOrFail({
    where: { email: 'demo@shufflerr.test' },
  });

  const media = getRepository(Media);
  const artist = await media.save(
    new Media({
      mediaType: MediaType.ARTIST,
      mbid: ARTIST_MBID,
      title: 'The Night Shift',
      artistName: 'The Night Shift',
      status: MediaStatus.UNKNOWN,
    })
  );
  const albumOne = await media.save(
    new Media({
      mediaType: MediaType.RELEASE_GROUP,
      mbid: ALBUM_ONE_MBID,
      artistMbid: ARTIST_MBID,
      artistName: 'The Night Shift',
      title: 'After Hours',
      primaryType: 'Album',
      firstReleaseDate: '2021-05-14',
      status: MediaStatus.PARTIALLY_AVAILABLE,
      trackCount: 5,
      tracksAvailable: 3,
      mediaAddedAt: new Date('2026-01-10T00:00:00Z'),
    })
  );
  const albumTwo = await media.save(
    new Media({
      mediaType: MediaType.RELEASE_GROUP,
      mbid: ALBUM_TWO_MBID,
      artistMbid: ARTIST_MBID,
      artistName: 'The Night Shift',
      title: 'Zero Hour',
      primaryType: 'EP',
      firstReleaseDate: '2024',
      status: MediaStatus.AVAILABLE,
      trackCount: 2,
      tracksAvailable: 2,
      mediaAddedAt: new Date('2026-02-10T00:00:00Z'),
    })
  );
  const albumThree = await media.save(
    new Media({
      mediaType: MediaType.RELEASE_GROUP,
      mbid: ALBUM_THREE_MBID,
      artistMbid: null,
      artistName: 'Basement Tapes Collective',
      title: 'Live at the Depot',
      primaryType: 'Album',
      secondaryTypes: ['Live'],
      firstReleaseDate: '1999-11',
      status: MediaStatus.AVAILABLE,
      trackCount: 1,
      tracksAvailable: 1,
      mediaAddedAt: new Date('2026-03-10T00:00:00Z'),
    })
  );

  const tracksOne = [
    await saveTrack(albumOne, 1, 'Closing Time'),
    await saveTrack(albumOne, 2, 'Last Train Home', {
      artistCredit: 'The Night Shift, Mara Vale',
    }),
    await saveTrack(albumOne, 3, 'Streetlights', {
      fileFormat: 'MP3 320',
      sourceIds: { plex: '4411', plexPartKey: '/library/parts/4411/file.mp3' },
    }),
  ];
  const missingTrack = await saveTrack(albumOne, 4, 'Sunrise', {
    status: MediaStatus.UNKNOWN,
    sourceIds: null,
    fileFormat: null,
  });
  const unplayableTrack = await saveTrack(albumOne, 5, 'Ghost Track', {
    // Outside the music folders, and on a media server that is switched off.
    sourceIds: { localPath: '/elsewhere/ghost.flac', jellyfin: 'jf-77' },
  });
  const tracksTwo = [
    await saveTrack(albumTwo, 1, 'Countdown'),
    await saveTrack(albumTwo, 2, 'Zero'),
  ];
  const tracksThree = [await saveTrack(albumThree, 1, 'Depot Jam')];

  const adminApp = await createAppPassword(admin, 'Test phone');
  const demoApp = await createAppPassword(demo, 'Test tablet');

  return {
    admin,
    demo,
    adminPassword: adminApp.password,
    demoPassword: demoApp.password,
    adminAppPasswordId: adminApp.item.id,
    artist,
    albumOne,
    albumTwo,
    albumThree,
    tracksOne,
    tracksTwo,
    tracksThree,
    missingTrack,
    unplayableTrack,
  };
};
