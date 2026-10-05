import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import ImportJob from '@server/entity/ImportJob';
import Media from '@server/entity/Media';
import {
  BlocklistedMediaError,
  DuplicateMediaRequestError,
  MediaRequest,
  QuotaRestrictedError,
  RequestPermissionError,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import type {
  ImportJobSummary,
  ImportMatch,
  ImportRequestResponse,
  ImportResolveResponse,
  ImportSourcesResponse,
  ImportSpotifySavedResponse,
} from '@server/interfaces/api/importInterfaces';
import type { AlbumCandidate, MatchOutcome } from '@server/lib/import/match';
import { matchAlbum, toAlbumResults } from '@server/lib/import/match';
import { ImportLinkError, parseImportUrl } from '@server/lib/import/parse';
import { PersistCache } from '@server/lib/import/persistCache';
import {
  fetchSourceAlbums,
  getSpotifyForUser,
  spotifyAlbumToCandidate,
} from '@server/lib/import/sources';
import { Permission } from '@server/lib/permissions';
import { getLinkedProviders } from '@server/lib/scrobble/linked';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AlbumResult } from '@server/models/music';
import { In } from 'typeorm';

export { ImportLinkError, parseImportUrl } from '@server/lib/import/parse';
export { matchAlbum } from '@server/lib/import/match';

/** How long POST /import/resolve waits for matching before answering 'resolving'. */
const INLINE_WAIT_MS = 8000;
/** Saved albums shown on the Import page (newest first). */
const SAVED_ALBUMS_SHOWN = 50;

/** A stored match: what ImportJob.matched holds while and after resolving. */
type StoredMatch = ImportMatch;

const runningJobs = new Map<number, Promise<void>>();

const emptyMatch = (candidate: AlbumCandidate, pending: boolean): StoredMatch => ({
  sourceId: candidate.sourceId,
  sourceTitle: candidate.title,
  sourceArtist: candidate.artist,
  sourceCoverUrl: candidate.coverUrl ?? null,
  matchedBy: 'none',
  album: null,
  ...(pending ? { pending: true } : {}),
});

const outcomeToAlbum = (outcome: MatchOutcome): AlbumResult | null =>
  outcome.releaseGroup
    ? {
        mbid: outcome.releaseGroup.mbid,
        title: outcome.releaseGroup.title,
        artistMbid: outcome.releaseGroup.artistMbid,
        artistName: outcome.releaseGroup.artistName,
        primaryType: outcome.releaseGroup.primaryType,
        secondaryTypes: outcome.releaseGroup.secondaryTypes,
        firstReleaseDate: outcome.releaseGroup.firstReleaseDate,
        coverUrl: null,
        status: MediaStatus.UNKNOWN,
      }
    : null;

/** Stored matches → matches with today's library status and cover URLs. */
const refreshMatches = async (stored: StoredMatch[]): Promise<ImportMatch[]> => {
  const albums = await toAlbumResults(
    stored
      .filter((m) => m.album)
      .map((m) => ({
        mbid: m.album?.mbid ?? '',
        title: m.album?.title ?? '',
        artistMbid: m.album?.artistMbid ?? '',
        artistName: m.album?.artistName ?? '',
        primaryType: m.album?.primaryType,
        secondaryTypes: m.album?.secondaryTypes,
        firstReleaseDate: m.album?.firstReleaseDate,
      }))
  );
  return stored.map((m) => ({
    ...m,
    album: m.album ? (albums.get(m.album.mbid) ?? m.album) : null,
  }));
};

const toResponse = async (job: ImportJob): Promise<ImportResolveResponse> => ({
  jobId: job.id,
  source: job.source,
  title: job.title ?? undefined,
  url: job.url,
  matches: await refreshMatches(job.matched ?? []),
  status: job.status,
  error: job.error ?? null,
});

/** Match every album of a job at MusicBrainz's pace, saving progress as it goes. */
const runJob = async (
  jobId: number,
  candidates: AlbumCandidate[]
): Promise<void> => {
  const repository = getRepository(ImportJob);
  const matches: StoredMatch[] = candidates.map((c) => emptyMatch(c, true));
  let failures = 0;
  let lastError = '';
  let lastSave = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    try {
      const outcome = await matchAlbum(candidates[i]);
      matches[i] = {
        ...emptyMatch(candidates[i], false),
        matchedBy: outcome.matchedBy,
        album: outcomeToAlbum(outcome),
      };
    } catch (e) {
      failures++;
      lastError = e.message;
      matches[i] = emptyMatch(candidates[i], false);
      logger.warn('MusicBrainz lookup failed while matching an import', {
        label: 'Import',
        jobId,
        errorMessage: e.message,
      });
    }
    if (Date.now() - lastSave > 3000 && i < candidates.length - 1) {
      await repository.update(jobId, { matched: matches });
      lastSave = Date.now();
    }
  }

  const allFailed = candidates.length > 0 && failures === candidates.length;
  await repository.update(jobId, {
    matched: matches,
    status: allFailed ? 'failed' : 'ready',
    error: allFailed
      ? `MusicBrainz couldn't be reached, so nothing was matched (${lastError}). Try the link again in a minute.`
      : null,
  });
};

/** POST /import/resolve: read the link, start matching, answer with what is known so far. */
export const resolveImport = async (
  url: string,
  user: User
): Promise<ImportResolveResponse> => {
  const parsed = parseImportUrl(url);
  const list = await fetchSourceAlbums(parsed, user.id);
  if (!list.albums.length) {
    throw new ImportLinkError(
      'That link has no albums in it. Paste a link to an album or to a playlist with tracks.'
    );
  }

  const repository = getRepository(ImportJob);
  const job = await repository.save(
    new ImportJob({
      user,
      source: list.source,
      url: url.trim(),
      title: list.title ?? null,
      status: 'resolving',
      matched: list.albums.map((c) => emptyMatch(c, true)),
    })
  );

  const run = runJob(job.id, list.albums)
    .catch(async (e) => {
      logger.error('Import job failed', {
        label: 'Import',
        jobId: job.id,
        errorMessage: e.message,
      });
      await repository
        .update(job.id, {
          status: 'failed',
          error: 'Something went wrong while matching this link. Try it again.',
        })
        .catch(() => undefined);
    })
    .finally(() => runningJobs.delete(job.id));
  runningJobs.set(job.id, run);

  await Promise.race([
    run,
    new Promise((resolve) => setTimeout(resolve, INLINE_WAIT_MS)),
  ]);

  const fresh = await repository.findOneOrFail({ where: { id: job.id } });
  return { ...(await toResponse(fresh)), truncated: list.truncated };
};

/** A job the viewer owns (managers of users may read anyone's), with live statuses. */
export const getImportJob = async (
  id: number,
  user: User
): Promise<ImportResolveResponse | null> => {
  const repository = getRepository(ImportJob);
  const job = await repository.findOne({
    where: { id },
    relations: { user: true },
  });
  if (
    !job ||
    (job.user?.id !== user.id && !user.hasPermission(Permission.MANAGE_USERS))
  ) {
    return null;
  }
  if (job.status === 'resolving' && !runningJobs.has(job.id)) {
    // The server restarted mid-match; the link has to be read again.
    job.status = 'failed';
    job.error =
      'Shufflerr restarted while matching this link. Paste the link again.';
    job.matched = (job.matched ?? []).map((m) => ({ ...m, pending: undefined }));
    await repository.save(job);
  }
  return toResponse(job);
};

export const listImportJobs = async (
  user: User,
  take = 20
): Promise<ImportJobSummary[]> => {
  const jobs = await getRepository(ImportJob).find({
    where: { user: { id: user.id } },
    order: { id: 'DESC' },
    take,
  });
  return jobs.map((job) => ({
    id: job.id,
    source: job.source,
    url: job.url,
    title: job.title ?? null,
    status:
      job.status === 'resolving' && !runningJobs.has(job.id)
        ? 'failed'
        : job.status,
    error: job.error ?? null,
    matchCount: (job.matched ?? []).filter((m) => m.album).length,
    createdAt: new Date(job.createdAt).toISOString(),
  }));
};

/** "2 approved automatically, 1 waiting for approval, 1 not requested: <first reason>" */
export const summarizeImport = (
  auto: number,
  pending: number,
  blocked: number,
  firstReason?: string
): string => {
  const parts: string[] = [];
  if (auto) {
    parts.push(`${auto} approved automatically`);
  }
  if (pending) {
    parts.push(`${pending} waiting for approval`);
  }
  if (blocked) {
    parts.push(
      `${blocked} not requested${firstReason ? `: ${firstReason}` : ''}`
    );
  }
  if (!parts.length) {
    return 'Nothing was requested.';
  }
  const text = parts.join(', ');
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

/** POST /import/request: every chosen album goes through the request engine (scope album). */
export const requestImport = async (
  user: User,
  body: { jobId?: number; mbids: string[] },
  options: { isAutoRequest?: boolean } = {}
): Promise<ImportRequestResponse> => {
  const mbids = [...new Set((body.mbids ?? []).filter(Boolean))];
  const titles = new Map<string, string>();

  let job: ImportJob | null = null;
  if (body.jobId) {
    job = await getRepository(ImportJob).findOne({
      where: { id: body.jobId, user: { id: user.id } },
    });
    for (const match of job?.matched ?? []) {
      if (match.album) {
        titles.set(match.album.mbid, match.album.title);
      }
    }
  }
  const missingTitles = mbids.filter((m) => !titles.has(m));
  if (missingTitles.length) {
    const rows = await getRepository(Media).find({
      where: { mediaType: MediaType.RELEASE_GROUP, mbid: In(missingTitles) },
    });
    rows.forEach((m) => titles.set(m.mbid, m.title));
  }

  const results: ImportRequestResponse['results'] = [];
  let firstReason: string | undefined;

  // One at a time: each request may need MusicBrainz and counts against the quota in order.
  for (const mbid of mbids) {
    try {
      const request = await MediaRequest.request(
        {
          mbid,
          mediaType: MediaType.RELEASE_GROUP,
          scope: RequestScope.ALBUM,
          ...(options.isAutoRequest ? { isAutoRequest: true } : {}),
        },
        user,
        options.isAutoRequest ? { isAutoRequest: true } : {}
      );
      results.push({
        mbid,
        title: titles.get(mbid) ?? request.media?.title,
        outcome:
          request.status === MediaRequestStatus.PENDING ? 'pending' : 'auto',
        requestId: request.id,
      });
    } catch (e) {
      const known =
        e instanceof RequestPermissionError ||
        e instanceof QuotaRestrictedError ||
        e instanceof DuplicateMediaRequestError ||
        e instanceof BlocklistedMediaError;
      if (!known) {
        logger.error('Import could not request an album', {
          label: 'Import',
          mbid,
          errorMessage: e.message,
        });
      }
      const reason = known
        ? e.message
        : "Something went wrong while requesting it. Try again from the album's page.";
      firstReason = firstReason ?? reason;
      results.push({
        mbid,
        title: titles.get(mbid),
        outcome: 'blocked',
        reason,
      });
    }
  }

  const auto = results.filter((r) => r.outcome === 'auto').length;
  const pending = results.filter((r) => r.outcome === 'pending').length;
  const blocked = results.filter((r) => r.outcome === 'blocked').length;

  if (job && (auto || pending)) {
    await getRepository(ImportJob).update(job.id, { status: 'requested' });
  }

  return {
    results,
    auto,
    pending,
    blocked,
    summary: summarizeImport(auto, pending, blocked, firstReason),
  };
};

/** GET /import/sources */
export const getImportSources = async (
  user: User
): Promise<ImportSourcesResponse> => {
  const { integrations } = getSettings();
  const linked = await getLinkedProviders(user.id);
  return {
    sources: [
      {
        key: 'spotify',
        name: 'Spotify',
        enabled: integrations.spotify,
        accepts: [
          'open.spotify.com/album/…',
          'open.spotify.com/playlist/…',
          'spotify:album:…',
        ],
      },
      {
        key: 'deezer',
        name: 'Deezer',
        enabled: integrations.deezer,
        accepts: [
          'deezer.com/album/…',
          'deezer.com/playlist/…',
          'deezer.page.link/…',
        ],
      },
      {
        key: 'itunes',
        name: 'Apple Music',
        enabled: integrations.itunes,
        accepts: ['music.apple.com/us/album/…'],
      },
    ],
    spotify: {
      enabled: integrations.spotify,
      linked: linked.has('spotify'),
      linkedAs: linked.get('spotify') || undefined,
      autoRequest: !!user.settings?.autoRequestSpotifySaved,
      canAutoRequest: user.hasPermission(
        [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_ALBUM],
        { type: 'or' }
      ),
    },
  };
};

const savedMatching = new Map<number, Promise<void>>();

/** GET /import/spotify/saved: the viewer's newest saved albums, matched. */
export const getSpotifySaved = async (
  user: User
): Promise<ImportSpotifySavedResponse> => {
  if (!getSettings().integrations.spotify) {
    return { linked: false, matches: [] };
  }
  const spotify = await getSpotifyForUser(user.id);
  if (!spotify) {
    return { linked: false, matches: [] };
  }
  const saved = await spotify.api.getSavedAlbums(SAVED_ALBUMS_SHOWN);
  const candidates = saved
    .slice(0, SAVED_ALBUMS_SHOWN)
    .map((s) => spotifyAlbumToCandidate(s.album));

  const outcomes = new Map<string, MatchOutcome>();
  const matchAll = async () => {
    for (const candidate of candidates) {
      try {
        outcomes.set(candidate.key, await matchAlbum(candidate));
      } catch {
        // MusicBrainz unreachable: stays pending, the next call retries
      }
    }
  };

  // One matching pass per user at a time; later calls read the persisted cache.
  let run = savedMatching.get(user.id);
  if (!run) {
    run = matchAll().finally(() => savedMatching.delete(user.id));
    savedMatching.set(user.id, run);
  } else {
    run = run.then(matchAll);
  }
  await Promise.race([
    run,
    new Promise((resolve) => setTimeout(resolve, INLINE_WAIT_MS)),
  ]);

  const stored: StoredMatch[] = candidates.map((candidate) => {
    const outcome = outcomes.get(candidate.key);
    return outcome
      ? {
          ...emptyMatch(candidate, false),
          matchedBy: outcome.matchedBy,
          album: outcomeToAlbum(outcome),
        }
      : emptyMatch(candidate, true);
  });
  return {
    linked: true,
    matches: await refreshMatches(stored),
    pending: stored.filter((m) => m.pending).length,
  };
};

/** Spotify album ids already handled by the saved-albums sync, per user. */
const syncedAlbums = new PersistCache<string[]>(
  'spotify-saved-sync',
  10 * 365 * 24 * 60 * 60 * 1000
);

let syncRunning = false;

/**
 * `spotify-saved-albums-sync` job: for everyone who linked Spotify, switched on
 * "Request albums I save on Spotify" and may auto-request, request the albums
 * they saved since linking. Each saved album is considered once.
 */
export const syncSpotifySavedAlbums = async (): Promise<void> => {
  const settings = getSettings();
  if (
    !settings.integrations.spotify ||
    settings.discover.spotify.savedAlbumsSync === 'never' ||
    syncRunning
  ) {
    return;
  }
  syncRunning = true;
  try {
    const users = await getRepository(User)
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.settings', 'settings')
      .where('settings.autoRequestSpotifySaved = :on', { on: true })
      .getMany();

    for (const user of users) {
      if (
        !user.hasPermission(
          [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_ALBUM],
          { type: 'or' }
        )
      ) {
        continue;
      }
      try {
        const spotify = await getSpotifyForUser(user.id);
        if (!spotify) {
          continue;
        }
        const key = String(user.id);
        const done = new Set(syncedAlbums.get(key) ?? []);
        const saved = (await spotify.api.getSavedAlbums()).filter(
          (s) =>
            !done.has(s.album.id) &&
            new Date(s.addedAt).getTime() > spotify.linkedAt.getTime()
        );
        let requested = 0;
        for (const item of saved) {
          let outcome: MatchOutcome;
          try {
            outcome = await matchAlbum(spotifyAlbumToCandidate(item.album));
          } catch {
            continue; // MusicBrainz unreachable: try this album again next run
          }
          if (outcome.releaseGroup) {
            const result = await requestImport(
              user,
              { mbids: [outcome.releaseGroup.mbid] },
              { isAutoRequest: true }
            );
            requested += result.auto + result.pending;
          }
          done.add(item.album.id);
          syncedAlbums.set(key, [...done]);
        }
        if (saved.length) {
          logger.info('Checked Spotify saved albums', {
            label: 'Import',
            userId: user.id,
            newAlbums: saved.length,
            requested,
          });
        }
      } catch (e) {
        logger.warn('Could not check Spotify saved albums for a user', {
          label: 'Import',
          userId: user.id,
          errorMessage: e.message,
        });
      }
    }
  } finally {
    syncRunning = false;
  }
};
