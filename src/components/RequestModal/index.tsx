// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: src/components/RequestModal/TvRequestModal.tsx at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import Field from '@app/components/Common/Field';
import Modal from '@app/components/Common/Modal';
import { LimitMeter } from '@app/components/Common/QuotaRing';
import CoverArt from '@app/components/CoverArt';
import useSettings from '@app/hooks/useSettings';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { formatDuration } from '@app/utils/format';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import type {
  DryRunResult,
  MediaRequestBody,
  RequestResult,
} from '@server/interfaces/api/requestInterfaces';
import type {
  ServiceCommonServer,
  ServiceCommonServerWithDetails,
} from '@server/interfaces/api/serviceInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import type { AlbumDetails, AlbumTrack } from '@server/models/music';
import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate as globalMutate } from 'swr';

const messages = defineMessages('components.RequestModal', {
  title: 'Request {title}',
  summaryalbum: '{artist}, {year}. {have} of {total} tracks in library.',
  summaryalbumnocount: '{artist}, {year}.',
  summaryartist: 'Every release by this artist.',
  whatdoyouwant: 'What do you want?',
  scopesong: 'Just this song',
  scopesongsub: '{title}',
  scopesongsubfallback: 'Only this one track, nothing else from the album',
  scopetracks: 'Pick the tracks',
  scopetrackssub:
    '{count, plural, one {# track} other {# tracks}}: {titles}',
  scopealbum: 'The whole album',
  scopealbumsub:
    '{count, plural, one {# track} other {# tracks}}. Upgrades files if a better release exists',
  scopealbumsubnocount: 'Upgrades files if a better release exists',
  scopediscography: 'Everything by {artist}',
  scopediscographysub:
    '{count, plural, one {# release} other {# releases}}, each counts toward your album limit',
  scopediscographysubnocount:
    'Every release counts toward your album limit',
  picktracks: 'Tracks to request',
  picktracksnone: 'Pick at least one track.',
  outcomeauto:
    'This will be approved automatically and sent to Lidarr right away.',
  outcomepending: 'An admin will need to approve this before it downloads.',
  outcomechecking: 'Checking what happens with this request…',
  outcomefailed:
    'Shufflerr couldn’t check this request. Try again in a moment.',
  server: 'Lidarr server',
  serverdefault: '{name} (default)',
  quality: 'Quality',
  metadataprofile: 'Metadata profile',
  folder: 'Folder',
  folderfree: '{path} ({free} free)',
  watchfuture: 'Watch for new releases from {artist}',
  ignorelimit: 'Ignore my weekly limit for this request',
  limitweekly: 'Your weekly limit',
  limitdays: 'Your limit for the past {days} days',
  limitalbums: '{remaining} of {limit} albums',
  limittracks: '{remaining} of {limit} tracks',
  nolimitalbums: 'No album limit',
  nolimittracks: 'no track limit',
  cancel: 'Cancel',
  send: 'Send request',
  sending: 'Sending…',
  requestedauto:
    'Requested {title}. Approved automatically and sent to Lidarr.',
  requestedpending:
    'Requested {title}. It’s waiting for an admin to approve it.',
  requestfailed:
    'The request couldn’t be sent. Check your connection and try again.',
  everythingby: 'everything by {artist}',
});

// A UI-only scope meaning "just this one song". It maps to the TRACKS backend
// scope with a single recording, but is kept distinct from TRACKS ("pick the
// tracks") so that requesting from one track's button is unambiguous and the
// single pick is locked — it can't be dropped by interacting elsewhere.
const SONG = 'song' as const;
type UiScope = RequestScope | typeof SONG;

export interface RequestModalAlbum {
  /** Release-group MBID */
  mbid: string;
  title: string;
  artistName: string;
  artistMbid?: string;
  year?: number | string;
  coverUrl?: string | null;
  trackCount?: number | null;
  tracksAvailable?: number;
}

export interface RequestModalArtist {
  mbid: string;
  name: string;
  imageUrl?: string | null;
}

interface RequestModalProps {
  /** Request an album (tracks / album / discography scopes). */
  album?: RequestModalAlbum;
  /** Request an artist's discography. Derived from `album` when omitted. */
  artist?: RequestModalArtist;
  defaultScope?: RequestScope;
  /**
   * Recording MBID to pre-select in the `tracks` scope. Set when the modal is
   * opened from a single track's "Request" button so that one track starts
   * picked instead of every missing track.
   */
  defaultTrackMbid?: string;
  onCancel: () => void;
  onComplete?: (request: RequestResult) => void;
}

/** Refresh every list that shows request or library state. */
export const revalidateMusic = () =>
  globalMutate(
    (key) =>
      typeof key === 'string' &&
      /^\/api\/v1\/(request|album|artist|discover|search|library|user\/\d+\/(quota|requests)|import)/.test(
        key
      ),
    undefined,
    { revalidate: true }
  );

const isMissing = (track: AlbumTrack) =>
  track.status !== MediaStatus.AVAILABLE &&
  track.requestStatus !== MediaRequestStatus.PENDING &&
  track.requestStatus !== MediaRequestStatus.APPROVED;

const formatBytes = (bytes?: number) => {
  if (!bytes || bytes <= 0) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
};

const RequestModal = ({
  album,
  artist: artistProp,
  defaultScope,
  defaultTrackMbid,
  onCancel,
  onComplete,
}: RequestModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const { currentSettings } = useSettings();

  const artist = useMemo<RequestModalArtist | undefined>(
    () =>
      artistProp ??
      (album?.artistMbid
        ? { mbid: album.artistMbid, name: album.artistName }
        : undefined),
    [album?.artistMbid, album?.artistName, artistProp]
  );

  // Freeze the in-modal data while the dialog is open: a background refetch (on
  // window focus, or an SSE-driven `mutate` from useRealtime) would hand back a
  // new `details` object, churning `missing`/`selectableTracks` identities and
  // disturbing the track selection under the user. Keep the first snapshot.
  const { data: details } = useSWR<AlbumDetails>(
    album ? `/api/v1/album/${album.mbid}` : null,
    { revalidateOnFocus: false, revalidateIfStale: false, keepPreviousData: true }
  );
  const { data: quota } = useSWR<QuotaResponse>(
    user ? `/api/v1/user/${user.id}/quota` : null,
    { revalidateOnFocus: false }
  );

  const isManager = hasPermission(Permission.MANAGE_REQUESTS);
  const showAdvanced = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const { data: servers } = useSWR<ServiceCommonServer[]>(
    showAdvanced ? '/api/v1/service/lidarr' : null,
    { revalidateOnFocus: false }
  );

  const missing = useMemo(
    () => (details?.tracks ?? []).filter(isMissing),
    [details]
  );
  const trackCount = details?.tracks.length || album?.trackCount || undefined;
  const tracksAvailable =
    details?.tracksAvailable ?? album?.tracksAvailable ?? 0;

  const canTracks =
    !!album &&
    currentSettings.allowTrackRequests &&
    missing.length > 0 &&
    hasPermission([Permission.REQUEST, Permission.REQUEST_TRACK], {
      type: 'or',
    });
  const canDiscography =
    !!artist &&
    hasPermission([Permission.REQUEST, Permission.REQUEST_DISCOGRAPHY], {
      type: 'or',
    });

  const [scope, setScope] = useState<UiScope>(
    defaultTrackMbid
      ? SONG
      : defaultScope ?? (album ? RequestScope.ALBUM : RequestScope.DISCOGRAPHY)
  );
  // Opening from a track (song) or with an explicit scope is an intentional
  // choice, so don't let the "partly available → tracks" default override it.
  const [scopeTouched, setScopeTouched] = useState(
    !!defaultScope || !!defaultTrackMbid
  );
  // `null` means "every missing track"; a concrete array is the user's pick.
  // When opened from one track's Request button, start with just that track.
  const [pickedTracks, setPickedTracks] = useState<string[] | null>(() =>
    defaultTrackMbid ? [defaultTrackMbid] : null
  );
  const [serverId, setServerId] = useState<number | null>(null);
  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null);
  const [metadataProfileId, setMetadataProfileId] = useState<number | null>(
    null
  );
  const [rootFolder, setRootFolder] = useState<string | null>(null);
  const [monitorFuture, setMonitorFuture] = useState(false);
  const [ignoreQuota, setIgnoreQuota] = useState(false);
  const [outcome, setOutcome] = useState<DryRunResult | null>(null);
  const [outcomeState, setOutcomeState] = useState<
    'checking' | 'ready' | 'failed'
  >('checking');
  const [submitting, setSubmitting] = useState(false);

  // A partly available album defaults to "Only the missing tracks", like the mockup.
  useEffect(() => {
    if (!scopeTouched && album && canTracks && tracksAvailable > 0) {
      setScope(RequestScope.TRACKS);
    }
  }, [album, canTracks, scopeTouched, tracksAvailable]);

  // Fall back when the chosen scope turns out not to be offered.
  useEffect(() => {
    if ((scope === RequestScope.TRACKS || scope === SONG) && details && !canTracks) {
      setScope(RequestScope.ALBUM);
    }
  }, [canTracks, details, scope]);

  // The backend only knows TRACKS/ALBUM/DISCOGRAPHY; SONG is a TRACKS request.
  const backendScope: RequestScope =
    scope === SONG ? RequestScope.TRACKS : scope;

  const selectableTracks = useMemo(
    () => missing.filter((t) => !!t.recordingMbid),
    [missing]
  );
  // The track this modal was opened for, for the "Just this song" label.
  const defaultTrack = useMemo(
    () =>
      defaultTrackMbid
        ? (details?.tracks ?? []).find(
            (t) => t.recordingMbid === defaultTrackMbid
          )
        : undefined,
    [details, defaultTrackMbid]
  );
  const songAvailable =
    !!defaultTrackMbid &&
    selectableTracks.some((t) => t.recordingMbid === defaultTrackMbid);
  const selectedTrackMbids = useMemo(() => {
    // "Just this song" is locked to the one recording and never the checkbox list.
    if (scope === SONG) {
      return defaultTrackMbid ? [defaultTrackMbid] : [];
    }
    return pickedTracks ?? selectableTracks.map((t) => t.recordingMbid as string);
  }, [scope, defaultTrackMbid, pickedTracks, selectableTracks]);

  // If we opened "Just this song" but the track isn't actually missing/
  // selectable, fall back to picking tracks rather than show an empty song.
  useEffect(() => {
    if (scope === SONG && details && canTracks && !songAvailable) {
      setScope(RequestScope.TRACKS);
    }
  }, [scope, details, canTracks, songAvailable]);

  // Default the advanced selects to the default server and its active profiles.
  useEffect(() => {
    if (servers?.length && serverId === null) {
      const def = servers.find((s) => s.isDefault && !s.isHiRes) ?? servers[0];
      setServerId(def.id);
    }
  }, [servers, serverId]);

  const { data: serverDetails } = useSWR<ServiceCommonServerWithDetails>(
    showAdvanced && serverId !== null
      ? `/api/v1/service/lidarr/${serverId}`
      : null,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (serverDetails) {
      setQualityProfileId(serverDetails.server.activeQualityProfileId);
      setMetadataProfileId(serverDetails.server.activeMetadataProfileId);
      setRootFolder(serverDetails.server.activeDirectory);
    }
  }, [serverDetails]);

  const body = useMemo<MediaRequestBody | null>(() => {
    if (backendScope === RequestScope.DISCOGRAPHY) {
      if (!artist) {
        return null;
      }
      return {
        mbid: artist.mbid,
        mediaType: MediaType.ARTIST,
        scope: backendScope,
        monitorFuture,
      };
    }
    if (!album) {
      return null;
    }
    const base: MediaRequestBody = {
      mbid: album.mbid,
      mediaType: MediaType.RELEASE_GROUP,
      scope: backendScope,
    };
    if (backendScope === RequestScope.TRACKS) {
      base.trackMbids = selectedTrackMbids;
    }
    return base;
  }, [album, artist, monitorFuture, backendScope, selectedTrackMbids]);

  const fullBody = useMemo<MediaRequestBody | null>(() => {
    if (!body) {
      return null;
    }
    const next = { ...body };
    if (showAdvanced && serverDetails && serverId !== null) {
      next.serverId = serverId;
      if (qualityProfileId !== null) {
        next.qualityProfileId = qualityProfileId;
      }
      if (metadataProfileId !== null) {
        next.metadataProfileId = metadataProfileId;
      }
      if (rootFolder) {
        next.rootFolder = rootFolder;
      }
    }
    if (ignoreQuota) {
      next.ignoreQuota = true;
    }
    return next;
  }, [
    body,
    ignoreQuota,
    metadataProfileId,
    qualityProfileId,
    rootFolder,
    serverDetails,
    serverId,
    showAdvanced,
  ]);

  const noTracksPicked =
    backendScope === RequestScope.TRACKS && selectedTrackMbids.length === 0;

  // Live outcome: ask the engine what would happen, debounced on every change.
  const dryRunSeq = useRef(0);
  const dryRunKey = fullBody ? JSON.stringify(fullBody) : '';
  useEffect(() => {
    if (!fullBody || noTracksPicked) {
      setOutcome(null);
      setOutcomeState('ready');
      return;
    }
    // Wait for the tracklist before evaluating a tracks request.
    if (backendScope === RequestScope.TRACKS && !details) {
      setOutcomeState('checking');
      return;
    }
    const seq = ++dryRunSeq.current;
    setOutcomeState('checking');
    const timer = setTimeout(async () => {
      try {
        const { data } = await axios.post<DryRunResult>(
          '/api/v1/request?dryRun=1',
          fullBody
        );
        if (seq === dryRunSeq.current) {
          setOutcome(data);
          setOutcomeState('ready');
        }
      } catch (e) {
        if (seq !== dryRunSeq.current) {
          return;
        }
        const message =
          axios.isAxiosError(e) && e.response?.status !== 501
            ? (e.response?.data?.message as string | undefined)
            : undefined;
        if (message) {
          setOutcome({ outcome: 'blocked', reason: message, code: 'error' });
          setOutcomeState('ready');
        } else {
          setOutcome(null);
          setOutcomeState('failed');
        }
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dryRunKey, noTracksPicked, details === undefined]);

  const subjectTitle = album?.title ?? artist?.name ?? '';
  const toastTitle =
    backendScope === RequestScope.DISCOGRAPHY && artist
      ? intl.formatMessage(messages.everythingby, { artist: artist.name })
      : subjectTitle;

  const submit = async () => {
    if (!fullBody) {
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await axios.post<RequestResult>(
        '/api/v1/request',
        fullBody
      );
      addToast(
        intl.formatMessage(
          data.status === MediaRequestStatus.APPROVED ||
            data.status === MediaRequestStatus.COMPLETED
            ? messages.requestedauto
            : messages.requestedpending,
          { title: toastTitle }
        ),
        { appearance: 'success' }
      );
      revalidateMusic();
      onComplete?.(data);
      onCancel();
    } catch (e) {
      const message = axios.isAxiosError(e)
        ? e.response?.data?.message
        : undefined;
      addToast(message ?? intl.formatMessage(messages.requestfailed), {
        appearance: 'error',
      });
      setSubmitting(false);
    }
  };

  const hasLimit = !!(quota?.album.limit || quota?.track.limit);
  const limitDays = quota?.album.days ?? quota?.track.days ?? 7;

  const scopeOptions: {
    value: UiScope;
    label: string;
    sub: string;
  }[] = [];
  if (album && canTracks && songAvailable) {
    scopeOptions.push({
      value: SONG,
      label: intl.formatMessage(messages.scopesong),
      sub: defaultTrack?.title
        ? intl.formatMessage(messages.scopesongsub, { title: defaultTrack.title })
        : intl.formatMessage(messages.scopesongsubfallback),
    });
  }
  if (album && canTracks) {
    scopeOptions.push({
      value: RequestScope.TRACKS,
      label: intl.formatMessage(messages.scopetracks),
      sub: intl.formatMessage(messages.scopetrackssub, {
        count: missing.length,
        titles:
          missing
            .slice(0, 4)
            .map((t) => t.title)
            .join(', ') + (missing.length > 4 ? '…' : ''),
      }),
    });
  }
  if (album) {
    scopeOptions.push({
      value: RequestScope.ALBUM,
      label: intl.formatMessage(messages.scopealbum),
      sub: trackCount
        ? intl.formatMessage(messages.scopealbumsub, { count: trackCount })
        : intl.formatMessage(messages.scopealbumsubnocount),
    });
  }
  if (artist && canDiscography) {
    const releaseCount =
      scope === RequestScope.DISCOGRAPHY ? outcome?.releaseCount : undefined;
    scopeOptions.push({
      value: RequestScope.DISCOGRAPHY,
      label: intl.formatMessage(messages.scopediscography, {
        artist: artist.name,
      }),
      sub: releaseCount
        ? intl.formatMessage(messages.scopediscographysub, {
            count: releaseCount,
          })
        : intl.formatMessage(messages.scopediscographysubnocount),
    });
  }

  const blocked = outcome?.outcome === 'blocked';

  return (
    <Modal
      title={intl.formatMessage(messages.title, { title: subjectTitle })}
      onCancel={onCancel}
      cancelText={intl.formatMessage(messages.cancel)}
      onOk={submit}
      okText={intl.formatMessage(submitting ? messages.sending : messages.send)}
      okButtonType="primary"
      okDisabled={
        submitting ||
        !fullBody ||
        noTracksPicked ||
        blocked ||
        outcomeState === 'checking'
      }
    >
      <div className="flex items-center gap-3.5">
        <CoverArt
          thumb
          decorative
          round={!album}
          src={album ? album.coverUrl : artist?.imageUrl}
          mbid={album?.mbid ?? artist?.mbid}
          title={subjectTitle}
          showInitials={!album}
        />
        <div className="min-w-0">
          <b>{subjectTitle}</b>
          <div className="sh-feat">
            {album
              ? trackCount
                ? intl.formatMessage(messages.summaryalbum, {
                    artist: album.artistName,
                    year: album.year ?? '',
                    have: tracksAvailable,
                    total: trackCount,
                  })
                : intl.formatMessage(messages.summaryalbumnocount, {
                    artist: album.artistName,
                    year: album.year ?? '',
                  })
              : intl.formatMessage(messages.summaryartist)}
          </div>
        </div>
      </div>

      <fieldset>
        <legend>{intl.formatMessage(messages.whatdoyouwant)}</legend>
        {scopeOptions.map((option) => (
          // The label text is the nested <b>/<small> pair.
          // eslint-disable-next-line jsx-a11y/label-has-associated-control
          <label
            className="sh-opt"
            key={option.value}
            htmlFor={`request-scope-${option.value}`}
          >
            <input
              id={`request-scope-${option.value}`}
              type="radio"
              name="request-scope"
              value={option.value}
              checked={scope === option.value}
              onChange={() => {
                setScope(option.value);
                setScopeTouched(true);
              }}
            />
            <span className="grow">
              <b>{option.label}</b>
              <small>{option.sub}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {scope === RequestScope.TRACKS && selectableTracks.length > 0 && (
        <fieldset>
          <legend>{intl.formatMessage(messages.picktracks)}</legend>
          <div className="sh-box max-h-56 overflow-y-auto px-3 py-1">
            {selectableTracks.map((track) => {
              const mbid = track.recordingMbid as string;
              return (
                <label className="sh-check" key={mbid}>
                  <input
                    type="checkbox"
                    checked={selectedTrackMbids.includes(mbid)}
                    onChange={(e) => {
                      const { checked } = e.target;
                      // Fold into the authoritative pick (functional update) so a
                      // re-render between events can never drop an earlier choice.
                      setPickedTracks((prev) => {
                        const base =
                          prev ??
                          selectableTracks.map((t) => t.recordingMbid as string);
                        return checked
                          ? base.includes(mbid)
                            ? base
                            : [...base, mbid]
                          : base.filter((m) => m !== mbid);
                      });
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-faint">
                      {track.position}
                    </span>{' '}
                    {track.title}
                  </span>
                  <span className="font-mono text-[13px] text-faint">
                    {formatDuration(track.lengthMs)}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <div aria-live="polite">
        {noTracksPicked ? (
          <div className="sh-outcome block" role="status">
            {intl.formatMessage(messages.picktracksnone)}
          </div>
        ) : outcomeState === 'checking' ? (
          <div className="sh-outcome wait" role="status">
            {intl.formatMessage(messages.outcomechecking)}
          </div>
        ) : outcomeState === 'failed' || !outcome ? (
          <div className="sh-outcome block" role="status">
            {intl.formatMessage(messages.outcomefailed)}
          </div>
        ) : outcome.outcome === 'auto' ? (
          <div className="sh-outcome auto" role="status">
            {intl.formatMessage(messages.outcomeauto)}
          </div>
        ) : outcome.outcome === 'pending' ? (
          <div className="sh-outcome wait" role="status">
            {intl.formatMessage(messages.outcomepending)}
          </div>
        ) : (
          <div className="sh-outcome block" role="status">
            {outcome.reason}
          </div>
        )}
      </div>

      {showAdvanced && !!servers?.length && (
        <div className="sh-fields">
          <Field label={intl.formatMessage(messages.server)}>
            {(p) => (
              <select
                {...p}
                value={serverId ?? ''}
                onChange={(e) => setServerId(Number(e.target.value))}
              >
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.isDefault
                      ? intl.formatMessage(messages.serverdefault, {
                          name: server.name,
                        })
                      : server.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={intl.formatMessage(messages.quality)}>
            {(p) => (
              <select
                {...p}
                value={qualityProfileId ?? ''}
                disabled={!serverDetails}
                onChange={(e) => setQualityProfileId(Number(e.target.value))}
              >
                {(serverDetails?.profiles ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={intl.formatMessage(messages.metadataprofile)}>
            {(p) => (
              <select
                {...p}
                value={metadataProfileId ?? ''}
                disabled={!serverDetails}
                onChange={(e) => setMetadataProfileId(Number(e.target.value))}
              >
                {(serverDetails?.metadataProfiles ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={intl.formatMessage(messages.folder)}>
            {(p) => (
              <select
                {...p}
                value={rootFolder ?? ''}
                disabled={!serverDetails}
                onChange={(e) => setRootFolder(e.target.value)}
              >
                {(serverDetails?.rootFolders ?? []).map((folder) => {
                  const free = formatBytes(folder.freeSpace);
                  return (
                    <option key={folder.path} value={folder.path}>
                      {free
                        ? intl.formatMessage(messages.folderfree, {
                            path: folder.path ?? '',
                            free,
                          })
                        : folder.path}
                    </option>
                  );
                })}
              </select>
            )}
          </Field>
        </div>
      )}

      {scope === RequestScope.DISCOGRAPHY && artist && (
        <label className="sh-check">
          <input
            type="checkbox"
            checked={monitorFuture}
            onChange={(e) => setMonitorFuture(e.target.checked)}
          />{' '}
          {intl.formatMessage(messages.watchfuture, { artist: artist.name })}
        </label>
      )}

      {isManager && hasLimit && (
        <label className="sh-check">
          <input
            type="checkbox"
            checked={ignoreQuota}
            onChange={(e) => setIgnoreQuota(e.target.checked)}
          />{' '}
          {intl.formatMessage(messages.ignorelimit)}
        </label>
      )}

      {quota && (
        <LimitMeter used={quota.album.used} limit={quota.album.limit}>
          <span className="flex flex-wrap justify-between gap-x-4">
            <span>
              {limitDays === 7
                ? intl.formatMessage(messages.limitweekly)
                : intl.formatMessage(messages.limitdays, { days: limitDays })}
            </span>
            <span>
              {quota.album.limit
                ? intl.formatMessage(messages.limitalbums, {
                    remaining: (
                      <b key="album" className="text-ink">{quota.album.remaining ?? 0}</b>
                    ),
                    limit: quota.album.limit,
                  })
                : intl.formatMessage(messages.nolimitalbums)}
              {', '}
              {quota.track.limit
                ? intl.formatMessage(messages.limittracks, {
                    remaining: (
                      <b key="track" className="text-ink">{quota.track.remaining ?? 0}</b>
                    ),
                    limit: quota.track.limit,
                  })
                : intl.formatMessage(messages.nolimittracks)}
            </span>
          </span>
        </LimitMeter>
      )}
    </Modal>
  );
};

export default RequestModal;
