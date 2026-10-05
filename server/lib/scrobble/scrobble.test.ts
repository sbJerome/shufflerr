import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, beforeEach, describe, it } from 'node:test';

import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import LinkedAccount from '@server/entity/LinkedAccount';
import Media from '@server/entity/Media';
import ScrobbleQueue from '@server/entity/ScrobbleQueue';
import Track from '@server/entity/Track';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import {
  MAX_ATTEMPTS,
  backoffMs,
  getUserTargets,
  nowPlaying,
  processScrobbleQueue,
  recordPlay,
  resetScrobbleBackoff,
} from '@server/lib/scrobble';
import { shouldScrobble } from '@server/lib/scrobble/rule';
import { lastfmSignature } from '@server/lib/scrobble/targets';
import {
  jellyfinPayloadToPlay,
  multipartField,
  plexPayloadToPlay,
} from '@server/lib/scrobble/webhooks';
import { encryptSecret } from '@server/lib/secrets';
import type { AllSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import { installHttpMock } from '@server/test/mockAxios';

const LB = 'https://api.listenbrainz.org/1/submit-listens';
const LASTFM = 'https://ws.audioscrobbler.com/2.0/';
const RECORDING = '5b9f3b3c-6c0c-4f0e-9d4e-0a5d1c6f7a10';
const RELEASE_GROUP = 'aa997ea0-2936-40bd-884d-3af8a0e064dc';
/** 4:08 */
const LENGTH_MS = 248_000;

const http = installHttpMock();
let pristine: AllSettings;
let trackId: number;

const admin = () => getRepository(User).findOneOrFail({ where: { id: 1 } });

const link = async (
  provider: 'listenbrainz' | 'lastfm',
  secret: string,
  userId = 1
) =>
  getRepository(LinkedAccount).save(
    new LinkedAccount({
      user: { id: userId } as User,
      provider,
      externalUsername: `${provider}-user`,
      secret: encryptSecret(secret),
    })
  );

const play = async (overrides: Record<string, unknown> = {}) => ({
  user: await admin(),
  source: 'web' as const,
  trackId,
  artist: '',
  track: '',
  startedAt: new Date('2026-10-01T20:00:00Z'),
  playedSeconds: 200,
  ...overrides,
});

before(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pristine = structuredClone((getSettings() as any).data);
});

setupTestDb();

beforeEach(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getSettings() as any).data = structuredClone(pristine);
  const settings = getSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (settings as any).data.serverSecret =
    settings.serverSecret || 'test-server-secret-for-linked-accounts';
  settings.scrobble.listenbrainz.enabled = true;
  settings.scrobble.lastfm.enabled = true;
  settings.scrobble.rule = 'half-or-4min';
  settings.metadata.lastfm.enabled = true;
  settings.metadata.lastfm.apiKey = 'lastfm-api-key';
  settings.metadata.lastfm.sharedSecret = 'lastfm-shared-secret';
  http.reset();
  resetScrobbleBackoff();

  const media = await getRepository(Media).save(
    new Media({
      mediaType: MediaType.RELEASE_GROUP,
      mbid: RELEASE_GROUP,
      title: 'Random Access Memories',
      artistName: 'Daft Punk',
      status: MediaStatus.AVAILABLE,
    })
  );
  const track = await getRepository(Track).save(
    new Track({
      media,
      recordingMbid: RECORDING,
      position: '08',
      discNumber: 1,
      trackNumber: 8,
      title: 'Get Lucky',
      artistCredit: 'Daft Punk, Pharrell Williams, Nile Rodgers',
      lengthMs: LENGTH_MS,
      status: MediaStatus.AVAILABLE,
    })
  );
  trackId = track.id;
});

describe('scrobble rule', () => {
  const cases: [string, number | null, number | undefined, boolean][] = [
    ['half-or-4min', 248_000, 123, false],
    ['half-or-4min', 248_000, 124, true],
    ['half-or-4min', 900_000, 239, false],
    ['half-or-4min', 900_000, 240, true],
    ['half-or-4min', null, 200, false],
    ['half-or-4min', null, 240, true],
    ['end', 248_000, 240, false],
    ['end', 248_000, 244, true],
    ['end', null, 600, false],
    ['30s', 248_000, 29, false],
    ['30s', 248_000, 30, true],
    // tracks under 30 seconds never scrobble, whatever the rule
    ['30s', 29_000, 29, false],
    ['half-or-4min', 20_000, 20, false],
    ['end', 25_000, 25, false],
    // a source that only reports completed plays
    ['half-or-4min', 248_000, undefined, true],
    ['end', 20_000, undefined, false],
  ];
  for (const [rule, duration, played, expected] of cases) {
    it(`${rule}: ${played ?? 'completed'}s of ${duration ?? 'unknown'}ms → ${expected}`, () => {
      assert.equal(shouldScrobble(rule as never, duration, played), expected);
    });
  }

  it('backs off exponentially up to six hours', () => {
    assert.equal(backoffMs(1), 60_000);
    assert.equal(backoffMs(2), 120_000);
    assert.equal(backoffMs(4), 480_000);
    assert.equal(backoffMs(30), 6 * 60 * 60 * 1000);
  });
});

describe('Last.fm signature', () => {
  it('hashes the sorted parameters followed by the shared secret, leaving out format', () => {
    const expected = createHash('md5')
      .update(
        'api_keyKEYmethodtrack.scrobbleskSESSIONtrack[0]Für EliseSECRET',
        'utf8'
      )
      .digest('hex');
    assert.equal(
      lastfmSignature(
        {
          'track[0]': 'Für Elise',
          sk: 'SESSION',
          method: 'track.scrobble',
          format: 'json',
          api_key: 'KEY',
        },
        'SECRET'
      ),
      expected
    );
  });
});

describe('recordPlay', () => {
  it('queues a play for every linked target with the track details filled in', async () => {
    await link('listenbrainz', 'lb-token');
    await link('lastfm', 'lastfm-session');
    const targets = await recordPlay(await play());
    assert.deepEqual(targets, ['listenbrainz', 'lastfm']);

    const rows = await getRepository(ScrobbleQueue).find();
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.track, 'Get Lucky');
    assert.equal(row.artist, 'Daft Punk, Pharrell Williams, Nile Rodgers');
    assert.equal(row.album, 'Random Access Memories');
    assert.equal(row.recordingMbid, RECORDING);
    assert.equal(row.releaseGroupMbid, RELEASE_GROUP);
    assert.equal(row.durationMs, LENGTH_MS);
    assert.equal(row.source, 'web');
    assert.deepEqual(row.targets, {
      listenbrainz: 'pending',
      lastfm: 'pending',
    });
  });

  it('ignores a play that does not meet the rule', async () => {
    await link('listenbrainz', 'lb-token');
    assert.deepEqual(await recordPlay(await play({ playedSeconds: 60 })), []);
    assert.equal(await getRepository(ScrobbleQueue).count(), 0);

    getSettings().scrobble.rule = '30s';
    assert.deepEqual(await recordPlay(await play({ playedSeconds: 60 })), [
      'listenbrainz',
    ]);
  });

  it('records the same play once, whichever sources report it', async () => {
    await link('listenbrainz', 'lb-token');
    assert.equal((await recordPlay(await play())).length, 1);
    // the Plex webhook for the same listening session, two minutes later
    assert.deepEqual(
      await recordPlay(
        await play({
          source: 'plex',
          trackId: undefined,
          artist: 'daft punk, pharrell williams, nile rodgers',
          track: 'Get Lucky',
          durationMs: LENGTH_MS,
          startedAt: new Date('2026-10-01T20:02:00Z'),
          playedSeconds: undefined,
        })
      ),
      []
    );
    assert.equal(await getRepository(ScrobbleQueue).count(), 1);
    // playing it again after it finished is a new play
    assert.equal(
      (
        await recordPlay(
          await play({ startedAt: new Date('2026-10-01T20:04:30Z') })
        )
      ).length,
      1
    );
    assert.equal(await getRepository(ScrobbleQueue).count(), 2);
  });

  it('respects the per-source switches', async () => {
    await link('listenbrainz', 'lb-token');
    getSettings().scrobble.sources.web = false;
    assert.deepEqual(await recordPlay(await play()), []);
    assert.equal(await getRepository(ScrobbleQueue).count(), 0);
  });

  it('keeps the play as history but sends it nowhere when the user turned scrobbling off', async () => {
    await link('listenbrainz', 'lb-token');
    const user = await admin();
    user.settings = new UserSettings({
      scrobbleEnabled: false,
      notificationTypes: {},
    });
    await getRepository(User).save(user);

    assert.deepEqual(await getUserTargets(await admin()), []);
    assert.deepEqual(await recordPlay(await play()), []);
    const rows = await getRepository(ScrobbleQueue).find();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].targets, {});
  });

  it('only counts targets that are switched on and linked', async () => {
    await link('listenbrainz', 'lb-token');
    assert.deepEqual(await getUserTargets(await admin()), ['listenbrainz']);
    await link('lastfm', 'lastfm-session');
    assert.deepEqual(await getUserTargets(await admin()), [
      'listenbrainz',
      'lastfm',
    ]);
    getSettings().metadata.lastfm.sharedSecret = '';
    assert.deepEqual(await getUserTargets(await admin()), ['listenbrainz']);
    getSettings().scrobble.listenbrainz.enabled = false;
    assert.deepEqual(await getUserTargets(await admin()), []);
  });
});

describe('scrobble queue', () => {
  it('submits pending plays to ListenBrainz and Last.fm', async () => {
    await link('listenbrainz', 'lb-token');
    await link('lastfm', 'lastfm-session');
    await recordPlay(await play());
    http.post(LB, () => [200, { status: 'ok' }]);
    http.post(LASTFM, () => [
      200,
      { scrobbles: { '@attr': { accepted: 1, ignored: 0 } } },
    ]);

    await processScrobbleQueue();

    const [lb] = http.callsTo(LB);
    assert.equal(lb.headers.authorization, 'Token lb-token');
    const body = lb.body as {
      listen_type: string;
      payload: {
        listened_at: number;
        track_metadata: {
          artist_name: string;
          track_name: string;
          release_name: string;
          additional_info: Record<string, unknown>;
        };
      }[];
    };
    assert.equal(body.listen_type, 'single');
    assert.equal(body.payload[0].listened_at, 1790884800);
    assert.equal(body.payload[0].track_metadata.track_name, 'Get Lucky');
    assert.equal(
      body.payload[0].track_metadata.release_name,
      'Random Access Memories'
    );
    assert.equal(
      body.payload[0].track_metadata.additional_info.recording_mbid,
      RECORDING
    );
    assert.equal(
      body.payload[0].track_metadata.additional_info.release_group_mbid,
      RELEASE_GROUP
    );
    assert.equal(
      body.payload[0].track_metadata.additional_info.submission_client,
      'Shufflerr'
    );

    const [fm] = http.callsTo(LASTFM);
    const form = fm.body as URLSearchParams;
    assert.equal(form.get('method'), 'track.scrobble');
    assert.equal(form.get('sk'), 'lastfm-session');
    assert.equal(form.get('api_key'), 'lastfm-api-key');
    assert.equal(form.get('track[0]'), 'Get Lucky');
    assert.equal(form.get('timestamp[0]'), '1790884800');
    assert.equal(form.get('mbid[0]'), RECORDING);
    assert.equal(form.get('duration[0]'), '248');
    const signed = Object.fromEntries(
      [...form.entries()].filter(([k]) => k !== 'api_sig')
    );
    assert.equal(
      form.get('api_sig'),
      lastfmSignature(signed, 'lastfm-shared-secret')
    );

    const [row] = await getRepository(ScrobbleQueue).find();
    assert.deepEqual(row.targets, { listenbrainz: 'sent', lastfm: 'sent' });
    assert.equal(row.attempts, 0);

    // nothing left to send
    http.calls = [];
    await processScrobbleQueue();
    assert.equal(http.calls.length, 0);
  });

  it('retries a failed target with backoff and leaves the delivered one alone', async () => {
    await link('listenbrainz', 'lb-token');
    await link('lastfm', 'lastfm-session');
    await recordPlay(await play());
    let listenBrainzUp = false;
    http.post(LB, () =>
      listenBrainzUp
        ? [200, { status: 'ok' }]
        : [503, { error: 'Service Unavailable' }]
    );
    http.post(LASTFM, () => [200, { scrobbles: {} }]);

    await processScrobbleQueue();
    let [row] = await getRepository(ScrobbleQueue).find();
    assert.deepEqual(row.targets, { listenbrainz: 'pending', lastfm: 'sent' });
    assert.equal(row.attempts, 1);
    assert.match(row.lastError ?? '', /ListenBrainz/);

    // too early: the next run does not call anything
    http.calls = [];
    await processScrobbleQueue();
    assert.equal(http.calls.length, 0);

    // once the retry is due only ListenBrainz is called again
    resetScrobbleBackoff();
    listenBrainzUp = true;
    await processScrobbleQueue();
    assert.equal(http.callsTo(LB).length, 1);
    assert.equal(http.callsTo(LASTFM).length, 0);
    [row] = await getRepository(ScrobbleQueue).find();
    assert.deepEqual(row.targets, { listenbrainz: 'sent', lastfm: 'sent' });
    assert.equal(row.lastError, null);
  });

  it('gives up after the last attempt', async () => {
    await link('listenbrainz', 'lb-token');
    await recordPlay(await play());
    http.post(LB, () => [500, {}]);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      resetScrobbleBackoff();
      await processScrobbleQueue();
    }
    const [row] = await getRepository(ScrobbleQueue).find();
    assert.equal(row.attempts, MAX_ATTEMPTS);
    assert.deepEqual(row.targets, { listenbrainz: 'failed' });
    assert.equal(http.callsTo(LB).length, MAX_ATTEMPTS);
  });

  it('stops at once when the service rejects the link', async () => {
    await link('listenbrainz', 'lb-token');
    await link('lastfm', 'lastfm-session');
    await recordPlay(await play());
    http.post(LB, () => [
      401,
      { code: 401, error: 'Invalid authorization token.' },
    ]);
    http.post(LASTFM, () => [
      403,
      { error: 9, message: 'Invalid session key - Please re-authenticate' },
    ]);
    await processScrobbleQueue();
    const [row] = await getRepository(ScrobbleQueue).find();
    assert.deepEqual(row.targets, { listenbrainz: 'failed', lastfm: 'failed' });
    assert.match(row.lastError ?? '', /Link .* again/);
  });

  it('skips a target the user unlinked after the play', async () => {
    const linked = await link('listenbrainz', 'lb-token');
    await recordPlay(await play());
    await getRepository(LinkedAccount).delete(linked.id);
    await processScrobbleQueue();
    const [row] = await getRepository(ScrobbleQueue).find();
    assert.deepEqual(row.targets, { listenbrainz: 'skipped' });
    assert.equal(http.calls.length, 0);
  });

  it('batches Last.fm plays in fifties', async () => {
    await link('lastfm', 'lastfm-session');
    const user = await admin();
    await getRepository(ScrobbleQueue).save(
      Array.from(
        { length: 120 },
        (_, i) =>
          new ScrobbleQueue({
            user,
            artist: 'Daft Punk',
            track: `Track ${i}`,
            playedAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
            source: 'apps',
            targets: { lastfm: 'pending' },
            attempts: 0,
          })
      )
    );
    http.post(LASTFM, () => [200, { scrobbles: {} }]);
    await processScrobbleQueue();
    const sizes = http
      .callsTo(LASTFM)
      .map(
        (c) =>
          [...(c.body as URLSearchParams).keys()].filter((k) =>
            k.startsWith('track[')
          ).length
      );
    assert.deepEqual(sizes, [50, 50, 20]);
    assert.equal(
      await getRepository(ScrobbleQueue).count({
        where: { attempts: 0 },
      }),
      120
    );
  });
});

describe('now playing', () => {
  it('tells the linked services without a timestamp or a queue row', async () => {
    await link('listenbrainz', 'lb-token');
    await link('lastfm', 'lastfm-session');
    http.post(LB, () => [200, { status: 'ok' }]);
    http.post(LASTFM, () => [200, { nowplaying: {} }]);
    await nowPlaying(await play({ playedSeconds: 0 }));

    const body = http.callsTo(LB)[0].body as {
      listen_type: string;
      payload: Record<string, unknown>[];
    };
    assert.equal(body.listen_type, 'playing_now');
    assert.equal('listened_at' in body.payload[0], false);
    assert.equal(
      (http.callsTo(LASTFM)[0].body as URLSearchParams).get('method'),
      'track.updateNowPlaying'
    );
    assert.equal(await getRepository(ScrobbleQueue).count(), 0);
  });

  it('never throws when a service is down', async () => {
    await link('listenbrainz', 'lb-token');
    http.post(LB, () => [500, {}]);
    await nowPlaying(await play());
  });
});

describe('media server webhooks', () => {
  it('reads the payload field of a Plex multipart body', () => {
    const boundary = '----------------------------4ebf00fbcf09';
    const body = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="payload"',
        'Content-Type: application/json',
        '',
        '{"event":"media.scrobble","Metadata":{"title":"Für Elise"}}',
        `--${boundary}`,
        'Content-Disposition: form-data; name="thumb"; filename="thumb.jpg"',
        'Content-Type: image/jpeg',
        '',
        'not-really-a-jpeg',
        `--${boundary}--`,
        '',
      ].join('\r\n')
    );
    const type = `multipart/form-data; boundary=${boundary}`;
    assert.deepEqual(JSON.parse(multipartField(body, type, 'payload') ?? ''), {
      event: 'media.scrobble',
      Metadata: { title: 'Für Elise' },
    });
    assert.equal(multipartField(body, type, 'missing'), null);
    assert.equal(multipartField(body, 'multipart/form-data', 'payload'), null);
  });

  const plexPayload = (event: string, account = 'admin') => ({
    event,
    Account: { id: 7, title: account },
    Metadata: {
      type: 'track',
      title: 'Get Lucky',
      grandparentTitle: 'Daft Punk',
      parentTitle: 'Random Access Memories',
      duration: LENGTH_MS,
      Guid: [{ id: `mbid://${RECORDING}` }],
    },
  });

  it('maps a Plex scrobble to a completed play of the library track', async () => {
    const now = new Date('2026-10-01T21:00:00Z');
    const play = await plexPayloadToPlay(plexPayload('media.scrobble'), now);
    assert.equal(play?.kind, 'played');
    assert.equal(play?.event.user.id, 1);
    assert.equal(play?.event.source, 'plex');
    assert.equal(play?.event.trackId, trackId);
    assert.equal(play?.event.recordingMbid, RECORDING);
    assert.equal(play?.event.releaseGroupMbid, RELEASE_GROUP);
    assert.equal(play?.event.playedSeconds, undefined);
    // Plex fires at 90 % of the track
    assert.equal(
      play?.event.startedAt.getTime(),
      now.getTime() - LENGTH_MS * 0.9
    );
  });

  it('maps Plex play to now playing and ignores other events, items and strangers', async () => {
    assert.equal(
      (await plexPayloadToPlay(plexPayload('media.play')))?.kind,
      'now-playing'
    );
    assert.equal(await plexPayloadToPlay(plexPayload('media.pause')), null);
    assert.equal(
      await plexPayloadToPlay(plexPayload('media.scrobble', 'nobody-here')),
      null
    );
    const movie = plexPayload('media.scrobble');
    movie.Metadata.type = 'movie';
    assert.equal(await plexPayloadToPlay(movie), null);
  });

  it('maps a Jellyfin playback stop, matching the user by id and the track by name', async () => {
    const user = await getRepository(User).findOneOrFail({ where: { id: 2 } });
    user.jellyfinUserId = 'f3b0c4a1d2e54f6a8b7c9d0e1f2a3b4c';
    await getRepository(User).save(user);

    const now = new Date('2026-10-01T21:00:00Z');
    const play = await jellyfinPayloadToPlay(
      {
        NotificationType: 'PlaybackStop',
        ItemType: 'Audio',
        Name: 'get lucky',
        Artist: 'Daft Punk',
        Album: 'Random Access Memories',
        RunTimeTicks: 2_480_000_000,
        PlaybackPositionTicks: 1_500_000_000,
        PlayedToCompletion: false,
        UserId: 'F3B0C4A1-D2E5-4F6A-8B7C-9D0E1F2A3B4C',
      },
      now
    );
    assert.equal(play?.kind, 'played');
    assert.equal(play?.event.user.id, 2);
    assert.equal(play?.event.trackId, trackId);
    assert.equal(play?.event.durationMs, LENGTH_MS);
    assert.equal(play?.event.playedSeconds, 150);
    assert.equal(play?.event.startedAt.getTime(), now.getTime() - 150_000);

    assert.equal(
      (
        await jellyfinPayloadToPlay({
          NotificationType: 'PlaybackStart',
          ItemType: 'Audio',
          Name: 'Get Lucky',
          Artist: 'Daft Punk',
          NotificationUsername: 'nobody',
          UserId: 'F3B0C4A1-D2E5-4F6A-8B7C-9D0E1F2A3B4C',
        })
      )?.kind,
      'now-playing'
    );
    assert.equal(
      await jellyfinPayloadToPlay({
        NotificationType: 'PlaybackStop',
        ItemType: 'Movie',
        Name: 'Interstella 5555',
      }),
      null
    );
  });
});
