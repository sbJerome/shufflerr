import MusicBrainz, {
  crossFieldQuery,
  escapeLucene,
  musicBrainzUserAgent,
} from '@server/api/musicbrainz';
import type {
  MbArtist,
  MbArtistSearch,
  MbRelease,
  MbReleaseGroup,
  MbReleaseGroupBrowse,
} from '@server/api/musicbrainz/interfaces';
import { TokenBucket } from '@server/api/musicbrainz/rateLimiter';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import { fixture, fixtureAdapter, httpError } from '@server/test/fixtureAdapter';
import type { AxiosAdapter } from 'axios';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const JOHN_SUMMIT = '2547c5e3-314c-4332-981d-f18c902a4086';
const CTRL_ESCAPE = '324f381f-ebef-4003-8885-c06659395d8b';
const CTRL_ESCAPE_RELEASE = '2555fe96-7bde-4b6d-92ae-9ee09ffe71d4';

class TestMusicBrainz extends MusicBrainz {
  public installAdapter(adapter: AxiosAdapter): void {
    this.axios.defaults.adapter = adapter;
  }
}

const routes: Record<string, string> = {
  '/artist': 'musicbrainz/artist-search-john-summit.json',
  [`/artist/${JOHN_SUMMIT}`]: 'musicbrainz/artist-john-summit.json',
  [`/release-group/${CTRL_ESCAPE}`]: 'musicbrainz/release-group-ctrl-escape.json',
  [`/release/${CTRL_ESCAPE_RELEASE}`]: 'musicbrainz/release-ctrl-escape.json',
  '/release-group': 'musicbrainz/release-group-browse-john-summit.json',
};

const client = () => {
  const mb = new TestMusicBrainz('https://musicbrainz.test');
  const recorded = fixtureAdapter((call) => fixture(routes[call.url]));
  mb.installAdapter(recorded.adapter);
  return { mb, calls: recorded.calls };
};

describe('MusicBrainz client', () => {
  beforeEach(() => {
    cacheManager.getCache('musicbrainz').flush();
    getSettings().metadata.musicbrainz.requestsPerSecond = 50;
  });

  it('escapes Lucene syntax in user input', () => {
    assert.equal(escapeLucene('AC/DC (live)'), 'AC\\/DC \\(live\\)');
    assert.equal(escapeLucene('what? yes!'), 'what\\? yes\\!');
    assert.equal(escapeLucene('a && b'), 'a \\&& b');
  });

  it('builds a query where every word matches one of the fields', () => {
    assert.equal(
      crossFieldQuery('john summit', ['releasegroup', 'artistname']),
      '((releasegroup:john OR artistname:john) AND (releasegroup:summit OR artistname:summit)) OR releasegroup:"john summit"^3'
    );
    assert.equal(crossFieldQuery('   ', ['recording']), '');
  });

  it('sends a User-Agent with a contact', async () => {
    getSettings().metadata.musicbrainz.contact = 'owner@example.test';
    assert.match(
      musicBrainzUserAgent(),
      /^Shufflerr\/\d+\.\d+\.\d+\S* \( owner@example\.test \)$/
    );
    const { mb, calls } = client();
    await mb.getArtist(JOHN_SUMMIT);
    assert.equal(calls[0].headers['User-Agent'], musicBrainzUserAgent());
    getSettings().metadata.musicbrainz.contact = '';
  });

  it('searches artists and reads the recorded response', async () => {
    const { mb, calls } = client();
    const data: MbArtistSearch = await mb.searchArtists('john summit', {
      limit: 3,
    });
    assert.equal(calls[0].url, '/artist');
    assert.equal(calls[0].params.query, 'john summit');
    assert.equal(calls[0].params.limit, 3);
    assert.equal(data.artists[0].id, JOHN_SUMMIT);
    assert.equal(data.artists[0].name, 'John Summit');
    assert.equal(data.artists[0].score, 100);
  });

  it('looks up an artist with url-rels, tags and genres', async () => {
    const { mb, calls } = client();
    const artist: MbArtist = await mb.getArtist(JOHN_SUMMIT);
    assert.equal(calls[0].params.inc, 'url-rels tags genres');
    assert.equal(artist.name, 'John Summit');
    assert.ok((artist.relations ?? []).length > 0);
  });

  it('looks up a release group with its releases and a release with its tracklist', async () => {
    const { mb } = client();
    const rg: MbReleaseGroup = await mb.getReleaseGroup(CTRL_ESCAPE);
    assert.equal(rg.title, 'CTRL ESCAPE');
    assert.equal(rg['primary-type'], 'Album');
    assert.ok((rg.releases ?? []).some((r) => r.id === CTRL_ESCAPE_RELEASE));

    const release: MbRelease = await mb.getRelease(CTRL_ESCAPE_RELEASE);
    assert.equal(release.media?.[0].tracks?.length, 13);
    assert.equal(release.media?.[0].tracks?.[1].title, 'SHADES OF BLUE');
  });

  it('browses release groups by artist with a type filter', async () => {
    const { mb, calls } = client();
    const page: MbReleaseGroupBrowse = await mb.browseReleaseGroups(
      JOHN_SUMMIT,
      { types: ['album', 'ep'], limit: 8 }
    );
    assert.equal(calls[0].params.artist, JOHN_SUMMIT);
    assert.equal(calls[0].params.type, 'album|ep');
    assert.equal(calls[0].params['release-group-status'], 'website-default');
    assert.ok(page['release-groups'].length > 0);
    assert.ok(page['release-group-count'] >= page['release-groups'].length);
  });

  it('answers a repeated lookup from the cache', async () => {
    const { mb, calls } = client();
    await mb.getArtist(JOHN_SUMMIT);
    await mb.getArtist(JOHN_SUMMIT);
    assert.equal(calls.length, 1);
  });

  it('shares one in-flight request between simultaneous callers', async () => {
    const { mb, calls } = client();
    await Promise.all([mb.getArtist(JOHN_SUMMIT), mb.getArtist(JOHN_SUMMIT)]);
    assert.equal(calls.length, 1);
  });

  it('backs off and retries when MusicBrainz answers 503', async () => {
    const mb = new TestMusicBrainz('https://musicbrainz.test');
    let attempts = 0;
    mb.installAdapter(async (config) => {
      attempts++;
      if (attempts === 1) {
        throw httpError(config, 503, { error: 'rate limited' });
      }
      return {
        data: fixture('musicbrainz/artist-john-summit.json'),
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        request: {},
      };
    });
    const artist = await mb.getArtist(JOHN_SUMMIT);
    assert.equal(attempts, 2);
    assert.equal(artist.id, JOHN_SUMMIT);
  });

  it('does not retry a 404', async () => {
    const mb = new TestMusicBrainz('https://musicbrainz.test');
    let attempts = 0;
    mb.installAdapter(async (config) => {
      attempts++;
      throw httpError(config, 404, { error: 'Not Found' });
    });
    await assert.rejects(() => mb.getArtist(JOHN_SUMMIT));
    assert.equal(attempts, 1);
  });
});

describe('TokenBucket', () => {
  it('lets a burst through, then spaces requests at the configured rate', async () => {
    const bucket = new TokenBucket(20, 2);
    const started = Date.now();
    const stamps: number[] = [];
    await Promise.all(
      Array.from({ length: 5 }, () =>
        bucket.take().then(() => stamps.push(Date.now() - started))
      )
    );
    // 2 at once, then 3 more at 20/s = at least ~150 ms in total
    assert.ok(stamps[1] < 40, `burst took ${stamps[1]} ms`);
    assert.ok(stamps[4] >= 120, `5th token after ${stamps[4]} ms`);
  });

  it('holds everything while paused', async () => {
    const bucket = new TokenBucket(100, 1);
    await bucket.take();
    bucket.pause(120);
    const started = Date.now();
    await bucket.take();
    assert.ok(Date.now() - started >= 100);
  });
});
