import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import {
  albumItemId,
  artistItemId,
  parseItemId,
  playlistItemId,
  trackItemId,
  userItemId,
  VIEW_ID,
} from '@server/clientapi/jellyfin/ids';
import type { Recorded, SeededLibrary } from '@server/clientapi/testSupport';
import {
  ALBUM_ONE_MBID,
  ARTIST_MBID,
  createClientApiApp,
  enableClientApis,
  FAKE_IMAGE,
  installRecorders,
  seedLibrary,
} from '@server/clientapi/testSupport';
import { revokeAppPassword } from '@server/lib/auth/appPasswords';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import request from 'supertest';

let app: Express;
let lib: SeededLibrary;
let recorded: Recorded;
let token: string;

before(() => {
  app = createClientApiApp();
});

setupTestDb();

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CLIENT_HEADER =
  'MediaBrowser Client="Finamp", Device="Pixel", DeviceId="dev-1", Version="0.9.0"';

const signIn = async (username: string, password: string) =>
  request(app)
    .post('/jellyfin/Users/AuthenticateByName')
    .set('Authorization', CLIENT_HEADER)
    .send({ Username: username, Pw: password });

const authHeader = (t = token) => `${CLIENT_HEADER}, Token="${t}"`;

const get = (path: string, query: Record<string, unknown> = {}) =>
  request(app)
    .get(`/jellyfin${path}`)
    .set('Authorization', authHeader())
    .query(query);

const post = (path: string, body?: Json, query: Record<string, unknown> = {}) =>
  request(app)
    .post(`/jellyfin${path}`)
    .set('Authorization', authHeader())
    .query(query)
    .send(body);

const del = (path: string, query: Record<string, unknown> = {}) =>
  request(app)
    .delete(`/jellyfin${path}`)
    .set('Authorization', authHeader())
    .query(query);

beforeEach(async () => {
  enableClientApis();
  recorded = installRecorders();
  lib = await seedLibrary();
  const res = await signIn('admin', lib.adminPassword);
  assert.equal(res.status, 200);
  token = res.body.AccessToken;
});

describe('Jellyfin API: server info and sign-in', () => {
  it('ids are 32 hex digits and round-trip', () => {
    for (const id of [
      albumItemId(7),
      trackItemId(123456),
      playlistItemId(3),
      userItemId(1),
      artistItemId('m42'),
      artistItemId('x0123456789abcdef01234567'),
      VIEW_ID,
    ]) {
      assert.match(id, /^[0-9a-f]{32}$/);
    }
    assert.deepEqual(parseItemId(albumItemId(7)), { kind: 'album', id: 7 });
    assert.deepEqual(parseItemId(trackItemId(123456)), {
      kind: 'track',
      id: 123456,
    });
    assert.deepEqual(parseItemId(artistItemId('m42')), {
      kind: 'artist',
      key: 'm42',
    });
    assert.deepEqual(parseItemId(artistItemId('x0123456789abcdef01234567')), {
      kind: 'artist',
      key: 'x0123456789abcdef01234567',
    });
    assert.deepEqual(parseItemId(VIEW_ID), { kind: 'view' });
    // Dashed GUIDs and upper case are accepted.
    const dashed = trackItemId(5).replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
      '$1-$2-$3-$4-$5'
    );
    assert.deepEqual(parseItemId(dashed.toUpperCase()), {
      kind: 'track',
      id: 5,
    });
    assert.equal(parseItemId('nope'), null);
  });

  it('serves public server info without a token', async () => {
    const res = await request(app).get('/jellyfin/System/Info/Public');
    assert.equal(res.status, 200);
    assert.equal(res.body.ProductName, 'Shufflerr');
    assert.equal(res.body.ServerName, 'Shufflerr');
    assert.match(res.body.Id, /^[0-9a-f]{32}$/);
    assert.match(res.body.Version, /^\d+\.\d+\.\d+$/);
    assert.equal(res.body.StartupWizardCompleted, true);

    const ping = await request(app).get('/jellyfin/System/Ping');
    assert.equal(ping.body, 'Jellyfin Server');
    assert.equal(
      (await request(app).get('/jellyfin/QuickConnect/Enabled')).body,
      false
    );
    assert.deepEqual(
      (await request(app).get('/jellyfin/Users/Public')).body,
      []
    );
    assert.equal(
      (await request(app).get('/jellyfin/Branding/Configuration')).status,
      200
    );
  });

  it('matches routes and parameter names case-insensitively', async () => {
    const res = await request(app).get('/jellyfin/system/info/public');
    assert.equal(res.status, 200);
    const items = await get('/items', {
      includeItemTypes: 'MusicAlbum',
      recursive: true,
      limit: 1,
    });
    assert.equal(items.status, 200);
    assert.equal(items.body.Items.length, 1);
    assert.equal(items.body.TotalRecordCount, 3);
  });

  it('signs in with a username and app password', async () => {
    const res = await signIn('admin', lib.adminPassword);
    assert.equal(res.status, 200);
    assert.match(res.body.AccessToken, /^[0-9a-f]{56}$/);
    assert.equal(res.body.User.Name, 'admin');
    assert.equal(res.body.User.Id, userItemId(lib.admin.id));
    assert.equal(res.body.User.Policy.IsAdministrator, true);
    assert.equal(res.body.User.Policy.EnableContentDownloading, true);
    assert.equal(res.body.SessionInfo.UserId, userItemId(lib.admin.id));
    assert.equal(res.body.SessionInfo.Client, 'Finamp');
    assert.equal(res.body.SessionInfo.DeviceId, 'dev-1');
    assert.equal(res.body.ServerId, res.body.User.ServerId);
    // The token is stable for one app password.
    assert.equal(res.body.AccessToken, token);

    const demo = await signIn('demo', lib.demoPassword);
    assert.equal(demo.body.User.Policy.IsAdministrator, false);
    assert.notEqual(demo.body.AccessToken, token);
  });

  it('rejects wrong, missing and account passwords', async () => {
    assert.equal((await signIn('admin', 'wrong')).status, 401);
    assert.equal((await signIn('admin', 'test1234')).status, 401);
    assert.equal((await signIn('admin', lib.demoPassword)).status, 401);
    assert.equal((await signIn('nobody', lib.adminPassword)).status, 401);
    assert.equal((await signIn('', '')).status, 401);
  });

  it('requires a valid token everywhere else', async () => {
    assert.equal((await request(app).get('/jellyfin/Items')).status, 401);
    assert.equal(
      (
        await request(app)
          .get('/jellyfin/Items')
          .set(
            'X-Emby-Token',
            token.replace(/.$/, (c) => (c === '0' ? '1' : '0'))
          )
      ).status,
      401
    );
    assert.equal(
      (await request(app).get('/jellyfin/Users/Me').set('X-Emby-Token', 'abc'))
        .status,
      401
    );
  });

  it('accepts the token in every place apps put it', async () => {
    const variants = [
      (r: request.Test) => r.set('Authorization', authHeader()),
      (r: request.Test) =>
        r.set(
          'X-Emby-Authorization',
          authHeader().replace('MediaBrowser', 'Emby')
        ),
      (r: request.Test) => r.set('X-Emby-Token', token),
      (r: request.Test) => r.set('X-MediaBrowser-Token', token),
      (r: request.Test) => r.query({ api_key: token }),
      (r: request.Test) => r.query({ ApiKey: token }),
    ];
    for (const apply of variants) {
      const res = await apply(request(app).get('/jellyfin/Users/Me'));
      assert.equal(res.status, 200);
      assert.equal(res.body.Name, 'admin');
    }
  });

  it('stops accepting the token when the app password is revoked', async () => {
    assert.equal((await get('/Users/Me')).status, 200);
    await revokeAppPassword(lib.admin.id, lib.adminAppPasswordId);
    assert.equal((await get('/Users/Me')).status, 401);
  });

  it('only exposes the signed-in user', async () => {
    const me = await get(`/Users/${userItemId(lib.admin.id)}`);
    assert.equal(me.body.Name, 'admin');
    assert.equal((await get(`/Users/${userItemId(lib.demo.id)}`)).status, 404);
    const all = await get('/Users');
    assert.deepEqual(
      all.body.map((u: Json) => u.Name),
      ['admin']
    );
    assert.equal((await get('/System/Info')).body.ProductName, 'Shufflerr');
  });

  it('is a 404 when the API is switched off', async () => {
    enableClientApis({ jellyfinApi: false });
    assert.equal(
      (await request(app).get('/jellyfin/System/Info/Public')).status,
      404
    );
    assert.equal((await get('/Items')).status, 404);
  });

  it('answers unknown calls with 404', async () => {
    assert.equal((await get('/LiveTv/Channels')).status, 404);
  });
});

describe('Jellyfin API: browsing', () => {
  it('has one music view', async () => {
    for (const path of [
      '/UserViews',
      `/Users/${userItemId(lib.admin.id)}/Views`,
    ]) {
      const res = await get(path);
      assert.equal(res.body.TotalRecordCount, 1);
      assert.equal(res.body.Items[0].Id, VIEW_ID);
      assert.equal(res.body.Items[0].CollectionType, 'music');
      assert.equal(res.body.Items[0].Type, 'CollectionFolder');
    }
    const view = await get(`/Items/${VIEW_ID}`);
    assert.equal(view.body.Name, 'Music');
  });

  it('lists albums with sorting and paging', async () => {
    const res = await get(`/Users/${userItemId(lib.admin.id)}/Items`, {
      ParentId: VIEW_ID,
      IncludeItemTypes: 'MusicAlbum',
      Recursive: true,
      SortBy: 'SortName',
      SortOrder: 'Ascending',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.TotalRecordCount, 3);
    assert.equal(res.body.StartIndex, 0);
    assert.deepEqual(
      res.body.Items.map((i: Json) => i.Name),
      ['After Hours', 'Live at the Depot', 'Zero Hour']
    );

    const album = res.body.Items[0];
    assert.equal(album.Id, albumItemId(lib.albumOne.id));
    assert.equal(album.Type, 'MusicAlbum');
    assert.equal(album.IsFolder, true);
    assert.equal(album.AlbumArtist, 'The Night Shift');
    assert.deepEqual(album.AlbumArtists, [
      { Name: 'The Night Shift', Id: artistItemId(`m${lib.artist.id}`) },
    ]);
    assert.equal(album.ProductionYear, 2021);
    assert.equal(album.PremiereDate, '2021-05-14T00:00:00.000Z');
    assert.equal(album.ChildCount, 3);
    assert.equal(album.RunTimeTicks, (181 + 182 + 183) * 10_000_000);
    assert.equal(album.ProviderIds.MusicBrainzReleaseGroup, ALBUM_ONE_MBID);
    assert.equal(album.ProviderIds.MusicBrainzAlbumArtist, ARTIST_MBID);
    assert.ok(album.ImageTags.Primary);
    assert.equal(album.UserData.IsFavorite, false);

    const newest = await get('/Items', {
      IncludeItemTypes: 'MusicAlbum',
      Recursive: true,
      SortBy: 'DateCreated,SortName',
      SortOrder: 'Descending',
      StartIndex: 1,
      Limit: 1,
    });
    assert.equal(newest.body.TotalRecordCount, 3);
    assert.equal(newest.body.StartIndex, 1);
    assert.deepEqual(
      newest.body.Items.map((i: Json) => i.Name),
      ['Zero Hour']
    );

    const byYear = await get('/Items', {
      IncludeItemTypes: 'MusicAlbum',
      Recursive: true,
      SortBy: 'ProductionYear',
      SortOrder: 'Descending',
    });
    assert.deepEqual(
      byYear.body.Items.map((i: Json) => i.ProductionYear),
      [2024, 2021, 1999]
    );

    const random = await get('/Items', {
      IncludeItemTypes: 'MusicAlbum',
      Recursive: true,
      SortBy: 'Random',
      Limit: 2,
    });
    assert.equal(random.body.Items.length, 2);
  });

  it('lists the tracks of an album in disc/track order, playable only', async () => {
    const res = await get('/Items', {
      ParentId: albumItemId(lib.albumOne.id),
      IncludeItemTypes: 'Audio',
      Fields: 'MediaSources',
    });
    assert.deepEqual(
      res.body.Items.map((i: Json) => i.Name),
      ['Closing Time', 'Last Train Home', 'Streetlights']
    );
    const track = res.body.Items[0];
    assert.equal(track.Id, trackItemId(lib.tracksOne[0].id));
    assert.equal(track.Type, 'Audio');
    assert.equal(track.MediaType, 'Audio');
    assert.equal(track.IndexNumber, 1);
    assert.equal(track.ParentIndexNumber, 1);
    assert.equal(track.RunTimeTicks, 181 * 10_000_000);
    assert.equal(track.Album, 'After Hours');
    assert.equal(track.AlbumId, albumItemId(lib.albumOne.id));
    assert.equal(track.AlbumArtist, 'The Night Shift');
    assert.deepEqual(res.body.Items[1].Artists, ['The Night Shift, Mara Vale']);
    assert.equal(track.Container, 'flac');
    assert.equal(track.MediaSources[0].Container, 'flac');
    assert.equal(track.MediaSources[0].MediaStreams[0].Codec, 'flac');
    assert.equal(track.MediaSources[0].MediaStreams[0].SampleRate, 44100);
    assert.equal(
      track.ProviderIds.MusicBrainzRecording,
      lib.tracksOne[0].recordingMbid
    );
    assert.equal(res.body.Items[2].MediaSources[0].Bitrate, 320000);
  });

  it('filters by artist, album, search term, ids and non-music types', async () => {
    const artistId = artistItemId(`m${lib.artist.id}`);

    const albums = await get('/Items', {
      AlbumArtistIds: artistId,
      IncludeItemTypes: 'MusicAlbum',
      Recursive: true,
    });
    assert.equal(albums.body.TotalRecordCount, 2);

    const viaParent = await get('/Items', { ParentId: artistId });
    assert.deepEqual(
      viaParent.body.Items.map((i: Json) => i.Type),
      ['MusicAlbum', 'MusicAlbum']
    );

    const tracks = await get('/Items', {
      ArtistIds: artistId,
      IncludeItemTypes: 'Audio',
      Recursive: true,
      Limit: 100,
    });
    assert.equal(tracks.body.TotalRecordCount, 5);

    const byAlbum = await get('/Items', {
      AlbumIds: albumItemId(lib.albumTwo.id),
      IncludeItemTypes: 'Audio',
      Recursive: true,
    });
    assert.deepEqual(byAlbum.body.Items.map((i: Json) => i.Name).sort(), [
      'Countdown',
      'Zero',
    ]);

    const search = await get('/Items', {
      SearchTerm: 'depot',
      IncludeItemTypes: 'Audio,MusicAlbum,MusicArtist',
      Recursive: true,
    });
    assert.deepEqual(
      search.body.Items.map((i: Json) => `${i.Type}:${i.Name}`).sort(),
      ['Audio:Depot Jam', 'MusicAlbum:Live at the Depot']
    );

    const byIds = await get('/Items', {
      Ids: [
        trackItemId(lib.tracksTwo[1].id),
        albumItemId(lib.albumThree.id),
        trackItemId(lib.missingTrack.id),
      ].join(','),
    });
    assert.deepEqual(
      byIds.body.Items.map((i: Json) => i.Name),
      ['Zero', 'Live at the Depot']
    );

    const movies = await get('/Items', {
      IncludeItemTypes: 'Movie,Series',
      Recursive: true,
    });
    assert.equal(movies.body.TotalRecordCount, 0);

    const genre = await get('/Items', {
      IncludeItemTypes: 'MusicAlbum',
      Recursive: true,
      Genres: 'House',
    });
    assert.equal(genre.body.TotalRecordCount, 0);
    assert.deepEqual((await get('/MusicGenres')).body.Items, []);
  });

  it('gets single items and 404s unknown or unavailable ones', async () => {
    const track = await get(
      `/Users/${userItemId(lib.admin.id)}/Items/${trackItemId(lib.tracksOne[1].id)}`
    );
    assert.equal(track.body.Name, 'Last Train Home');
    const album = await get(`/Items/${albumItemId(lib.albumTwo.id)}`);
    assert.equal(album.body.Name, 'Zero Hour');
    const artist = await get(`/Items/${artistItemId(`m${lib.artist.id}`)}`);
    assert.equal(artist.body.Type, 'MusicArtist');
    assert.equal(artist.body.ProviderIds.MusicBrainzArtist, ARTIST_MBID);

    assert.equal(
      (await get(`/Items/${trackItemId(lib.missingTrack.id)}`)).status,
      404
    );
    assert.equal((await get(`/Items/${trackItemId(987654)}`)).status, 404);
    assert.equal((await get('/Items/not-an-id')).status, 404);
  });

  it('lists latest albums as a bare array', async () => {
    const res = await get(`/Users/${userItemId(lib.admin.id)}/Items/Latest`, {
      IncludeItemTypes: 'Audio,MusicAlbum',
      ParentId: VIEW_ID,
      Limit: 2,
    });
    assert.ok(Array.isArray(res.body));
    assert.deepEqual(
      res.body.map((i: Json) => i.Name),
      ['Live at the Depot', 'Zero Hour']
    );
  });

  it('lists album artists, including ones without a MusicBrainz id', async () => {
    const res = await get('/Artists/AlbumArtists', { Limit: 50 });
    assert.equal(res.body.TotalRecordCount, 2);
    assert.deepEqual(
      res.body.Items.map((i: Json) => i.Name),
      ['Basement Tapes Collective', 'The Night Shift']
    );
    assert.equal(res.body.Items[1].AlbumCount, 2);
    assert.match(res.body.Items[0].Id, /^a1[0-9a-f]{30}$/);

    const byName = await get(`/Items/${res.body.Items[0].Id}`);
    assert.equal(byName.body.Name, 'Basement Tapes Collective');
    const albums = await get('/Items', { ParentId: res.body.Items[0].Id });
    assert.deepEqual(
      albums.body.Items.map((i: Json) => i.Name),
      ['Live at the Depot']
    );

    const search = await get('/Artists', { SearchTerm: 'night' });
    assert.equal(search.body.TotalRecordCount, 1);
  });

  it('reports item counts', async () => {
    const res = await get('/Items/Counts');
    assert.equal(res.body.SongCount, 6);
    assert.equal(res.body.AlbumCount, 3);
    assert.equal(res.body.ArtistCount, 2);
  });
});

describe('Jellyfin API: favourites and playlists', () => {
  it('marks and unmarks favourites per user', async () => {
    const trackId = trackItemId(lib.tracksOne[0].id);
    const albumId = albumItemId(lib.albumTwo.id);

    const marked = await post(`/UserFavoriteItems/${trackId}`);
    assert.equal(marked.status, 200);
    assert.equal(marked.body.IsFavorite, true);
    assert.equal(marked.body.ItemId, trackId);
    await post(`/Users/${userItemId(lib.admin.id)}/FavoriteItems/${albumId}`);

    const favouriteTracks = await get('/Items', {
      IncludeItemTypes: 'Audio',
      Recursive: true,
      Filters: 'IsFavorite',
    });
    assert.deepEqual(
      favouriteTracks.body.Items.map((i: Json) => i.Id),
      [trackId]
    );
    assert.equal(favouriteTracks.body.Items[0].UserData.IsFavorite, true);

    const favouriteAlbums = await get('/Items', {
      IncludeItemTypes: 'MusicAlbum',
      Recursive: true,
      isFavorite: true,
    });
    assert.deepEqual(
      favouriteAlbums.body.Items.map((i: Json) => i.Id),
      [albumId]
    );

    // The other user sees none of it.
    const demoToken = (await signIn('demo', lib.demoPassword)).body.AccessToken;
    const demoFavourites = await request(app)
      .get('/jellyfin/Items')
      .set('X-Emby-Token', demoToken)
      .query({
        IncludeItemTypes: 'Audio',
        Recursive: true,
        Filters: 'IsFavorite',
      });
    assert.equal(demoFavourites.body.TotalRecordCount, 0);

    const unmarked = await del(`/UserFavoriteItems/${trackId}`);
    assert.equal(unmarked.body.IsFavorite, false);
    assert.equal(
      (
        await get('/Items', {
          IncludeItemTypes: 'Audio',
          Recursive: true,
          Filters: 'IsFavorite',
        })
      ).body.TotalRecordCount,
      0
    );
    assert.equal(
      (await post(`/UserFavoriteItems/${trackItemId(999999)}`)).status,
      404
    );
  });

  it('runs the playlist lifecycle', async () => {
    const [a, b, c] = lib.tracksOne.map((t) => trackItemId(t.id));
    const d = trackItemId(lib.tracksTwo[0].id);

    const created = await post('/Playlists', {
      Name: 'Night drive',
      Ids: [a, b],
      UserId: userItemId(lib.admin.id),
      MediaType: 'Audio',
    });
    assert.equal(created.status, 200);
    const id = created.body.Id;
    assert.deepEqual(parseItemId(id)?.kind, 'playlist');

    const listed = await get('/Items', {
      IncludeItemTypes: 'Playlist',
      Recursive: true,
    });
    assert.equal(listed.body.TotalRecordCount, 1);
    assert.equal(listed.body.Items[0].Name, 'Night drive');
    assert.equal(listed.body.Items[0].Type, 'Playlist');
    assert.equal(listed.body.Items[0].ChildCount, 2);

    await post(`/Playlists/${id}/Items`, undefined, { Ids: `${c},${d}` });
    const items = await get(`/Playlists/${id}/Items`);
    assert.deepEqual(
      items.body.Items.map((i: Json) => i.Id),
      [a, b, c, d]
    );
    assert.ok(items.body.Items.every((i: Json) => i.PlaylistItemId));

    // Same list through the generic item query.
    const viaItems = await get('/Items', { ParentId: id });
    assert.deepEqual(
      viaItems.body.Items.map((i: Json) => i.Id),
      [a, b, c, d]
    );

    await del(`/Playlists/${id}/Items`, {
      EntryIds: [
        items.body.Items[0].PlaylistItemId,
        items.body.Items[2].PlaylistItemId,
      ].join(','),
    });
    assert.deepEqual(
      (await get(`/Playlists/${id}/Items`)).body.Items.map((i: Json) => i.Id),
      [b, d]
    );

    // Rename by posting the item back, as apps do.
    assert.equal(
      (await post(`/Items/${id}`, { Name: 'Morning drive', Id: id })).status,
      204
    );
    assert.equal((await get(`/Items/${id}`)).body.Name, 'Morning drive');

    // 10.9-style update replaces the contents.
    assert.equal(
      (await post(`/Playlists/${id}`, { Name: 'Morning drive', Ids: [c] }))
        .status,
      204
    );
    assert.deepEqual((await get(`/Playlists/${id}`)).body.ItemIds, [c]);

    // Another user can neither see nor change a private playlist.
    const demoToken = (await signIn('demo', lib.demoPassword)).body.AccessToken;
    const asDemo = (r: request.Test) => r.set('X-Emby-Token', demoToken);
    assert.equal(
      (await asDemo(request(app).get(`/jellyfin/Playlists/${id}/Items`)))
        .status,
      404
    );
    assert.equal(
      (await asDemo(request(app).delete(`/jellyfin/Items/${id}`))).status,
      404
    );

    assert.equal((await del(`/Items/${id}`)).status, 204);
    assert.equal((await get(`/Items/${id}`)).status, 404);
    assert.equal((await post('/Playlists', { Ids: [a] })).status, 400);
    // Deleting library items is not possible from an app.
    assert.equal((await del(`/Items/${a}`)).status, 404);
  });
});

describe('Jellyfin API: playback', () => {
  it('returns playback info', async () => {
    const id = trackItemId(lib.tracksOne[0].id);
    const res = await post(`/Items/${id}/PlaybackInfo`, {
      UserId: userItemId(lib.admin.id),
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.PlaySessionId);
    assert.equal(res.body.MediaSources[0].Id, id);
    assert.equal(res.body.MediaSources[0].SupportsDirectPlay, true);
    assert.equal(
      (await post(`/Items/${trackItemId(404404)}/PlaybackInfo`)).status,
      404
    );
  });

  it('universal audio plays the original when the app can take it', async () => {
    const id = trackItemId(lib.tracksOne[0].id);
    const res = await request(app)
      .get(`/jellyfin/Audio/${id}/universal`)
      .set('Range', 'bytes=0-3')
      .query({
        api_key: token,
        UserId: userItemId(lib.admin.id),
        Container: 'opus,mp3,aac,m4a,flac,wav,ogg',
        TranscodingContainer: 'ts',
        TranscodingProtocol: 'hls',
        AudioCodec: 'aac',
      });
    assert.equal(res.status, 206);
    assert.equal(res.headers['content-range'], 'bytes 0-3/22');
    assert.deepEqual(recorded.streams, [
      { trackId: lib.tracksOne[0].id, options: {}, range: 'bytes=0-3' },
    ]);
  });

  it('transcodes when the app caps the bitrate or cannot play the container', async () => {
    const flac = trackItemId(lib.tracksOne[0].id);
    const mp3 = trackItemId(lib.tracksOne[2].id);

    await get(`/Audio/${flac}/universal`, {
      Container: 'flac,mp3',
      MaxStreamingBitrate: 128000,
      TranscodingContainer: 'mp3',
    });
    await get(`/Audio/${flac}/universal`, {
      Container: 'mp3,aac',
      AudioCodec: 'opus',
      TranscodingContainer: 'ogg',
      MaxStreamingBitrate: 999999999,
    });
    await get(`/Audio/${mp3}/universal`, {
      Container: 'mp3',
      MaxStreamingBitrate: 320000,
    });
    await get(`/Audio/${flac}/stream`, { static: true });
    await get(`/Audio/${flac}/stream.mp3`, { AudioBitRate: 192000 });
    await get(`/Items/${flac}/File`);

    assert.deepEqual(
      recorded.streams.map((s) => s.options),
      [
        { format: 'mp3', maxBitRate: 128 },
        { format: 'opus', maxBitRate: 320 },
        {},
        { format: 'raw' },
        { format: 'mp3', maxBitRate: 192 },
        {},
      ]
    );
  });

  it('needs a token and a real track to stream', async () => {
    const id = trackItemId(lib.tracksOne[0].id);
    assert.equal(
      (await request(app).get(`/jellyfin/Audio/${id}/universal`)).status,
      401
    );
    assert.equal(
      (await get(`/Audio/${trackItemId(lib.missingTrack.id)}/universal`))
        .status,
      404
    );
    assert.equal(
      (await get(`/Audio/${albumItemId(lib.albumOne.id)}/stream`)).status,
      404
    );
    assert.equal(recorded.streams.length, 0);
  });

  it('downloads follow the "allow downloads" switch', async () => {
    const id = trackItemId(lib.tracksOne[0].id);
    assert.equal((await get(`/Items/${id}/Download`)).status, 200);
    assert.deepEqual(recorded.streams[0].options, {
      download: true,
      format: 'raw',
    });

    enableClientApis({ allowDownloads: false });
    assert.equal((await get(`/Items/${id}/Download`)).status, 403);
    assert.equal(
      (await get('/Users/Me')).body.Policy.EnableContentDownloading,
      false
    );
    assert.equal((await get(`/Items/${id}`)).body.CanDownload, false);
  });

  it('playback reports feed the scrobble pipeline', async () => {
    const track = lib.tracksOne[1];
    const id = trackItemId(track.id);

    assert.equal(
      (await post('/Sessions/Playing', { ItemId: id, PositionTicks: 0 }))
        .status,
      204
    );
    assert.equal(recorded.nowPlaying.length, 1);
    assert.equal(recorded.nowPlaying[0].source, 'apps');
    assert.equal(recorded.nowPlaying[0].trackId, track.id);
    assert.equal(recorded.nowPlaying[0].track, 'Last Train Home');

    // Progress pings don't re-announce or record anything.
    assert.equal(
      (
        await post('/Sessions/Playing/Progress', {
          ItemId: id,
          PositionTicks: 60 * 10_000_000,
          IsPaused: false,
        })
      ).status,
      204
    );
    assert.equal(recorded.nowPlaying.length, 1);
    assert.equal(recorded.plays.length, 0);

    assert.equal(
      (
        await post('/Sessions/Playing/Stopped', {
          ItemId: id,
          PositionTicks: 150 * 10_000_000,
        })
      ).status,
      204
    );
    assert.equal(recorded.plays.length, 1);
    const play = recorded.plays[0];
    assert.equal(play.source, 'apps');
    assert.equal(play.user.id, lib.admin.id);
    assert.equal(play.trackId, track.id);
    assert.equal(play.album, 'After Hours');
    assert.equal(play.releaseGroupMbid, ALBUM_ONE_MBID);
    assert.equal(play.playedSeconds, 150);
    assert.equal(play.durationMs, 182000);
    assert.ok(play.startedAt instanceof Date);

    // Unknown items are acknowledged but never recorded.
    assert.equal(
      (await post('/Sessions/Playing/Stopped', { ItemId: trackItemId(31337) }))
        .status,
      204
    );
    assert.equal(recorded.plays.length, 1);
    assert.equal((await post('/Sessions/Capabilities/Full', {})).status, 204);
  });

  it('serves album art as image bytes, without a token', async () => {
    const binary = (r: request.Test) =>
      r.buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    const album = await binary(
      request(app)
        .get(`/jellyfin/Items/${albumItemId(lib.albumOne.id)}/Images/Primary`)
        .query({ maxWidth: 800, quality: 90 })
    );
    assert.equal(album.status, 200);
    assert.equal(album.headers['content-type'], 'image/jpeg');
    assert.deepEqual(album.body, FAKE_IMAGE);
    assert.deepEqual(recorded.covers, [
      `/release-group/${ALBUM_ONE_MBID}/front-1200`,
    ]);

    const track = await request(app).get(
      `/jellyfin/Items/${trackItemId(lib.tracksOne[0].id)}/Images/Primary/0`
    );
    assert.equal(track.status, 200);

    // No art upstream, artists, and other image types: 404.
    for (const path of [
      `/Items/${albumItemId(lib.albumTwo.id)}/Images/Primary`,
      `/Items/${artistItemId(`m${lib.artist.id}`)}/Images/Primary`,
      `/Items/${albumItemId(lib.albumOne.id)}/Images/Backdrop`,
    ]) {
      assert.equal((await request(app).get(`/jellyfin${path}`)).status, 404);
    }
  });
});
