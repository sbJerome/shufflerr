import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Event from '@server/entity/Event';
import Media from '@server/entity/Media';
import ScrobbleQueue from '@server/entity/ScrobbleQueue';
import { User } from '@server/entity/User';
import cacheManager from '@server/lib/cache';
import {
  getConcertArtists,
  mapSkiddleEvent,
  mapTicketmasterEvent,
  pickAttraction,
  refreshConcerts,
  skiddleEventFeatures,
} from '@server/lib/concerts';
import type { AllSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import { installHttpMock } from '@server/test/mockAxios';

// Shapes follow the providers' published response formats. No Ticketmaster or
// Skiddle key was available to record live responses.
import skiddleEvents from '@server/test/fixtures/concerts/skiddle-events.json';
import ticketmasterAttractions from '@server/test/fixtures/concerts/ticketmaster-attractions.json';
import ticketmasterEvents from '@server/test/fixtures/concerts/ticketmaster-events.json';

const TM = 'https://app.ticketmaster.com/discovery/v2';
const SKIDDLE = 'https://www.skiddle.com/api/v1/events/search/';
const JOHN_SUMMIT = {
  mbid: '2547c5e3-314c-4332-981d-f18c902a4086',
  name: 'John Summit',
};

const http = installHttpMock();
let pristine: AllSettings;

const addAlbum = (
  mbid: string,
  artist: { mbid: string; name: string },
  addedAt: string
) =>
  getRepository(Media).save(
    new Media({
      mediaType: MediaType.RELEASE_GROUP,
      mbid,
      title: `Album ${mbid.slice(0, 4)}`,
      artistMbid: artist.mbid,
      artistName: artist.name,
      status: MediaStatus.AVAILABLE,
      mediaAddedAt: new Date(addedAt),
    })
  );

before(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pristine = structuredClone((getSettings() as any).data);
});

setupTestDb();

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getSettings() as any).data = structuredClone(pristine);
  const settings = getSettings();
  settings.discover = {
    ...settings.discover,
    ticketmaster: {
      enabled: true,
      apiKey: 'tm-key',
      country: 'US',
      radiusMiles: 50,
    },
  };
  cacheManager.getCache('ticketmaster').flush();
  cacheManager.getCache('skiddle').flush();
  http.reset();
});

describe('concert mapping', () => {
  it('picks the attraction linked to the MusicBrainz artist, else the exact name', () => {
    const attractions = ticketmasterAttractions._embedded.attractions;
    assert.equal(pickAttraction(attractions, JOHN_SUMMIT)?.id, 'K8vZ9179cV0');
    assert.equal(
      pickAttraction(attractions, { name: 'john summit' })?.id,
      'K8vZ9179cV0'
    );
    assert.equal(pickAttraction(attractions, { name: 'John Smith' }), null);
  });

  it('maps a Ticketmaster event and drops cancelled ones', () => {
    const [first, cancelled, dateOnly] = ticketmasterEvents._embedded.events;
    const event = mapTicketmasterEvent(first, JOHN_SUMMIT);
    assert.deepEqual(event, {
      provider: 'ticketmaster',
      externalId: 'vvG1VZbKfS7Gd0',
      artistMbid: JOHN_SUMMIT.mbid,
      artistName: 'John Summit',
      name: 'John Summit: Experts Only',
      venue: 'Madison Square Garden',
      city: 'New York',
      country: 'US',
      startsAt: new Date('2099-03-15T00:00:00Z'),
      url: 'https://www.ticketmaster.com/event/vvG1VZbKfS7Gd0',
      // the smallest 16:9 image that is wide enough, through the image proxy
      imageUrl: '/imageproxy/ticketmaster/dam/a/1f6/wide_TABLET_LANDSCAPE_16_9.jpg',
    });
    assert.equal(mapTicketmasterEvent(cancelled, JOHN_SUMMIT), null);
    const mapped = mapTicketmasterEvent(dateOnly, JOHN_SUMMIT);
    assert.equal(mapped?.imageUrl, null);
    assert.equal(mapped?.startsAt.getFullYear(), 2099);
  });

  it('keeps only Skiddle events that bill the artist', () => {
    const [billed, lookalike, inTitle] = skiddleEvents.results;
    assert.equal(skiddleEventFeatures(billed, JOHN_SUMMIT), true);
    assert.equal(skiddleEventFeatures(lookalike, JOHN_SUMMIT), false);
    assert.equal(skiddleEventFeatures(inTitle, JOHN_SUMMIT), true);

    const event = mapSkiddleEvent(billed, JOHN_SUMMIT);
    assert.equal(event?.provider, 'skiddle');
    assert.equal(event?.externalId, '41234567');
    assert.equal(event?.venue, 'Drumsheds');
    assert.equal(event?.city, 'London');
    assert.equal(event?.country, 'GB');
    assert.equal(event?.startsAt.toISOString(), '2099-06-06T14:00:00.000Z');
    assert.equal(
      event?.imageUrl,
      '/imageproxy/skiddle/9/41234567_0_John-Summit.jpg'
    );
    // cancelled
    assert.equal(mapSkiddleEvent(inTitle, JOHN_SUMMIT), null);
  });
});

describe('concert refresh', () => {
  it('looks up library artists, the recently played first', async () => {
    const other = { mbid: 'a6c6897a-7415-4f8d-b5a5-3a5e05f3be67', name: 'twenty one pilots' };
    await addAlbum('11111111-1111-4111-8111-111111111111', JOHN_SUMMIT, '2026-01-01');
    await addAlbum('22222222-2222-4222-8222-222222222222', JOHN_SUMMIT, '2026-02-01');
    await addAlbum('33333333-3333-4333-8333-333333333333', other, '2026-09-01');
    // requested but not in the library: not looked up
    await getRepository(Media).save(
      new Media({
        mediaType: MediaType.RELEASE_GROUP,
        mbid: '44444444-4444-4444-8444-444444444444',
        title: 'Not here yet',
        artistName: 'Alesso',
        status: MediaStatus.PROCESSING,
      })
    );
    assert.deepEqual(
      (await getConcertArtists()).map((a) => a.name),
      ['twenty one pilots', 'John Summit']
    );

    await getRepository(ScrobbleQueue).save(
      new ScrobbleQueue({
        user: await getRepository(User).findOneOrFail({ where: { id: 1 } }),
        artist: 'John Summit, Hayla',
        track: 'Where You Are',
        playedAt: new Date(),
        source: 'web',
        targets: {},
        attempts: 0,
      })
    );
    assert.deepEqual(
      (await getConcertArtists()).map((a) => a.name),
      ['John Summit', 'twenty one pilots']
    );
    assert.deepEqual(
      (await getConcertArtists(1)).map((a) => a.name),
      ['John Summit']
    );
  });

  it('stores upcoming Ticketmaster events once and purges them when the provider is switched off', async () => {
    await addAlbum('11111111-1111-4111-8111-111111111111', JOHN_SUMMIT, '2026-01-01');
    http.get(`${TM}/attractions.json`, () => [200, ticketmasterAttractions]);
    http.get(`${TM}/events.json`, () => [200, ticketmasterEvents]);
    // a stale past event from an earlier run
    await getRepository(Event).save(
      new Event({
        provider: 'ticketmaster',
        externalId: 'old',
        artistName: 'John Summit',
        startsAt: new Date('2020-01-01T00:00:00Z'),
        url: 'https://www.ticketmaster.com/event/old',
      })
    );

    await refreshConcerts();

    const attractionCall = http.callsTo(`${TM}/attractions.json`)[0];
    assert.equal(attractionCall.params.get('keyword'), 'John Summit');
    assert.equal(attractionCall.params.get('apikey'), 'tm-key');
    const eventsCall = http.callsTo(`${TM}/events.json`)[0];
    assert.equal(eventsCall.params.get('attractionId'), 'K8vZ9179cV0');
    assert.equal(eventsCall.params.get('countryCode'), 'US');

    let events = await getRepository(Event).find({ order: { startsAt: 'ASC' } });
    assert.deepEqual(
      events.map((e) => e.externalId),
      ['vvG1VZbKfS7Gd0', 'vvG1VZbKfS7Gd2']
    );
    assert.equal(events[0].artistMbid, JOHN_SUMMIT.mbid);
    assert.equal(events[0].venue, 'Madison Square Garden');

    // a second run updates the same rows
    cacheManager.getCache('ticketmaster').flush();
    await refreshConcerts();
    assert.equal(await getRepository(Event).count(), 2);

    // Skiddle is off and no viewer is in the UK or Ireland: it is never called
    assert.equal(http.callsTo(SKIDDLE).length, 0);

    getSettings().discover = {
      ...getSettings().discover,
      ticketmaster: { enabled: false, apiKey: 'tm-key', country: 'US', radiusMiles: 50 },
    };
    await refreshConcerts();
    events = await getRepository(Event).find();
    assert.equal(events.length, 0);
  });

  it('asks Skiddle only when someone browses from the UK or Ireland', async () => {
    await addAlbum('11111111-1111-4111-8111-111111111111', JOHN_SUMMIT, '2026-01-01');
    const settings = getSettings();
    settings.discover = {
      ...settings.discover,
      ticketmaster: { enabled: false, apiKey: '', country: 'US', radiusMiles: 50 },
      skiddle: { enabled: true, apiKey: 'skiddle-key' },
    };
    http.get(SKIDDLE, () => [200, skiddleEvents]);

    settings.main.discoverRegion = 'US';
    await refreshConcerts();
    assert.equal(http.calls.length, 0);

    settings.main.discoverRegion = 'GB';
    await refreshConcerts();
    assert.equal(http.callsTo(SKIDDLE)[0].params.get('keyword'), 'John Summit');
    assert.equal(http.callsTo(SKIDDLE)[0].params.get('api_key'), 'skiddle-key');
    const events = await getRepository(Event).find();
    assert.deepEqual(
      events.map((e) => [e.provider, e.externalId, e.city]),
      [['skiddle', '41234567', 'London']]
    );
  });
});
