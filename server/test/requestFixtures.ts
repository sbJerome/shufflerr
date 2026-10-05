// Shared set-up for the request engine / request route tests: a fake Lidarr,
// a stand-in for the MusicBrainz-backed metadata helpers (no network in
// tests) and small builders for users, albums and artists.
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Track from '@server/entity/Track';
import { User } from '@server/entity/User';
import * as metadata from '@server/lib/metadata';
import notificationManager, { Notification } from '@server/lib/notifications';
import type { NotificationPayload } from '@server/lib/notifications/agents/agent';
import { getSettings } from '@server/lib/settings';
import {
  flushRequestSideEffects,
  lidarrTiming,
} from '@server/subscriber/MediaRequestSubscriber';
import { FakeLidarr } from '@server/test/fakeLidarr';
import { after, afterEach, before, beforeEach, mock } from 'node:test';

export const ARTIST_MBID = '11111111-1111-4111-8111-111111111111';
/** 13 tracks, 9 of them in the library (the acceptance fixture shape). */
export const PARTIAL_ALBUM_MBID = '22222222-2222-4222-8222-222222222222';
/** 10 tracks, none in the library. */
export const MISSING_ALBUM_MBID = '33333333-3333-4333-8333-333333333333';
/** 8 tracks, all in the library. */
export const AVAILABLE_ALBUM_MBID = '44444444-4444-4444-8444-444444444444';

const ALBUMS: Record<string, { title: string; tracks: number; have: number }> =
  {
    [PARTIAL_ALBUM_MBID]: { title: 'Partial Album', tracks: 13, have: 9 },
    [MISSING_ALBUM_MBID]: { title: 'Missing Album', tracks: 10, have: 0 },
    [AVAILABLE_ALBUM_MBID]: { title: 'Available Album', tracks: 8, have: 8 },
  };

export const recordingMbid = (albumMbid: string, n: number): string =>
  `${albumMbid.slice(0, 24)}${String(n).padStart(12, '0')}`;

export const albumMbid = (n: number): string =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

/** Stand-in for SV1's ensureMedia(): find or create rows without MusicBrainz. */
export const ensureTestMedia = async (
  mbid: string,
  mediaType: MediaType
): Promise<Media> => {
  const mediaRepository = getRepository(Media);
  const existing = await mediaRepository.findOne({
    where: { mbid, mediaType },
  });
  if (existing) {
    return existing;
  }

  if (mediaType === MediaType.ARTIST) {
    return mediaRepository.save(
      new Media({
        mbid,
        mediaType,
        title: 'Test Artist',
        artistName: 'Test Artist',
        status: MediaStatus.UNKNOWN,
      })
    );
  }

  const spec = ALBUMS[mbid] ?? { title: `Album ${mbid}`, tracks: 3, have: 0 };
  const media = await mediaRepository.save(
    new Media({
      mbid,
      mediaType,
      title: spec.title,
      artistMbid: ARTIST_MBID,
      artistName: 'Test Artist',
      primaryType: 'Album',
      trackCount: spec.tracks,
      tracksAvailable: spec.have,
      status:
        spec.have === 0
          ? MediaStatus.UNKNOWN
          : spec.have >= spec.tracks
            ? MediaStatus.AVAILABLE
            : MediaStatus.PARTIALLY_AVAILABLE,
    })
  );

  await getRepository(Track).save(
    Array.from({ length: spec.tracks }, (_, i) => {
      const n = i + 1;
      return new Track({
        media,
        recordingMbid: recordingMbid(mbid, n),
        position: String(n).padStart(2, '0'),
        discNumber: 1,
        trackNumber: n,
        title: `Track ${n}`,
        artistCredit: 'Test Artist',
        lengthMs: 180000,
        status: n <= spec.have ? MediaStatus.AVAILABLE : MediaStatus.UNKNOWN,
        sourceIds:
          n <= spec.have ? { localPath: `/music/${mbid}/${n}.flac` } : null,
      });
    })
  );

  return media;
};

export const makeUser = async (
  name: string,
  permissions: number,
  quota: Partial<
    Pick<
      User,
      | 'albumQuotaLimit'
      | 'albumQuotaDays'
      | 'trackQuotaLimit'
      | 'trackQuotaDays'
    >
  > = {}
): Promise<User> => {
  const user = new User();
  user.email = `${name}@shufflerr.test`;
  user.username = name;
  user.userType = UserType.LOCAL;
  user.permissions = permissions;
  user.avatar = '';
  Object.assign(user, quota);
  return getRepository(User).save(user);
};

/** Insert `count` album requests for a user so their album quota is partly used. */
export const useAlbumQuota = async (
  user: User,
  count: number,
  status = MediaRequestStatus.COMPLETED
): Promise<void> => {
  for (let i = 0; i < count; i++) {
    const media = await ensureTestMedia(
      albumMbid(user.id * 1000 + i),
      MediaType.RELEASE_GROUP
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        media,
        scope: RequestScope.ALBUM,
        status,
        requestedBy: user,
        tracks: [],
      })
    );
  }
};

export interface SentNotification {
  type: Notification;
  name: string;
  payload: NotificationPayload;
}

export interface RequestTestContext {
  lidarr: FakeLidarr;
  notifications: SentNotification[];
  /** Release groups the mocked discography lookup returns. */
  discographySize: number;
}

/**
 * Registers the hooks every request test needs and returns the shared
 * context. Call once at the top of a test file, after setupTestDb().
 */
export const setupRequestTests = (): RequestTestContext => {
  const context: RequestTestContext = {
    lidarr: new FakeLidarr(),
    notifications: [],
    discographySize: 8,
  };
  const settings = getSettings();
  const saved = {
    main: structuredClone(settings.main),
    lidarr: structuredClone(settings.lidarr),
    timing: { ...lidarrTiming },
  };

  before(async () => {
    await context.lidarr.start();

    mock.method(metadata, 'ensureMedia', ensureTestMedia);
    mock.method(metadata, 'syncTracklist', async (media: Media) => media);
    mock.method(metadata, 'getDiscographyReleaseGroups', async () =>
      Array.from({ length: context.discographySize }, (_, i) => ({
        mbid: albumMbid(900000 + i),
        title: `Discography album ${i + 1}`,
        primaryType: 'Album',
      }))
    );
    mock.method(
      notificationManager,
      'sendNotification',
      (type: Notification, payload: NotificationPayload) => {
        context.notifications.push({ type, name: Notification[type], payload });
      }
    );
  });

  beforeEach(() => {
    context.lidarr.reset();
    context.notifications.length = 0;
    context.discographySize = 8;
    lidarrTiming.albumPollDelayMs = 0;
    lidarrTiming.albumPollAttempts = 2;

    settings.main.defaultQuotas = {
      album: { quotaLimit: 10, quotaDays: 7 },
      track: { quotaLimit: 50, quotaDays: 7 },
    };
    settings.main.discographyAlwaysReview = true;
    settings.main.allowTrackRequests = true;
    settings.lidarr = [context.lidarr.settings()];

    // The artist and the three fixture albums already exist in Lidarr.
    context.lidarr.artists = [
      {
        id: 5,
        artistName: 'Test Artist',
        foreignArtistId: ARTIST_MBID,
        qualityProfileId: 2,
        metadataProfileId: 1,
        monitored: true,
        monitorNewItems: 'none',
        tags: [],
      },
    ];
    context.lidarr.albums = Object.entries(ALBUMS).map(([mbid, spec], i) => ({
      id: 200 + i,
      title: spec.title,
      artistId: 5,
      foreignAlbumId: mbid,
      monitored: false,
      statistics: {
        trackCount: spec.tracks,
        trackFileCount: spec.have,
        totalTrackCount: spec.tracks,
        sizeOnDisk: 0,
        percentOfTracks: (spec.have / spec.tracks) * 100,
      },
    }));
  });

  afterEach(async () => {
    await flushRequestSideEffects();
  });

  after(async () => {
    await flushRequestSideEffects();
    await context.lidarr.stop();
    settings.main = saved.main;
    settings.lidarr = saved.lidarr;
    Object.assign(lidarrTiming, saved.timing);
    mock.restoreAll();
  });

  return context;
};
