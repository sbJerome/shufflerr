import type {
  MbArtist,
  MbRecordingSearch,
  MbRelease,
  MbReleaseGroup,
  MbReleaseGroupBrowse,
} from '@server/api/musicbrainz/interfaces';
import { MediaStatus } from '@server/constants/media';
import {
  pickCanonicalRelease,
  releaseTrackCount,
} from '@server/lib/metadata/canonical';
import { flattenRelease, isMbid } from '@server/lib/metadata/index';
import {
  bestReleaseGroupOf,
  creditString,
  mapArtist,
  mapRecording,
  mapReleaseGroup,
  mapUrlRelations,
} from '@server/lib/metadata/mappers';
import { getSettings } from '@server/lib/settings';
import { fixture } from '@server/test/fixtureAdapter';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const release = (
  id: string,
  over: Partial<MbRelease> & { tracks?: number; format?: string } = {}
): MbRelease => ({
  id,
  title: 'Album',
  status: 'Official',
  date: '2020-01-01',
  country: 'US',
  media: [{ format: over.format ?? 'CD', 'track-count': over.tracks ?? 10 }],
  ...over,
});

describe('pickCanonicalRelease', () => {
  it('returns null without releases', () => {
    assert.equal(pickCanonicalRelease(undefined), null);
    assert.equal(pickCanonicalRelease([]), null);
  });

  it('uses the preferred release when it belongs to the group', () => {
    const picked = pickCanonicalRelease(
      [release('a'), release('b', { date: '2021-01-01' })],
      { preferReleaseMbid: 'b' }
    );
    assert.equal(picked?.id, 'b');
  });

  it('ignores a preferred release from another group', () => {
    const picked = pickCanonicalRelease([release('a')], {
      preferReleaseMbid: 'zzz',
    });
    assert.equal(picked?.id, 'a');
  });

  it('prefers official releases over earlier bootlegs and promos', () => {
    const picked = pickCanonicalRelease([
      release('boot', { status: 'Bootleg', date: '2019-01-01' }),
      release('promo', { status: 'Promotion', date: '2019-06-01' }),
      release('official', { date: '2020-03-01' }),
    ]);
    assert.equal(picked?.id, 'official');
  });

  it('falls back to any release when none is official', () => {
    const picked = pickCanonicalRelease([
      release('b', { status: 'Bootleg', date: '2019-06-01' }),
      release('a', { status: 'Bootleg', date: '2019-01-01' }),
    ]);
    assert.equal(picked?.id, 'a');
  });

  it('picks the earliest official release, a full date before a bare year', () => {
    const picked = pickCanonicalRelease([
      release('deluxe', { date: '2021-05-01', tracks: 18 }),
      release('year-only', { date: '2020' }),
      release('original', { date: '2020-02-14' }),
      release('undated', { date: undefined }),
    ]);
    assert.equal(picked?.id, 'original');
  });

  it('breaks a date tie with digital, then worldwide, then most tracks', () => {
    assert.equal(
      pickCanonicalRelease([
        release('cd'),
        release('digital', { format: 'Digital Media' }),
      ])?.id,
      'digital'
    );
    assert.equal(
      pickCanonicalRelease([
        release('us'),
        release('xw', { country: 'XW' }),
        release('de', { country: 'DE' }),
      ])?.id,
      'xw'
    );
    assert.equal(
      pickCanonicalRelease([
        release('ten'),
        release('twelve', { tracks: 12 }),
      ])?.id,
      'twelve'
    );
  });

  it('prefers the home country, then the country most editions share', () => {
    const releases = [
      release('jp', { country: 'JP' }),
      release('gb1', { country: 'GB' }),
      release('gb2', { country: 'GB' }),
    ];
    assert.equal(
      pickCanonicalRelease(releases, { preferCountry: 'JP' })?.id,
      'jp'
    );
    assert.equal(pickCanonicalRelease(releases)?.id, 'gb1');
  });

  it('is deterministic for the recorded CTRL ESCAPE release group', () => {
    const rg = fixture<MbReleaseGroup>(
      'musicbrainz/release-group-ctrl-escape.json'
    );
    const picked = pickCanonicalRelease(rg.releases);
    assert.equal(picked?.id, '2555fe96-7bde-4b6d-92ae-9ee09ffe71d4');
    assert.equal(releaseTrackCount(picked as MbRelease), 13);
    assert.equal(
      pickCanonicalRelease([...(rg.releases ?? [])].reverse())?.id,
      picked?.id
    );
  });
});

describe('flattenRelease', () => {
  it('turns the recorded CTRL ESCAPE release into 13 numbered tracks', () => {
    const tracks = flattenRelease(
      fixture<MbRelease>('musicbrainz/release-ctrl-escape.json')
    );
    assert.equal(tracks.length, 13);
    assert.deepEqual(
      tracks.map((t) => t.position),
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13']
    );
    assert.equal(tracks[1].title, 'SHADES OF BLUE');
    assert.equal(tracks[1].artistCredit, 'John Summit, Devault & Julia Church');
    assert.equal(tracks[1].recordingMbid, '6ea95e5d-1d83-43f0-91b2-3aa6b91cc278');
    assert.equal(tracks[1].lengthMs, 203000);
    assert.ok(tracks.every((t) => t.discNumber === 1));
  });

  it('prefixes the disc number on multi-disc releases', () => {
    const track = (position: number, title: string) => ({
      id: `${title}-id`,
      position,
      title,
      length: 1000,
      recording: { id: `${title}-rec`, title },
    });
    const tracks = flattenRelease({
      id: 'r',
      title: 'Two discs',
      media: [
        { position: 1, tracks: [track(1, 'a'), track(2, 'b')] },
        { position: 2, tracks: [track(1, 'c')] },
      ],
    });
    assert.deepEqual(
      tracks.map((t) => t.position),
      ['1-01', '1-02', '2-01']
    );
    assert.equal(tracks[2].discNumber, 2);
  });
});

describe('MusicBrainz mappers', () => {
  it('maps an artist lookup', () => {
    const artist = mapArtist(
      fixture<MbArtist>('musicbrainz/artist-john-summit.json')
    );
    assert.equal(artist.mbid, '2547c5e3-314c-4332-981d-f18c902a4086');
    assert.equal(artist.name, 'John Summit');
    assert.equal(artist.type, 'Person');
    assert.equal(artist.imageUrl, null);
    assert.equal(artist.status, MediaStatus.UNKNOWN);
    assert.ok(artist.tags?.includes('house'));
  });

  it('maps a release group with a proxied cover', () => {
    const album = mapReleaseGroup(
      fixture<MbReleaseGroup>('musicbrainz/release-group-ctrl-escape.json')
    );
    assert.equal(album.title, 'CTRL ESCAPE');
    assert.equal(album.artistName, 'John Summit');
    assert.equal(album.artistMbid, '2547c5e3-314c-4332-981d-f18c902a4086');
    assert.equal(album.primaryType, 'Album');
    assert.equal(album.year, 2026);
    assert.equal(
      album.coverUrl,
      '/imageproxy/caa/release-group/324f381f-ebef-4003-8885-c06659395d8b/front-500'
    );
  });

  it('returns no cover when Cover Art Archive is off', () => {
    const settings = getSettings();
    settings.metadata.coverArtArchive.enabled = false;
    try {
      const [first] = fixture<MbReleaseGroupBrowse>(
        'musicbrainz/release-group-browse-john-summit.json'
      )['release-groups'];
      assert.equal(mapReleaseGroup(first).coverUrl, null);
    } finally {
      settings.metadata.coverArtArchive.enabled = true;
    }
  });

  it('maps a recording to the album it is best shown under', () => {
    const search = fixture<MbRecordingSearch>(
      'musicbrainz/recording-search-shades-of-blue.json'
    );
    const recording = search.recordings.find(
      (r) => r.id === '6ea95e5d-1d83-43f0-91b2-3aa6b91cc278'
    );
    assert.ok(recording, 'fixture holds the album recording');
    const track = mapRecording(recording);
    assert.equal(track.title, 'SHADES OF BLUE');
    assert.equal(track.artistName, 'John Summit, Devault & Julia Church');
    assert.equal(track.playable, false);
    assert.equal(bestReleaseGroupOf(recording)?.['primary-type'], 'Album');
    assert.equal(track.album?.title, 'CTRL ESCAPE');
  });

  it('joins artist credits with their join phrases', () => {
    assert.equal(
      creditString([
        { name: 'A', joinphrase: ' feat. ', artist: { id: '1', name: 'A' } },
        { name: 'B', artist: { id: '2', name: 'B' } },
      ]),
      'A feat. B'
    );
    assert.equal(creditString(undefined), '');
  });

  it('keeps one outbound link per known site and drops ended ones', () => {
    const links = mapUrlRelations([
      { type: 'discogs', url: { resource: 'https://www.discogs.com/artist/1' } },
      { type: 'discogs', url: { resource: 'https://www.discogs.com/artist/2' } },
      { type: 'official homepage', url: { resource: 'https://example.test/' } },
      {
        type: 'official homepage',
        ended: true,
        url: { resource: 'https://old.example.test/' },
      },
      { type: 'youtube', url: { resource: 'https://www.youtube.com/x' } },
    ]);
    assert.deepEqual(links, [
      { type: 'discogs', url: 'https://www.discogs.com/artist/1' },
      { type: 'official', url: 'https://example.test/' },
    ]);
  });

  it('recognises MusicBrainz IDs', () => {
    assert.ok(isMbid('2547c5e3-314c-4332-981d-f18c902a4086'));
    assert.ok(!isMbid('not-an-id'));
    assert.ok(!isMbid(undefined));
  });
});
