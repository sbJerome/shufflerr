import CoverArtArchive from '@server/api/coverartarchive';
import FanartAPI, { fanartProxyPath } from '@server/api/fanart';
import LastfmAPI, {
  cleanLastfmText,
  signLastfmParams,
} from '@server/api/lastfm';
import ListenBrainzAPI, { toLbListen } from '@server/api/listenbrainz';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import {
  fixture,
  fixtureAdapter,
  httpError,
} from '@server/test/fixtureAdapter';
import type { AxiosAdapter } from 'axios';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';

const JOHN_SUMMIT = '2547c5e3-314c-4332-981d-f18c902a4086';
const CTRL_ESCAPE = '324f381f-ebef-4003-8885-c06659395d8b';

// each class exposes its protected axios instance to the tests the same way
const withAdapter = <T extends object>(client: T, adapter: AxiosAdapter): T => {
  (
    client as unknown as { axios: { defaults: { adapter: AxiosAdapter } } }
  ).axios.defaults.adapter = adapter;
  return client;
};

describe('Cover Art Archive', () => {
  beforeEach(() => cacheManager.getCache('coverart').flush());

  it('only ever returns image-proxy paths', () => {
    assert.equal(
      CoverArtArchive.releaseGroupFront(CTRL_ESCAPE, 250),
      `/imageproxy/caa/release-group/${CTRL_ESCAPE}/front-250`
    );
    assert.equal(
      CoverArtArchive.releaseFront('abc', 1200),
      '/imageproxy/caa/release/abc/front-1200'
    );
  });

  it('returns nothing when switched off', () => {
    const settings = getSettings();
    settings.metadata.coverArtArchive.enabled = false;
    try {
      assert.equal(CoverArtArchive.releaseGroupFront(CTRL_ESCAPE), null);
    } finally {
      settings.metadata.coverArtArchive.enabled = true;
    }
  });

  it('reads the recorded listing and knows a front cover exists', async () => {
    const { adapter, calls } = fixtureAdapter(() =>
      fixture('coverartarchive/release-group-ctrl-escape.json')
    );
    const caa = withAdapter(new CoverArtArchive(), adapter);
    assert.equal(await caa.hasFront(CTRL_ESCAPE), true);
    assert.equal(calls[0].url, `/release-group/${CTRL_ESCAPE}`);
  });

  it('treats a 404 as "no art"', async () => {
    const caa = withAdapter(new CoverArtArchive(), async (config) => {
      throw httpError(config, 404);
    });
    assert.equal(await caa.hasFront(CTRL_ESCAPE), false);
  });
});

describe('fanart.tv', () => {
  beforeEach(() => cacheManager.getCache('fanart').flush());

  it('turns asset URLs into image-proxy paths and refuses other hosts', () => {
    assert.equal(
      fanartProxyPath(
        'http://assets.fanart.tv/fanart/music/x/artistthumb/a.jpg'
      ),
      '/imageproxy/fanart/fanart/music/x/artistthumb/a.jpg'
    );
    assert.equal(fanartProxyPath('https://evil.example/a.jpg'), null);
    assert.equal(fanartProxyPath(undefined), null);
  });

  it('picks the most liked thumb and the background', async () => {
    const { adapter, calls } = fixtureAdapter(() =>
      fixture('fanart/artist.json')
    );
    const fanart = withAdapter(new FanartAPI('test-key'), adapter);
    const images = await fanart.getArtistImages(JOHN_SUMMIT);
    assert.equal(calls[0].url, `/music/${JOHN_SUMMIT}`);
    assert.equal(
      images.thumb,
      `/imageproxy/fanart/fanart/music/${JOHN_SUMMIT}/artistthumb/b.jpg`
    );
    assert.equal(
      images.background,
      `/imageproxy/fanart/fanart/music/${JOHN_SUMMIT}/artistbackground/c.jpg`
    );
    assert.equal(images.logo, null);
  });

  it('returns no images for an artist fanart.tv does not have', async () => {
    const fanart = withAdapter(new FanartAPI('test-key'), async (config) => {
      throw httpError(config, 404);
    });
    assert.deepEqual(await fanart.getArtistImages(JOHN_SUMMIT), {
      thumb: null,
      background: null,
      logo: null,
    });
  });

  it('is off without a key', () => {
    assert.equal(FanartAPI.enabled(), false);
  });
});

describe('Last.fm', () => {
  beforeEach(() => cacheManager.getCache('lastfm').flush());

  it('signs parameters the way Last.fm specifies', () => {
    const params = {
      method: 'auth.getSession',
      token: 'tok',
      api_key: 'key',
      format: 'json',
    };
    const expected = crypto
      .createHash('md5')
      .update('api_keykeymethodauth.getSessiontokentoksecret')
      .digest('hex');
    assert.equal(signLastfmParams(params, 'secret'), expected);
  });

  it('strips the "Read more" anchor from a bio', () => {
    assert.equal(
      cleanLastfmText(
        'A DJ from Chicago. <a href="https://www.last.fm/music/X">Read more on Last.fm</a>'
      ),
      'A DJ from Chicago.'
    );
    assert.equal(cleanLastfmText(undefined), '');
  });

  it('reads artist info by MBID', async () => {
    const { adapter, calls } = fixtureAdapter(() =>
      fixture('lastfm/artist-getinfo.json')
    );
    const lastfm = withAdapter(new LastfmAPI({ apiKey: 'key' }), adapter);
    const info = await lastfm.getArtistInfo({ mbid: JOHN_SUMMIT });
    assert.equal(calls[0].params.method, 'artist.getinfo');
    assert.equal(calls[0].params.mbid, JOHN_SUMMIT);
    assert.equal(info?.name, 'John Summit');
    assert.equal(
      cleanLastfmText(info?.bio?.summary),
      'John Summit is a DJ and producer from Chicago.'
    );
  });

  it('falls back to the artist name when Last.fm does not know the MBID', async () => {
    const { adapter, calls } = fixtureAdapter((call) =>
      call.params.mbid
        ? { error: 6, message: 'The artist you supplied could not be found' }
        : fixture('lastfm/artist-getinfo.json')
    );
    const lastfm = withAdapter(new LastfmAPI({ apiKey: 'key' }), adapter);
    const info = await lastfm.getArtistInfo({
      mbid: JOHN_SUMMIT,
      artist: 'John Summit',
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].params.artist, 'John Summit');
    assert.equal(info?.name, 'John Summit');
  });

  it('exchanges a web-auth token for a session with a signed call', async () => {
    const { adapter, calls } = fixtureAdapter(() => ({
      session: { name: 'listener', key: 'session-key', subscriber: 0 },
    }));
    const lastfm = withAdapter(
      new LastfmAPI({ apiKey: 'key', sharedSecret: 'secret' }),
      adapter
    );
    const session = await lastfm.getSession('tok');
    assert.deepEqual(session, {
      name: 'listener',
      key: 'session-key',
      subscriber: 0,
    });
    assert.equal(calls[0].params.method, 'auth.getSession');
    assert.equal(
      calls[0].params.api_sig,
      signLastfmParams(
        { method: 'auth.getSession', token: 'tok', api_key: 'key' },
        'secret'
      )
    );
  });

  it('scrobbles a batch as a signed form post', async () => {
    const { adapter, calls } = fixtureAdapter(() => ({
      scrobbles: { '@attr': { accepted: 2, ignored: 0 } },
    }));
    const lastfm = withAdapter(
      new LastfmAPI({ apiKey: 'key', sharedSecret: 'secret' }),
      adapter
    );
    const result = await lastfm.scrobble('sk', [
      { artist: 'John Summit', track: 'SATA', timestamp: 1700000000 },
      {
        artist: 'John Summit',
        track: 'OOO',
        album: 'CTRL ESCAPE',
        timestamp: 1700000200,
      },
    ]);
    assert.deepEqual(result, { accepted: 2, ignored: 0 });
    assert.equal(calls[0].method, 'post');
    // nothing travels in the query string: every parameter is in the signed body
    assert.deepEqual(
      Object.values(calls[0].params).filter(
        (v) => v !== null && v !== undefined
      ),
      []
    );
    const body = new URLSearchParams(String(calls[0].data));
    assert.equal(body.get('method'), 'track.scrobble');
    assert.equal(body.get('artist[0]'), 'John Summit');
    assert.equal(body.get('track[1]'), 'OOO');
    assert.equal(body.get('album[1]'), 'CTRL ESCAPE');
    assert.equal(body.get('album[0]'), null);
    assert.equal(body.get('sk'), 'sk');
    assert.equal(body.get('format'), 'json');
    const signedOver: Record<string, string> = {};
    body.forEach((value, key) => {
      if (key !== 'api_sig' && key !== 'format') {
        signedOver[key] = value;
      }
    });
    assert.equal(body.get('api_sig'), signLastfmParams(signedOver, 'secret'));
  });

  it('refuses to sign without a shared secret', async () => {
    const lastfm = new LastfmAPI({ apiKey: 'key', sharedSecret: '' });
    await assert.rejects(() => lastfm.getSession('tok'), /shared secret/);
  });

  it('surfaces Last.fm errors with their code', async () => {
    const lastfm = withAdapter(
      new LastfmAPI({ apiKey: 'key', sharedSecret: 'secret' }),
      async (config) => {
        throw httpError(config, 403, {
          error: 9,
          message: 'Invalid session key - Please re-authenticate',
        });
      }
    );
    await assert.rejects(
      () => lastfm.updateNowPlaying('bad', { artist: 'A', track: 'T' }),
      (e: Error & { code?: number }) =>
        e.code === 9 && /Invalid session key/.test(e.message)
    );
  });
});

describe('ListenBrainz', () => {
  beforeEach(() => cacheManager.getCache('listenbrainz').flush());

  it('reads the recorded sitewide charts', async () => {
    const { adapter, calls } = fixtureAdapter((call) =>
      fixture(
        call.url.endsWith('/artists')
          ? 'listenbrainz/sitewide-artists.json'
          : 'listenbrainz/sitewide-release-groups.json'
      )
    );
    const lb = withAdapter(new ListenBrainzAPI('https://lb.test'), adapter);
    const groups = await lb.getSitewideReleaseGroups('week', 4);
    assert.equal(calls[0].url, '/1/stats/sitewide/release-groups');
    assert.deepEqual(calls[0].params, { range: 'week', count: 4 });
    assert.ok(groups.length > 0);
    assert.ok(groups[0].release_group_name);
    assert.ok(groups[0].listen_count > 0);

    const artists = await lb.getSitewideArtists('week', 4);
    assert.ok(artists[0].artist_name);
  });

  it('caches fresh releases as a compact index keyed by release group', async () => {
    const { adapter, calls } = fixtureAdapter(() =>
      fixture('listenbrainz/fresh-releases.json')
    );
    const lb = withAdapter(new ListenBrainzAPI('https://lb.test'), adapter);
    const index = await lb.getFreshReleaseIndex(60);
    assert.equal(calls[0].params.sort, 'release_date');
    assert.equal(calls[0].params.days, 60);
    const mbids = Object.keys(index.groups);
    assert.ok(mbids.length > 0);
    assert.ok(index.groups[mbids[0]].date);

    const again = await lb.getFreshReleaseIndex(60);
    assert.equal(calls.length, 1);
    assert.deepEqual(again.groups, index.groups);
  });

  it('validates a user token', async () => {
    const { adapter, calls } = fixtureAdapter(() => ({
      code: 200,
      message: 'Token valid.',
      valid: true,
      user_name: 'listener',
    }));
    const lb = withAdapter(new ListenBrainzAPI('https://lb.test'), adapter);
    const result = await lb.validateToken('user-token');
    assert.equal(calls[0].headers.Authorization, 'Token user-token');
    assert.equal(result.valid, true);
    assert.equal(result.userName, 'listener');
  });

  it('reports an invalid token without throwing', async () => {
    const lb = withAdapter(
      new ListenBrainzAPI('https://lb.test'),
      async (config) => {
        throw httpError(config, 401, { code: 401, message: 'Invalid token' });
      }
    );
    assert.deepEqual(await lb.validateToken('nope'), {
      valid: false,
      message: 'Invalid token',
    });
  });

  it('builds a listen with MBIDs and the submission client', () => {
    const listen = toLbListen(
      {
        artist: 'John Summit',
        track: 'SATA',
        album: 'CTRL ESCAPE',
        recordingMbid: '34e11944-3b08-487b-a782-9113df6a3d8a',
        releaseGroupMbid: CTRL_ESCAPE,
        durationMs: 183000,
        listenedAt: 1700000000,
      },
      true
    );
    assert.equal(listen.listened_at, 1700000000);
    assert.equal(listen.track_metadata.release_name, 'CTRL ESCAPE');
    assert.equal(
      listen.track_metadata.additional_info?.recording_mbid,
      '34e11944-3b08-487b-a782-9113df6a3d8a'
    );
    assert.equal(
      listen.track_metadata.additional_info?.submission_client,
      'Shufflerr'
    );
    assert.equal(
      toLbListen({ artist: 'A', track: 'T' }, false).listened_at,
      undefined
    );
  });

  it('submits a single listen and a playing-now without a timestamp', async () => {
    const { adapter, calls } = fixtureAdapter(() => ({ status: 'ok' }));
    const lb = withAdapter(new ListenBrainzAPI('https://lb.test'), adapter);
    await lb.submitPlays('user-token', [
      { artist: 'John Summit', track: 'SATA', listenedAt: 1700000000 },
    ]);
    await lb.submitPlayingNow('user-token', {
      artist: 'John Summit',
      track: 'OOO',
    });
    const single = JSON.parse(String(calls[0].data));
    assert.equal(calls[0].url, '/1/submit-listens');
    assert.equal(calls[0].headers.Authorization, 'Token user-token');
    assert.equal(single.listen_type, 'single');
    assert.equal(single.payload[0].listened_at, 1700000000);
    const now = JSON.parse(String(calls[1].data));
    assert.equal(now.listen_type, 'playing_now');
    assert.equal(now.payload[0].listened_at, undefined);
  });
});
