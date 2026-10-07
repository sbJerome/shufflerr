import TrackBars from '@app/components/AlbumDetails/TrackBars';
import { linkLabel } from '@app/components/AlbumDetails/links';
import AddToPlaylist from '@app/components/AddToPlaylist';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import EmptyState from '@app/components/Common/EmptyState';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ProgressBar from '@app/components/Common/ProgressBar';
import CoverArt from '@app/components/CoverArt';
import IssueModal from '@app/components/IssueModal';
import ManageSlideOver from '@app/components/ManageSlideOver';
import usePlayback, { playableTracks } from '@app/components/Playback';
import RequestButton from '@app/components/RequestButton';
import { revalidateMusic } from '@app/components/RequestModal';
import { toModalAlbum } from '@app/components/RequestModal/subject';
import StatusBadge from '@app/components/StatusBadge';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { formatDuration } from '@app/utils/format';
import { canCancelRequest } from '@app/utils/requests';
import { isDownloading } from '@app/utils/status';
import {
  AdjustmentsHorizontalIcon,
  ArrowTopRightOnSquareIcon,
  FlagIcon,
} from '@heroicons/react/24/outline';
import {
  MediaRequestStatus,
  MediaStatus,
  RequestScope,
} from '@server/constants/media';
import type { AlbumDetails as AlbumDetailsType } from '@server/models/music';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.AlbumDetails', {
  album: 'Album',
  artists: 'Artists',
  metareleased: '{type}, released {date}',
  metareleasedlabel: '{type}, released {date} on {label}',
  metatype: '{type}',
  trackcount: '{count, plural, one {# track} other {# tracks}}',
  inlibrary: '{have} of {total} in library',
  progresslabel: '{have} of {total} tracks in library',
  requestmissing: 'Request missing tracks',
  requestalbum: 'Request album',
  playalbum: 'Play album',
  report: 'Report a problem',
  manage: 'Manage',
  tracklist: 'Tracklist',
  notracklist:
    'MusicBrainz has no tracklist for this release yet. You can still request the album.',
  pendingown: 'Your request for {what} is waiting for an admin to approve it.',
  pendingother:
    '{name}’s request for {what} is waiting for an admin to approve it.',
  review: 'Review it',
  cancelrequest: 'Cancel request',
  removerequest: 'Remove request',
  confirmcancel: 'Cancel it?',
  confirmremove: 'Remove it?',
  cancelled: 'Cancelled the request for {title}.',
  removed: 'Removed the request for {title}.',
  cancelfailed: 'That didn’t go through. Refresh the page and try again.',
  approvedauto:
    '{what} approved automatically. Lidarr is downloading ({percent}%).',
  approved: '{what} approved. Lidarr is downloading ({percent}%).',
  approvedwaitingauto:
    '{what} approved automatically. Lidarr is looking for it; nothing is downloading yet.',
  approvedwaiting:
    '{what} approved. Lidarr is looking for it; nothing is downloading yet.',
  whatmissing:
    '{count, plural, one {the missing track} other {the # missing tracks}}',
  whatalbum: 'this album',
  whatdiscography: 'this artist’s discography',
  whatmissingcap:
    '{count, plural, one {The missing track was} other {The # missing tracks were}}',
  whatalbumcap: 'This album was',
  whatdiscographycap: 'This artist’s discography was',
  notfound: 'That album couldn’t be found.',
  notfoundhint:
    'The link may be wrong, or MusicBrainz is unreachable right now. Search for the album to try again.',
  searchmusic: 'Search music',
  links: 'Links',
  genres: 'Genres',
  moregenre: 'More {genre} music',
  openin: 'Open in {name}',
});

const AlbumDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const { addToast } = useToasts();
  const { playTracks } = usePlayback();
  const [showIssue, setShowIssue] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const mbid = router.query.mbid as string | undefined;
  const {
    data: album,
    error,
    mutate,
  } = useSWR<AlbumDetailsType>(
    mbid ? `/api/v1/album/${mbid}` : null,
    {
      // Live updates come over SSE; this is a slow fallback while downloading.
      refreshInterval: (latest) =>
        latest?.requests?.some((r) => r.status === MediaRequestStatus.APPROVED)
          ? 60000
          : 0,
    }
  );

  if (error) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.album)} />
        <EmptyState
          title={intl.formatMessage(messages.notfound)}
          action={
            <Link href="/search" className="sh-btn small">
              {intl.formatMessage(messages.searchmusic)}
            </Link>
          }
        >
          {intl.formatMessage(messages.notfoundhint)}
        </EmptyState>
      </>
    );
  }

  if (!album) {
    return <LoadingSpinner />;
  }

  const total = album.tracks.length || album.trackCount || 0;
  const have = album.tracks.length
    ? album.tracks.filter((t) => t.status === MediaStatus.AVAILABLE).length
    : (album.tracksAvailable ?? 0);
  const complete = total > 0 && have >= total;
  const libraryStatus = complete
    ? MediaStatus.AVAILABLE
    : have > 0
      ? MediaStatus.PARTIALLY_AVAILABLE
      : album.status;

  const active =
    album.requests.find(
      (r) =>
        r.status === MediaRequestStatus.PENDING ||
        r.status === MediaRequestStatus.APPROVED
    ) ??
    (album.discographyRequest &&
    (album.discographyRequest.status === MediaRequestStatus.PENDING ||
      album.discographyRequest.status === MediaRequestStatus.APPROVED)
      ? album.discographyRequest
      : undefined);

  const queue = playableTracks(album);
  const type = album.primaryType || intl.formatMessage(messages.album);
  const released = album.firstReleaseDate
    ? album.firstReleaseDate.length >= 10
      ? intl.formatDate(album.firstReleaseDate, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC',
        })
      : album.firstReleaseDate
    : undefined;
  const metaLine = released
    ? album.label
      ? intl.formatMessage(messages.metareleasedlabel, {
          type,
          date: released,
          label: album.label,
        })
      : intl.formatMessage(messages.metareleased, { type, date: released })
    : intl.formatMessage(messages.metatype, { type });

  // The requester may cancel while the request waits for approval; a manager
  // may remove it at any time (including an auto-approved discography that is
  // still downloading). Removing it stops the Lidarr download server-side.
  const activeIsOwn = active?.requestedBy.id === user?.id;
  const canCancelActive =
    !!active &&
    canCancelRequest(active, user?.id, hasPermission(Permission.MANAGE_REQUESTS));

  const cancelActiveRequest = async () => {
    if (!active) {
      return;
    }
    setCancelling(true);
    try {
      await axios.delete(`/api/v1/request/${active.id}`);
      addToast(
        intl.formatMessage(
          activeIsOwn ? messages.cancelled : messages.removed,
          { title: album.title }
        ),
        { appearance: 'success' }
      );
      revalidateMusic();
      mutate();
    } catch (e) {
      const message = axios.isAxiosError(e)
        ? e.response?.data?.message
        : undefined;
      addToast(message ?? intl.formatMessage(messages.cancelfailed), {
        appearance: 'error',
      });
    } finally {
      setCancelling(false);
    }
  };

  const cancelControl = canCancelActive ? (
    <ConfirmButton
      buttonSize="sm"
      disabled={cancelling}
      confirmText={intl.formatMessage(
        activeIsOwn ? messages.confirmcancel : messages.confirmremove
      )}
      onClick={cancelActiveRequest}
    >
      {intl.formatMessage(
        activeIsOwn ? messages.cancelrequest : messages.removerequest
      )}
    </ConfirmButton>
  ) : null;

  let banner: React.ReactNode = null;
  if (active) {
    const missingCount = active.trackIds?.length ?? Math.max(0, total - have);
    if (active.status === MediaRequestStatus.PENDING) {
      const what =
        active.scope === RequestScope.TRACKS
          ? intl.formatMessage(messages.whatmissing, { count: missingCount })
          : active.scope === RequestScope.DISCOGRAPHY
            ? intl.formatMessage(messages.whatdiscography)
            : intl.formatMessage(messages.whatalbum);
      banner = (
        <div className="sh-outcome wait" role="status">
          {active.requestedBy.id === user?.id
            ? intl.formatMessage(messages.pendingown, { what })
            : intl.formatMessage(messages.pendingother, {
                name: active.requestedBy.displayName,
                what,
              })}
          {hasPermission(Permission.MANAGE_REQUESTS) && (
            <>
              {' '}
              <Link href="/requests?filter=pending">
                {intl.formatMessage(messages.review)}
              </Link>
            </>
          )}
        </div>
      );
    } else {
      const what =
        active.scope === RequestScope.TRACKS
          ? intl.formatMessage(messages.whatmissingcap, { count: missingCount })
          : active.scope === RequestScope.DISCOGRAPHY
            ? intl.formatMessage(messages.whatdiscographycap)
            : intl.formatMessage(messages.whatalbumcap);
      banner = (
        <div className="sh-outcome auto" role="status">
          {intl.formatMessage(
            isDownloading(active)
              ? active.isAutoApproved
                ? messages.approvedauto
                : messages.approved
              : active.isAutoApproved
                ? messages.approvedwaitingauto
                : messages.approvedwaiting,
            { what, percent: Math.round(active.downloadProgress ?? 0) }
          )}
        </div>
      );
    }
  }

  const canReport = hasPermission(
    [Permission.CREATE_ISSUES, Permission.MANAGE_ISSUES],
    { type: 'or' }
  );
  const canManage = hasPermission(Permission.MANAGE_REQUESTS);
  const externalLinks = album.links.filter((l) => !!l.url);

  const musicBrainz = externalLinks.find((l) => l.type === 'musicbrainz');
  const hero = album.coverUrl ?? null;

  return (
    <>
      <PageTitle title={[album.title, album.artistName]} />

      <section className="sh-ax-hero" aria-labelledby="album-title">
        {hero && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="art" src={hero} alt="" aria-hidden="true" />
        )}
        <div className="veil" aria-hidden="true" />
        <div className="sh-ax-col">
          <p className="sh-crumb">
            <Link href={`/artist/${album.artistMbid}`}>{album.artistName}</Link>{' '}
            / {album.title}
          </p>

          {banner}

          <div className="top">
            <div className="cover">
              <CoverArt
                src={album.coverUrl}
                mbid={album.mbid}
                title={album.title}
                loading="eager"
              />
            </div>
            <div className="info">
              <span className="kicker">{metaLine}</span>
              <h1 id="album-title">{album.title}</h1>
              <Link href={`/artist/${album.artistMbid}`} className="by">
                {album.artistName}
              </Link>
              <div className="sh-meta">
                {total > 0 && (
                  <span>
                    {intl.formatMessage(messages.trackcount, { count: total })}
                  </span>
                )}
                {!!album.totalLengthMs && (
                  <span>{formatDuration(album.totalLengthMs)}</span>
                )}
                <StatusBadge
                  status={libraryStatus}
                  downloading={isDownloading(active)}
                />
                {total > 0 && (
                  <span>
                    {intl.formatMessage(messages.inlibrary, { have, total })}
                  </span>
                )}
              </div>
              {total > 0 && (
                <ProgressBar
                  value={(have / total) * 100}
                  tone={complete ? 'available' : 'partial'}
                  label={intl.formatMessage(messages.progresslabel, {
                    have,
                    total,
                  })}
                />
              )}
              <div className="cta">
                {queue.length > 0 && (
                  <Button
                    type="button"
                    buttonType="primary"
                    onClick={() => playTracks(queue, 0)}
                  >
                    {intl.formatMessage(messages.playalbum)}
                  </Button>
                )}
                {!complete && !active && (
                  <RequestButton
                    album={toModalAlbum(album)}
                    defaultScope={
                      have > 0 ? RequestScope.TRACKS : RequestScope.ALBUM
                    }
                    buttonType={queue.length > 0 ? 'default' : 'primary'}
                    buttonSize="default"
                  >
                    {intl.formatMessage(
                      have > 0 ? messages.requestmissing : messages.requestalbum
                    )}
                  </RequestButton>
                )}
                {mbid && (
                  <AddToPlaylist
                    mbid={mbid}
                    mediaType="release-group"
                    title={album.title}
                    artistName={album.artistName}
                  />
                )}
                {cancelControl}
              </div>
              {!!album.genres?.length && (
                <ul
                  className="sh-ax-genres"
                  aria-label={intl.formatMessage(messages.genres)}
                >
                  {album.genres.slice(0, 6).map((genre) => (
                    <li key={genre}>
                      <Link
                        href={`/genre/${encodeURIComponent(genre)}`}
                        title={intl.formatMessage(messages.moregenre, {
                          genre,
                        })}
                      >
                        {genre}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="tools">
              {canReport && (
                <button
                  type="button"
                  onClick={() => setShowIssue(true)}
                  aria-label={intl.formatMessage(messages.report)}
                  title={intl.formatMessage(messages.report)}
                >
                  <FlagIcon aria-hidden="true" />
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => setShowManage(true)}
                  aria-label={intl.formatMessage(messages.manage)}
                  title={intl.formatMessage(messages.manage)}
                >
                  <AdjustmentsHorizontalIcon aria-hidden="true" />
                </button>
              )}
              {musicBrainz && (
                <a
                  href={musicBrainz.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={intl.formatMessage(messages.openin, {
                    name: 'MusicBrainz',
                  })}
                  title={intl.formatMessage(messages.openin, {
                    name: 'MusicBrainz',
                  })}
                >
                  <ArrowTopRightOnSquareIcon aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="sh-ax-col" aria-labelledby="album-tracklist">
        <h2 className="sr-only" id="album-tracklist">
          {intl.formatMessage(messages.tracklist)}
        </h2>
        {album.tracks.length ? (
          <TrackBars
            album={album}
            hasActiveRequest={!!active}
            downloading={isDownloading(active)}
          />
        ) : (
          <div className="sh-ax-none">
            {intl.formatMessage(messages.notracklist)}
          </div>
        )}

        {externalLinks.length > 0 && (
          <div className="sh-ax-links">
            <h2 id="album-links">{intl.formatMessage(messages.links)}</h2>
            <div className="sh-chips">
              {externalLinks.map((link) => (
                <a
                  key={`${link.type}-${link.url}`}
                  className="sh-chip inline-flex items-center text-ink"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {linkLabel(link, (name) =>
                    intl.formatMessage(messages.openin, { name })
                  )}
                </a>
              ))}
            </div>
          </div>
        )}
      </section>

      <IssueModal
        mediaType="release-group"
        mbid={album.mbid}
        show={showIssue}
        onClose={() => setShowIssue(false)}
      />
      <ManageSlideOver
        mediaType="release-group"
        mbid={album.mbid}
        show={showManage}
        onClose={() => setShowManage(false)}
      />
    </>
  );
};

export default AlbumDetails;
