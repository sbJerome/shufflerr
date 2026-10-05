import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, beforeEach, describe, it } from 'node:test';

import type { Recorded, SeededLibrary } from '@server/clientapi/testSupport';
import {
  ALBUM_ONE_MBID,
  FAKE_IMAGE,
  createClientApiApp,
  enableClientApis,
  installRecorders,
  seedLibrary,
} from '@server/clientapi/testSupport';
import { getRepository } from '@server/datasource';
import ScrobbleQueue from '@server/entity/ScrobbleQueue';
import { revokeAppPassword } from '@server/lib/auth/appPasswords';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import request from 'supertest';

let app: Express;
let lib: SeededLibrary;
let recorded: Recorded;

before(() => {
  app = createClientApiApp();
});

setupTestDb();

beforeEach(async () => {
  enableClientApis();
  recorded = installRecorders();
  lib = await seedLibrary();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const auth = () => ({
  u: 'admin',
  p: lib.adminPassword,
  c: 'contract-test',
  v: '1.16.1',
  f: 'json',
});

const call = async (
  method: string,
  query: Record<string, unknown> = {},
  credentials: Record<string, unknown> = auth()
): Promise<Json> => {
  const res = await request(app)
    .get(`/rest/${method}`)
    .query({ ...credentials, ...query });
  assert.equal(res.status, 200);
  return res.body['subsonic-response'];
};

const expectError = (body: Json, code: number) => {
  assert.equal(body.status, 'failed');
  assert.equal(body.error.code, code);
  assert.ok(body.error.message);
};

describe('OpenSubsonic: envelope and sign-in', () => {
  it('answers in XML by default, with the OpenSubsonic envelope', async () => {
    const res = await request(app)
      .get('/rest/ping.view')
      .query({ u: 'admin', p: lib.adminPassword, c: 't', v: '1.16.1' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /xml/);
    assert.match(res.text, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(res.text, /<subsonic-response [^>]*status="ok"/);
    assert.match(res.text, /xmlns="http:\/\/subsonic\.org\/restapi"/);
    assert.match(res.text, /version="1\.16\.1"/);
    assert.match(res.text, /type="shufflerr"/);
    assert.match(res.text, /openSubsonic="true"/);
    assert.match(res.text, /serverVersion="[^"]+"/);
  });

  it('answers in JSON with f=json', async () => {
    const body = await call('ping');
    assert.equal(body.status, 'ok');
    assert.equal(body.version, '1.16.1');
    assert.equal(body.type, 'shufflerr');
    assert.equal(body.openSubsonic, true);
    assert.ok(body.serverVersion);
  });

  it('supports jsonp', async () => {
    const res = await request(app)
      .get('/rest/ping')
      .query({ ...auth(), f: 'jsonp', callback: 'cb' });
    assert.match(res.text, /^cb\(\{"subsonic-response":/);
  });

  it('accepts a hex-encoded password', async () => {
    const body = await call(
      'ping',
      {},
      {
        u: 'admin',
        p: 'enc:' + Buffer.from(lib.adminPassword).toString('hex'),
        f: 'json',
      }
    );
    assert.equal(body.status, 'ok');
  });

  it('accepts token + salt', async () => {
    const s = 'c19b2d';
    const t = createHash('md5')
      .update(lib.adminPassword + s)
      .digest('hex');
    const body = await call('ping', {}, { u: 'admin', t, s, f: 'json' });
    assert.equal(body.status, 'ok');
  });

  it('accepts the email address as the username', async () => {
    const body = await call(
      'ping',
      {},
      { u: 'admin@shufflerr.test', p: lib.adminPassword, f: 'json' }
    );
    assert.equal(body.status, 'ok');
  });

  it('accepts an API key (apiKeyAuthentication extension)', async () => {
    const body = await call(
      'tokenInfo',
      {},
      { apiKey: lib.demoPassword, f: 'json' }
    );
    assert.equal(body.status, 'ok');
    assert.equal(body.tokenInfo.username, 'demo');
  });

  it('accepts parameters from a form POST (formPost extension)', async () => {
    const res = await request(app)
      .post('/rest/getSong.view')
      .type('form')
      .send({ ...auth(), id: `tr-${lib.tracksOne[0].id}` });
    assert.equal(res.status, 200);
    assert.equal(res.body['subsonic-response'].song.title, 'Closing Time');
  });

  it('reports wrong credentials as error 40, in XML too', async () => {
    expectError(
      await call('ping', {}, { u: 'admin', p: 'wrong', f: 'json' }),
      40
    );
    expectError(
      await call(
        'ping',
        {},
        { u: 'admin', t: 'deadbeef', s: 'abc', f: 'json' }
      ),
      40
    );
    expectError(
      await call('ping', {}, { u: 'nobody', p: lib.adminPassword, f: 'json' }),
      40
    );

    const res = await request(app)
      .get('/rest/ping')
      .query({ u: 'admin', p: 'wrong' });
    assert.equal(res.status, 200);
    assert.match(res.text, /status="failed"/);
    assert.match(res.text, /<error code="40" message="[^"]+"\/>/);
  });

  it('does not accept the account password, or another user’s app password', async () => {
    expectError(
      await call('ping', {}, { u: 'admin', p: 'test1234', f: 'json' }),
      40
    );
    expectError(
      await call('ping', {}, { u: 'admin', p: lib.demoPassword, f: 'json' }),
      40
    );
  });

  it('reports missing credentials as error 10', async () => {
    expectError(await call('ping', {}, { f: 'json' }), 10);
    expectError(await call('ping', {}, { u: 'admin', f: 'json' }), 10);
  });

  it('reports API key problems as 44 and 43', async () => {
    expectError(await call('ping', {}, { apiKey: 'nope', f: 'json' }), 44);
    expectError(
      await call(
        'ping',
        {},
        { apiKey: lib.adminPassword, u: 'admin', f: 'json' }
      ),
      43
    );
  });

  it('stops accepting a revoked app password straight away', async () => {
    assert.equal((await call('ping')).status, 'ok');
    await revokeAppPassword(lib.admin.id, lib.adminAppPasswordId);
    expectError(await call('ping'), 40);
  });

  it('lists extensions without credentials', async () => {
    const body = await call('getOpenSubsonicExtensions', {}, { f: 'json' });
    assert.equal(body.status, 'ok');
    const names = body.openSubsonicExtensions.map((e: Json) => e.name);
    assert.deepEqual(names.sort(), [
      'apiKeyAuthentication',
      'formPost',
      'songLyrics',
    ]);
  });

  it('reports unknown calls as a generic error', async () => {
    expectError(await call('jukeboxControl'), 0);
  });

  it('is a 404 when the API is switched off', async () => {
    enableClientApis({ openSubsonic: false });
    const res = await request(app).get('/rest/ping').query(auth());
    assert.equal(res.status, 404);
  });
});

describe('OpenSubsonic: browsing', () => {
  it('getLicense, getMusicFolders, getUser, getScanStatus, getGenres', async () => {
    assert.equal((await call('getLicense')).license.valid, true);
    assert.deepEqual((await call('getMusicFolders')).musicFolders.musicFolder, [
      { id: 1, name: 'Music' },
    ]);

    const user = (await call('getUser', { username: 'admin' })).user;
    assert.equal(user.username, 'admin');
    assert.equal(user.adminRole, true);
    assert.equal(user.streamRole, true);
    assert.equal(user.downloadRole, true);
    expectError(await call('getUser', { username: 'demo' }), 50);

    assert.deepEqual((await call('getScanStatus')).scanStatus, {
      scanning: false,
      count: 6,
    });
    assert.deepEqual((await call('getGenres')).genres.genre, []);
  });

  it('getArtists groups album artists by letter and ignores articles', async () => {
    const body = await call('getArtists');
    assert.ok(body.artists.ignoredArticles.includes('The'));
    const letters = body.artists.index.map((i: Json) => i.name);
    assert.deepEqual(letters, ['B', 'N']);

    const night = body.artists.index[1].artist[0];
    assert.equal(night.id, `ar-${lib.artist.id}`);
    assert.equal(night.name, 'The Night Shift');
    assert.equal(night.albumCount, 2);

    const collective = body.artists.index[0].artist[0];
    assert.match(collective.id, /^ar-x[0-9a-f]{24}$/);
    assert.equal(collective.albumCount, 1);
  });

  it('getIndexes mirrors the artist index', async () => {
    const body = await call('getIndexes');
    assert.equal(body.indexes.index.length, 2);
    assert.equal(typeof body.indexes.lastModified, 'number');
  });

  it('getArtist lists the albums, oldest first', async () => {
    const body = await call('getArtist', { id: `ar-${lib.artist.id}` });
    assert.equal(body.artist.name, 'The Night Shift');
    assert.deepEqual(
      body.artist.album.map((a: Json) => a.name),
      ['After Hours', 'Zero Hour']
    );

    const index = (await call('getArtists')).artists.index[0].artist[0];
    const byName = await call('getArtist', { id: index.id });
    assert.equal(byName.artist.album[0].name, 'Live at the Depot');
  });

  it('getAlbum only lists tracks that are available and playable', async () => {
    const body = await call('getAlbum', { id: `al-${lib.albumOne.id}` });
    const album = body.album;
    assert.equal(album.id, `al-${lib.albumOne.id}`);
    assert.equal(album.name, 'After Hours');
    assert.equal(album.artist, 'The Night Shift');
    assert.equal(album.artistId, `ar-${lib.artist.id}`);
    assert.equal(album.year, 2021);
    assert.equal(album.songCount, 3);
    assert.equal(album.musicBrainzId, ALBUM_ONE_MBID);
    assert.equal(album.coverArt, `al-${lib.albumOne.id}`);
    assert.equal(album.duration, 181 + 182 + 183);
    assert.ok(!Number.isNaN(Date.parse(album.created)));

    assert.deepEqual(
      album.song.map((s: Json) => s.title),
      ['Closing Time', 'Last Train Home', 'Streetlights']
    );
    const [first, second, third] = album.song;
    assert.equal(first.id, `tr-${lib.tracksOne[0].id}`);
    assert.equal(first.parent, album.id);
    assert.equal(first.albumId, album.id);
    assert.equal(first.artistId, `ar-${lib.artist.id}`);
    assert.equal(first.track, 1);
    assert.equal(first.discNumber, 1);
    assert.equal(first.duration, 181);
    assert.equal(first.suffix, 'flac');
    assert.equal(first.contentType, 'audio/flac');
    assert.equal(first.bitDepth, 16);
    assert.equal(first.samplingRate, 44100);
    assert.equal(first.isDir, false);
    assert.equal(first.type, 'music');
    assert.equal(first.musicBrainzId, lib.tracksOne[0].recordingMbid);
    assert.equal(second.artist, 'The Night Shift, Mara Vale');
    assert.equal(third.suffix, 'mp3');
    assert.equal(third.contentType, 'audio/mpeg');
    assert.equal(third.bitRate, 320);
  });

  it('getAlbum in XML uses attributes and repeated song elements', async () => {
    const res = await request(app)
      .get('/rest/getAlbum')
      .query({ ...auth(), f: 'xml', id: `al-${lib.albumOne.id}` });
    assert.match(
      res.text,
      new RegExp(`<album id="al-${lib.albumOne.id}"[^>]* name="After Hours"`)
    );
    assert.equal(res.text.match(/<song /g)?.length, 3);
    assert.match(res.text, /<song [^>]*title="Closing Time"/);
    assert.ok(!res.text.includes('Sunrise'));
  });

  it('getSong, and 70 / 10 for unknown or missing ids', async () => {
    const body = await call('getSong', { id: `tr-${lib.tracksTwo[1].id}` });
    assert.equal(body.song.title, 'Zero');
    assert.equal(body.song.album, 'Zero Hour');
    assert.equal(body.song.year, 2024);

    expectError(await call('getSong', { id: 'tr-999999' }), 70);
    expectError(await call('getSong', { id: `tr-${lib.missingTrack.id}` }), 70);
    expectError(
      await call('getSong', { id: `tr-${lib.unplayableTrack.id}` }),
      70
    );
    expectError(await call('getSong'), 10);
    expectError(await call('getAlbum', { id: 'al-999999' }), 70);
    expectError(await call('getArtist', { id: 'nonsense' }), 70);
  });

  it('getMusicDirectory walks artist → album → songs', async () => {
    const artist = await call('getMusicDirectory', {
      id: `ar-${lib.artist.id}`,
    });
    assert.equal(artist.directory.child.length, 2);
    assert.equal(artist.directory.child[0].isDir, true);

    const album = await call('getMusicDirectory', {
      id: artist.directory.child[0].id,
    });
    assert.equal(album.directory.child.length, 3);
    assert.equal(album.directory.child[0].isDir, false);
  });

  it('getAlbumList2 sorts and pages', async () => {
    const newest = await call('getAlbumList2', { type: 'newest' });
    assert.deepEqual(
      newest.albumList2.album.map((a: Json) => a.name),
      ['Live at the Depot', 'Zero Hour', 'After Hours']
    );

    const page = await call('getAlbumList2', {
      type: 'alphabeticalByName',
      size: 1,
      offset: 1,
    });
    assert.deepEqual(
      page.albumList2.album.map((a: Json) => a.name),
      ['Live at the Depot']
    );

    const byArtist = await call('getAlbumList2', {
      type: 'alphabeticalByArtist',
    });
    assert.equal(byArtist.albumList2.album[0].name, 'Live at the Depot');

    const byYear = await call('getAlbumList2', {
      type: 'byYear',
      fromYear: 2030,
      toYear: 2000,
    });
    assert.deepEqual(
      byYear.albumList2.album.map((a: Json) => a.year),
      [2024, 2021]
    );

    const random = await call('getAlbumList2', { type: 'random', size: 2 });
    assert.equal(random.albumList2.album.length, 2);

    // Nothing has been played or starred yet: these lists are empty, not padded.
    for (const type of ['recent', 'frequent', 'starred', 'highest']) {
      const body = await call('getAlbumList2', { type });
      assert.deepEqual(body.albumList2.album, [], type);
    }
    assert.deepEqual(
      (await call('getAlbumList2', { type: 'byGenre', genre: 'House' }))
        .albumList2.album,
      []
    );

    expectError(await call('getAlbumList2'), 10);
    expectError(await call('getAlbumList2', { type: 'bogus' }), 0);
    assert.equal(
      (await call('getAlbumList', { type: 'newest' })).albumList.album.length,
      3
    );
  });

  it('getRandomSongs honours size and year filters', async () => {
    const all = await call('getRandomSongs', { size: 100 });
    assert.equal(all.randomSongs.song.length, 6);
    const two = await call('getRandomSongs', { size: 2 });
    assert.equal(two.randomSongs.song.length, 2);
    const old = await call('getRandomSongs', { toYear: 2000 });
    assert.deepEqual(
      old.randomSongs.song.map((s: Json) => s.title),
      ['Depot Jam']
    );
  });

  it('search3 matches artists, albums and songs, and pages', async () => {
    const body = await call('search3', { query: 'night' });
    assert.equal(body.searchResult3.artist.length, 1);
    assert.equal(body.searchResult3.album.length, 2);
    assert.equal(body.searchResult3.song.length, 5);

    const song = await call('search3', { query: 'last train' });
    assert.deepEqual(
      song.searchResult3.song.map((s: Json) => s.title),
      ['Last Train Home']
    );

    // An empty query is how apps sync the whole library.
    const everything = await call('search3', {
      query: '""',
      songCount: 4,
      songOffset: 4,
      albumCount: 500,
      artistCount: 500,
    });
    assert.equal(everything.searchResult3.artist.length, 2);
    assert.equal(everything.searchResult3.album.length, 3);
    assert.equal(everything.searchResult3.song.length, 2);

    const none = await call('search2', { query: 'no such thing' });
    assert.deepEqual(none.searchResult2, { artist: [], album: [], song: [] });
  });

  it('getLyricsBySongId returns an empty structured list', async () => {
    const body = await call('getLyricsBySongId', {
      id: `tr-${lib.tracksOne[0].id}`,
    });
    assert.deepEqual(body.lyricsList.structuredLyrics, []);
  });
});

describe('OpenSubsonic: stars and playlists', () => {
  it('stars and unstars songs, albums and artists per user', async () => {
    const song = `tr-${lib.tracksOne[1].id}`;
    const album = `al-${lib.albumTwo.id}`;
    const artist = `ar-${lib.artist.id}`;

    assert.equal(
      (await call('star', { id: song, albumId: album, artistId: artist }))
        .status,
      'ok'
    );
    // Starring twice is harmless.
    assert.equal((await call('star', { id: song })).status, 'ok');

    const starred = (await call('getStarred2')).starred2;
    assert.deepEqual(
      starred.song.map((s: Json) => s.id),
      [song]
    );
    assert.deepEqual(
      starred.album.map((a: Json) => a.id),
      [album]
    );
    assert.deepEqual(
      starred.artist.map((a: Json) => a.id),
      [artist]
    );
    assert.ok(!Number.isNaN(Date.parse(starred.song[0].starred)));

    assert.ok((await call('getSong', { id: song })).song.starred);
    assert.deepEqual(
      (await call('getAlbumList2', { type: 'starred' })).albumList2.album.map(
        (a: Json) => a.id
      ),
      [album]
    );

    // Another user has their own stars.
    const demo = { u: 'demo', p: lib.demoPassword, f: 'json' };
    assert.deepEqual((await call('getStarred2', {}, demo)).starred2.song, []);

    await call('unstar', { id: [song, album] });
    const after = (await call('getStarred')).starred;
    assert.deepEqual(after.song, []);
    assert.deepEqual(after.album, []);
    assert.equal(after.artist.length, 1);

    expectError(await call('star'), 10);
    expectError(await call('star', { id: 'tr-999999' }), 70);
  });

  it('runs the playlist lifecycle', async () => {
    const [a, b, c] = lib.tracksOne.map((t) => `tr-${t.id}`);
    const d = `tr-${lib.tracksTwo[0].id}`;

    const created = await call('createPlaylist', {
      name: 'Late drive',
      songId: [a, b],
    });
    const id = created.playlist.id;
    assert.match(id, /^pl-\d+$/);
    assert.equal(created.playlist.name, 'Late drive');
    assert.equal(created.playlist.owner, 'admin');
    assert.equal(created.playlist.songCount, 2);
    assert.deepEqual(
      created.playlist.entry.map((e: Json) => e.id),
      [a, b]
    );

    const list = await call('getPlaylists');
    assert.equal(list.playlists.playlist.length, 1);
    assert.equal(list.playlists.playlist[0].songCount, 2);
    assert.equal(list.playlists.playlist[0].entry, undefined);

    await call('updatePlaylist', {
      playlistId: id,
      name: 'Later drive',
      comment: 'windows down',
      songIdToAdd: [c, d],
      songIndexToRemove: 0,
    });
    const updated = (await call('getPlaylist', { id })).playlist;
    assert.equal(updated.name, 'Later drive');
    assert.equal(updated.comment, 'windows down');
    assert.deepEqual(
      updated.entry.map((e: Json) => e.id),
      [b, c, d]
    );
    assert.equal(updated.duration, 182 + 183 + 181);

    // createPlaylist with playlistId replaces the contents.
    await call('createPlaylist', { playlistId: id, songId: [d] });
    assert.deepEqual(
      (await call('getPlaylist', { id })).playlist.entry.map((e: Json) => e.id),
      [d]
    );

    // Private playlists are invisible to other users, public ones are read-only.
    const demo = { u: 'demo', p: lib.demoPassword, f: 'json' };
    assert.deepEqual(
      (await call('getPlaylists', {}, demo)).playlists.playlist,
      []
    );
    expectError(await call('getPlaylist', { id }, demo), 70);
    await call('updatePlaylist', { playlistId: id, public: true });
    assert.equal(
      (await call('getPlaylist', { id }, demo)).playlist.public,
      true
    );
    expectError(
      await call('updatePlaylist', { playlistId: id, name: 'mine now' }, demo),
      50
    );
    expectError(await call('deletePlaylist', { id }, demo), 50);

    assert.equal((await call('deletePlaylist', { id })).status, 'ok');
    assert.deepEqual((await call('getPlaylists')).playlists.playlist, []);
    expectError(await call('getPlaylist', { id }), 70);
    expectError(await call('createPlaylist'), 10);
  });
});

describe('OpenSubsonic: playback', () => {
  it('stream hands the track to the shared streamer, Range included', async () => {
    const res = await request(app)
      .get('/rest/stream.view')
      .set('Range', 'bytes=0-3')
      .query({ ...auth(), id: `tr-${lib.tracksOne[0].id}` });
    assert.equal(res.status, 206);
    assert.equal(res.headers['content-range'], 'bytes 0-3/22');
    assert.deepEqual(recorded.streams, [
      { trackId: lib.tracksOne[0].id, options: {}, range: 'bytes=0-3' },
    ]);
  });

  it('stream maps format and maxBitRate', async () => {
    await request(app)
      .get('/rest/stream')
      .query({
        ...auth(),
        id: `tr-${lib.tracksOne[0].id}`,
        format: 'mp3',
        maxBitRate: 128,
      });
    await request(app)
      .get('/rest/stream')
      .query({ ...auth(), id: `tr-${lib.tracksOne[0].id}`, format: 'raw' });
    await request(app)
      .get('/rest/stream')
      .query({ ...auth(), id: `tr-${lib.tracksOne[0].id}`, format: 'opus' });
    assert.deepEqual(
      recorded.streams.map((s) => s.options),
      [
        { format: 'mp3', maxBitRate: 128 },
        { format: 'raw' },
        { format: 'opus' },
      ]
    );
  });

  it('stream reports unknown tracks as 70 and needs credentials', async () => {
    expectError(await call('stream', { id: 'tr-424242' }), 70);
    expectError(
      await call('stream', { id: `tr-${lib.tracksOne[0].id}` }, { f: 'json' }),
      10
    );
    assert.equal(recorded.streams.length, 0);
  });

  it('download follows the "allow downloads" switch', async () => {
    const ok = await request(app)
      .get('/rest/download')
      .query({ ...auth(), id: `tr-${lib.tracksOne[0].id}` });
    assert.equal(ok.status, 200);
    assert.deepEqual(recorded.streams[0].options, {
      download: true,
      format: 'raw',
    });

    enableClientApis({ allowDownloads: false });
    expectError(
      await call('download', { id: `tr-${lib.tracksOne[0].id}` }),
      50
    );
    assert.equal((await call('getUser')).user.downloadRole, false);
    assert.equal(recorded.streams.length, 1);
  });

  it('getCoverArt serves image bytes for albums, songs and playlists', async () => {
    const res = await request(app)
      .get('/rest/getCoverArt')
      .query({ ...auth(), id: `al-${lib.albumOne.id}`, size: 300 })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.deepEqual(res.body, FAKE_IMAGE);
    assert.deepEqual(recorded.covers, [
      `/release-group/${ALBUM_ONE_MBID}/front-500`,
    ]);

    const song = await request(app)
      .get('/rest/getCoverArt')
      .query({ ...auth(), id: `tr-${lib.tracksOne[2].id}`, size: 100 });
    assert.equal(song.headers['content-type'], 'image/jpeg');
    assert.equal(
      recorded.covers[1],
      `/release-group/${ALBUM_ONE_MBID}/front-250`
    );

    // No cover upstream, or an artist id: a Subsonic "not found".
    expectError(await call('getCoverArt', { id: `al-${lib.albumTwo.id}` }), 70);
    expectError(await call('getCoverArt', { id: `ar-${lib.artist.id}` }), 70);
    expectError(await call('getCoverArt'), 10);
  });

  it('scrobble feeds the scrobble pipeline as source "apps"', async () => {
    const id = `tr-${lib.tracksOne[1].id}`;

    await call('scrobble', { id, submission: false });
    assert.equal(recorded.nowPlaying.length, 1);
    assert.equal(recorded.nowPlaying[0].source, 'apps');
    assert.equal(recorded.nowPlaying[0].trackId, lib.tracksOne[1].id);
    assert.equal(recorded.plays.length, 0);

    const playing = (await call('getNowPlaying')).nowPlaying.entry;
    assert.equal(playing.length, 1);
    assert.equal(playing[0].id, id);
    assert.equal(playing[0].username, 'admin');
    assert.equal(playing[0].playerName, 'contract-test');

    const at = Date.UTC(2026, 5, 1, 12, 0, 0);
    await call('scrobble', { id, time: at });
    assert.equal(recorded.plays.length, 1);
    const play = recorded.plays[0];
    assert.equal(play.source, 'apps');
    assert.equal(play.user.id, lib.admin.id);
    assert.equal(play.trackId, lib.tracksOne[1].id);
    assert.equal(play.track, 'Last Train Home');
    assert.equal(play.artist, 'The Night Shift, Mara Vale');
    assert.equal(play.album, 'After Hours');
    assert.equal(play.releaseGroupMbid, ALBUM_ONE_MBID);
    assert.equal(play.recordingMbid, lib.tracksOne[1].recordingMbid);
    assert.equal(play.durationMs, 182000);
    assert.equal(play.startedAt.getTime(), at);
    assert.equal(play.playedSeconds, 182);

    // The finished track is no longer "now playing".
    assert.deepEqual((await call('getNowPlaying')).nowPlaying.entry, []);

    expectError(await call('scrobble', { id: 'tr-999999' }), 70);
    expectError(await call('scrobble'), 10);
  });
});

describe('OpenSubsonic: play history', () => {
  it('recent / frequent lists and play counts come from the play history', async () => {
    const plays = getRepository(ScrobbleQueue);
    const play = (trackId: number, user: SeededLibrary['admin'], at: string) =>
      plays.save(
        new ScrobbleQueue({
          user,
          trackId,
          artist: 'The Night Shift',
          track: 'x',
          playedAt: new Date(at),
          source: 'apps',
          targets: {},
        })
      );
    await play(lib.tracksOne[0].id, lib.admin, '2026-06-01T10:00:00Z');
    await play(lib.tracksOne[0].id, lib.admin, '2026-06-02T10:00:00Z');
    await play(lib.tracksOne[1].id, lib.admin, '2026-06-03T10:00:00Z');
    await play(lib.tracksTwo[0].id, lib.admin, '2026-06-04T10:00:00Z');
    await play(lib.tracksThree[0].id, lib.demo, '2026-06-05T10:00:00Z');

    const frequent = await call('getAlbumList2', { type: 'frequent' });
    assert.deepEqual(
      frequent.albumList2.album.map((a: Json) => [a.name, a.playCount]),
      [
        ['After Hours', 3],
        ['Zero Hour', 1],
      ]
    );
    const recent = await call('getAlbumList2', { type: 'recent' });
    assert.deepEqual(
      recent.albumList2.album.map((a: Json) => a.name),
      ['Zero Hour', 'After Hours']
    );

    const song = (await call('getSong', { id: `tr-${lib.tracksOne[0].id}` }))
      .song;
    assert.equal(song.playCount, 2);
    assert.equal(song.played, '2026-06-02T10:00:00.000Z');

    const top = await call('getTopSongs', { artist: 'the night shift' });
    assert.deepEqual(
      top.topSongs.song.map((s: Json) => s.title),
      ['Closing Time', 'Last Train Home', 'Countdown']
    );
  });
});
